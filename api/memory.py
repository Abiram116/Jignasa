"""
Persistent memory core (Stage 1 of docs/AGENT_ROADMAP.md).

A small, global, cross-session store of lasting preferences, instructions,
and facts the user has shared -- extracted after each casual/agent turn and
injected into the system prompt of every future turn, regardless of which
conversation it happens in. This is a single-user local app (see api/db.py
-- there's no user table, `session_id` is just a chat thread), so memory is
scoped globally rather than per-conversation.

No embedding search: the store is small and personal, so fetching the most
recent MAX_MEMORY_ITEMS and injecting them directly is correct here, not a
shortcut -- a vector index would be solving a problem this scale doesn't have.

Follows api/cache.py's standalone-module pattern (own bare sqlite3
connection, own schema init) rather than api/db.py's context manager, since
this is an auxiliary store with no relational integrity needs, same as the
prompt cache.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone

from api.config import DB_PATH, MAX_MEMORY_ITEMS, MEMORY_MODEL_NUM_PREDICT, OLLAMA_MODEL


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_memory() -> None:
    conn = _conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS memories (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        content           TEXT NOT NULL,
        source_session_id TEXT,
        created_at        TEXT
    )""")
    conn.commit()
    conn.close()


def list_memories(limit: int = MAX_MEMORY_ITEMS) -> list[dict]:
    """Most recent memories, oldest-first (natural reading order for a prompt block)."""
    conn = _conn()
    rows = conn.execute(
        "SELECT id, content, created_at FROM memories ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


def save_memory(content: str, source_session_id: str | None = None) -> bool:
    """Insert a memory unless an identical one (case-insensitive) already exists.

    Returns True if a new row was inserted, False on a no-op (empty content
    or exact duplicate) -- not semantic dedup (that needs embeddings, out of
    scope for a store this size), just cheap enough to stop the common case
    of a restated preference/name piling up duplicate rows.
    """
    content = content.strip()[:500]
    if not content:
        return False
    conn = _conn()
    existing = conn.execute(
        "SELECT 1 FROM memories WHERE lower(content) = lower(?) LIMIT 1", (content,)
    ).fetchone()
    if existing:
        conn.close()
        return False
    conn.execute(
        "INSERT INTO memories (content, source_session_id, created_at) VALUES (?, ?, ?)",
        (content, source_session_id, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return True


def delete_memory(memory_id: int) -> None:
    conn = _conn()
    conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    conn.commit()
    conn.close()


def clear_memories() -> int:
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    conn.execute("DELETE FROM memories")
    conn.commit()
    conn.close()
    return n


def format_memory_block(memories: list[dict] | None = None) -> str:
    """
    Render memories as a block to append to a system prompt.
    Returns "" when there are none, so callers can unconditionally concatenate.
    """
    mems = memories if memories is not None else list_memories()
    if not mems:
        return ""
    lines = "\n".join(f"- {m['content']}" for m in mems)
    return (
        "\n\nWHAT YOU REMEMBER ABOUT THIS USER (from prior conversations):\n"
        f"{lines}\n"
        "Weave this in naturally where it genuinely fits -- e.g. use their name "
        "when addressing or comforting them directly, respect a stated "
        "preference without being asked again. Don't recite this list or force "
        "it into answers it has nothing to do with."
    )


_SAVE_MEMORY_TOOL = [{
    "type": "function",
    "function": {
        "name": "save_memory",
        "description": (
            "Call this ONLY for durable, identity-level facts about the user that "
            "would matter in a completely unrelated future conversation: their "
            "name, their role/job, or an explicit standing instruction they gave "
            "you (e.g. 'always answer in bullet points', 'call me X').\n\n"
            "Do NOT call this for: the topic or subject matter of the current "
            "conversation, a question they asked, code or document content, an "
            "opinion they gave once, or anything only useful for answering THIS "
            "turn. Most turns have nothing worth saving -- when in doubt, do not "
            "call this tool. Saving too much is worse than saving too little; "
            "this is a short list of durable facts, not a transcript or summary "
            "of what was discussed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "facts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Each lasting fact/preference to remember, as a short third-person statement, e.g. 'Their name is Abiram.' or 'Prefers Python over JavaScript for examples.'",
                },
            },
            "required": ["facts"],
        },
    },
}]


# A small LLM's tool-call judgment isn't fully deterministic even at
# temperature=0 -- spot-checking showed it sometimes drops one fact from a
# message that stated two (e.g. a name introduced alongside a preference).
# Self-introduction is the one case worth a deterministic safety net: it's
# the most common and highest-value fact to get right, so it's captured by
# regex independent of whatever the LLM call below decides.
_NAME_PATTERNS = [
    re.compile(r"\bmy name(?:'s| is)\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})"),
    re.compile(r"\bcall me\s+([A-Za-z][\w'-]*)", re.IGNORECASE),
]


def _heuristic_name_fact(user_message: str) -> str | None:
    for pattern in _NAME_PATTERNS:
        m = pattern.search(user_message)
        if m:
            name = m.group(1).strip().rstrip(".,!?")
            if name:
                return f"Their name is {name}."
    return None


def extract_memory(user_message: str, assistant_answer: str, session_id: str | None = None) -> list[str]:
    """
    Decide whether this turn contains anything worth remembering long-term,
    and store it if so. The tool-calling part mirrors api/intent.py's old
    classify_intent_llm pattern exactly (think=False, low num_predict, local
    import, blanket try/except).

    Synchronous and blocking by design -- always called from a background
    task (see api/main.py), never inline in the request/response path, so a
    slow or failed call here never adds latency or an error to the user's
    actual answer.

    Returns the list of facts actually saved (empty if nothing was worth
    remembering, or everything found was already stored).
    """
    saved: list[str] = []

    name_fact = _heuristic_name_fact(user_message)
    if name_fact and save_memory(name_fact, source_session_id=session_id):
        saved.append(name_fact)

    from ollama import chat as _ollama_chat

    try:
        resp = _ollama_chat(
            model=OLLAMA_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    f"User said: {user_message}\n\nAssistant replied: {assistant_answer}\n\n"
                    "Most exchanges have nothing worth remembering long-term. Only call "
                    "save_memory if this one revealed a durable, identity-level fact "
                    "(name, role) or an explicit standing instruction -- not the topic "
                    "of this exchange itself. If in doubt, call with an empty list."
                ),
            }],
            tools=_SAVE_MEMORY_TOOL,
            think=False,
            options={"temperature": 0, "num_predict": MEMORY_MODEL_NUM_PREDICT},
        )
        if resp.message.tool_calls:
            args = resp.message.tool_calls[0].function.arguments
            for fact in args.get("facts", []):
                content = str(fact).strip()
                if content and save_memory(content, source_session_id=session_id):
                    saved.append(content)
    except Exception:
        pass  # never let memory extraction raise or surface anywhere

    return saved
