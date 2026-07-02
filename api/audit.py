"""
Structured audit trail -- Stage 2.5 of docs/AGENT_ROADMAP.md.

If you can't trace what an agent did, you can't debug it, secure it, or
trust it. This is a separate, queryable, permanent record of what happened
on a given conversation -- distinct from the ephemeral `agent_trace`
already streamed to the frontend for that turn's live "thinking" UI (which
is per-message and only covers tool calls). This table also captures
router decisions and guardrail blocks, and persists independent of
whatever gets shown in the chat UI.

Scope: the normal chat flow only (casual + the adaptive tool-calling loop).
No MCP -- that stage was intentionally not built for this project.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from api.config import DB_PATH


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_audit() -> None:
    conn = _conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id     TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        event_type     TEXT NOT NULL,
        tool_name      TEXT,
        input_summary  TEXT,
        output_summary TEXT,
        reasoning      TEXT
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)")
    conn.commit()
    conn.close()


def log_event(
    session_id: str,
    event_type: str,
    *,
    tool_name: str | None = None,
    input_summary: str | None = None,
    output_summary: str | None = None,
    reasoning: str | None = None,
) -> None:
    """
    Synchronous, not fire-and-forget: these are cheap single-row inserts of
    data already computed as part of doing the actual work (a router label,
    a trace entry), so there's no extra latency to hide, and an audit trail
    that can silently lose entries defeats the point of having one. Still
    wrapped in try/except at every call site so a logging failure can never
    break the actual chat response.
    """
    conn = _conn()
    conn.execute(
        """INSERT INTO audit_log
           (session_id, created_at, event_type, tool_name, input_summary, output_summary, reasoning)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            session_id,
            datetime.now(timezone.utc).isoformat(),
            event_type,
            tool_name,
            input_summary,
            output_summary,
            reasoning,
        ),
    )
    conn.commit()
    conn.close()


def get_audit_trail(session_id: str) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT id, session_id, created_at, event_type, tool_name, input_summary, output_summary, reasoning "
        "FROM audit_log WHERE session_id = ? ORDER BY id",
        (session_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
