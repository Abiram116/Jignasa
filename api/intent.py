"""
Intent classification + guardrails.

Returns one of: "casual" | "rag" | "web"
Raises ValueError with a user-facing message when guardrails are violated.
"""
from __future__ import annotations

import re

from api.config import (
    BLOCKED_PATTERNS,
    CASUAL_PATTERNS,
    MAX_INPUT_LENGTH,
    MIN_INPUT_LENGTH,
    OLLAMA_MODEL,
    WEB_TRIGGER_WORDS,
)


# ── Guardrails ────────────────────────────────────────────────────────

def run_guardrails(text: str) -> None:
    """Raise ValueError if the input violates guardrails."""
    stripped = text.strip()

    if len(stripped) < MIN_INPUT_LENGTH:
        raise ValueError("Message is empty.")

    if len(stripped) > MAX_INPUT_LENGTH:
        raise ValueError(
            f"Message is too long ({len(stripped)} chars). "
            f"Please keep it under {MAX_INPUT_LENGTH} characters."
        )

    lower = stripped.lower()
    for pattern in BLOCKED_PATTERNS:
        if pattern in lower:
            raise ValueError(
                "Your message was flagged by the safety filter and cannot be processed. "
                "Please rephrase your question."
            )


# ── Heuristic intent detection ────────────────────────────────────────

def _normalise(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def classify_intent(message: str) -> str:
    """
    Classify message intent without calling the LLM (pure heuristic).

    Returns: "casual" | "web" | "rag"
    """
    norm = _normalise(message)
    words = norm.split()

    # 1. Casual – exact or near-exact match to known casual phrases
    for pattern in CASUAL_PATTERNS:
        p_norm = _normalise(pattern)
        # Full match or message starts/ends with the pattern
        if norm == p_norm or norm.startswith(p_norm) or norm.endswith(p_norm):
            return "casual"
        # Short messages (≤ 4 words) – partial token overlap
        if len(words) <= 4 and all(w in words for w in p_norm.split()):
            return "casual"

    # 2. Web search – any web trigger keyword present
    for trigger in WEB_TRIGGER_WORDS:
        t_norm = _normalise(trigger)
        if t_norm in norm:
            return "web"

    # 3. Default to RAG
    return "rag"


def classify_intent_llm(message: str) -> str:
    """
    Use Ollama tool-calling to let the model route the query.

    The model picks one of three tools:
      - casual_response  → "casual"
      - rag_search       → "rag"
      - web_search       → "web"

    Falls back to the heuristic classify_intent() on any error or if the
    model does not call a tool.

    Returns: "casual" | "rag" | "web"
    """
    from ollama import chat as _ollama_chat  # local import to keep module fast

    tools = [
        {
            "type": "function",
            "function": {
                "name": "casual_response",
                "description": (
                    "Use this when the message is casual conversation, a greeting, "
                    "small talk, simple thanks, or a factual question that can be "
                    "answered from general knowledge without searching documents or the web."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "rag_search",
                "description": (
                    "Use this when the message asks a question that should be "
                    "answered from the user's local knowledge-base documents or PDFs "
                    "(technical questions, document-specific queries, domain knowledge)."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": (
                    "Use this when the message requires live or up-to-date information "
                    "from the internet: current events, breaking news, today's prices, "
                    "sports scores, weather, or anything that changes over time."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
    ]

    _TOOL_MAP = {
        "casual_response": "casual",
        "rag_search": "rag",
        "web_search": "web",
    }

    try:
        resp = _ollama_chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": message}],
            tools=tools,
            think=False,
            options={"temperature": 0, "num_predict": 64},
        )
        if resp.message.tool_calls:
            name = resp.message.tool_calls[0].function.name
            return _TOOL_MAP.get(name, "rag")
        # Model produced text instead of a tool call → fall through
    except Exception:
        pass  # network error, unsupported model version, etc.

    return classify_intent(message)
