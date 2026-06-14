from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

from api.config import DB_PATH


@contextmanager
def db_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db_conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS conversations (
                session_id TEXT PRIMARY KEY, title TEXT, created_at TEXT)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY, session_id TEXT, role TEXT,
                message TEXT, created_at TEXT)"""
        )
        # Migrate chats table schema dynamically
        for col, col_type in [
            ("prompt_tokens", "INTEGER DEFAULT 0"),
            ("completion_tokens", "INTEGER DEFAULT 0"),
            ("mode", "TEXT"),
            ("sources_json", "TEXT"),
            ("web_sources_json", "TEXT"),
            ("cached", "INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE chats ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass # Already exists


def list_conversations() -> list[dict]:
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT session_id, title, created_at FROM conversations ORDER BY create_at DESC" if False else
            "SELECT session_id, title, created_at FROM conversations ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_conversation(title: str = "New Chat") -> dict:
    sid = datetime.utcnow().strftime("session_%Y%m%d_%H%M%S_%f")
    created = datetime.utcnow().isoformat()
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO conversations VALUES (?, ?, ?)",
            (sid, title, created),
        )
    return {"session_id": sid, "title": title, "created_at": created}


def delete_conversation(session_id: str) -> None:
    with db_conn() as conn:
        conn.execute("DELETE FROM chats WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))


def truncate_messages(session_id: str, message_id: int) -> None:
    with db_conn() as conn:
        conn.execute("DELETE FROM chats WHERE session_id = ? AND id >= ?", (session_id, message_id))


def load_messages(session_id: str) -> list[dict]:
    import json
    with db_conn() as conn:
        rows = conn.execute(
            """SELECT id, role, message, created_at, prompt_tokens, completion_tokens, mode,
                      sources_json, web_sources_json, cached
               FROM chats WHERE session_id = ? ORDER BY id""",
            (session_id,),
        ).fetchall()
    
    msgs = []
    for r in rows:
        d = dict(r)
        d["prompt_tokens"] = d.get("prompt_tokens") or 0
        d["completion_tokens"] = d.get("completion_tokens") or 0
        d["cached"] = bool(d.get("cached"))
        
        # Load document sources
        if d.get("sources_json"):
            try:
                d["sources"] = json.loads(d["sources_json"])
            except Exception:
                d["sources"] = []
        else:
            d["sources"] = []
            
        # Load web sources
        if d.get("web_sources_json"):
            try:
                d["webSources"] = json.loads(d["web_sources_json"])
            except Exception:
                d["webSources"] = []
        else:
            d["webSources"] = []
            
        d.pop("sources_json", None)
        d.pop("web_sources_json", None)
        msgs.append(d)
    return msgs


def append_message(
    session_id: str,
    role: str,
    message: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    mode: str | None = None,
    sources: list | None = None,
    web_sources: list | None = None,
    cached: bool = False,
) -> None:
    import json
    with db_conn() as conn:
        conn.execute(
            """INSERT INTO chats (
                session_id, role, message, created_at,
                prompt_tokens, completion_tokens, mode,
                sources_json, web_sources_json, cached
               ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                session_id,
                role,
                message,
                datetime.utcnow().isoformat(),
                prompt_tokens,
                completion_tokens,
                mode,
                json.dumps(sources) if sources else None,
                json.dumps(web_sources) if web_sources else None,
                1 if cached else 0,
            ),
        )


def set_title(session_id: str, title: str) -> None:
    with db_conn() as conn:
        conn.execute(
            "UPDATE conversations SET title = ? WHERE session_id = ?",
            (title[:60], session_id),
        )


def get_title(session_id: str) -> str:
    with db_conn() as conn:
        row = conn.execute(
            "SELECT title FROM conversations WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row["title"] if row else "New Chat"
