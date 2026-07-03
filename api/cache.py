"""
Prompt cache backed by SQLite.

Cache key = sha256(normalize(query) + "|" + mode)[:24]
TTL: 6 h for web results (go stale), 7 days for doc/hybrid results.
Casual responses are never cached (they depend on conversation context).
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

from api.config import DB_PATH, RAG_CACHE_TTL_HOURS, WEB_CACHE_TTL_HOURS


# ── internal helpers ──────────────────────────────────────────────────

def _conn():
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _key(query: str, mode: str, context: str = "") -> str:
    """
    context: a short fingerprint of recent conversation history (see
    api/main.py's _context_fingerprint()). Without this, two different
    conversations both asking a context-dependent follow-up like "explain
    more" or "summarize that" hashed to the IDENTICAL cache key and one
    would silently get back the other's answer -- a real cross-conversation
    correctness bug, not just a cache-efficiency detail. A brand-new
    conversation's first message still has context="" like before, so
    genuinely repeated fresh questions (e.g. two separate chats both
    opening with "what is the latest Rust version") still hit the cache.
    """
    norm = re.sub(r"[^\w\s]", " ", query.lower())
    norm = re.sub(r"\s+", " ", norm).strip()
    raw = f"{norm}|{mode}|{context}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


# ── public API ────────────────────────────────────────────────────────

def init_cache() -> None:
    conn = _conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS prompt_cache (
        cache_key        TEXT PRIMARY KEY,
        query            TEXT,
        mode             TEXT,
        intent           TEXT,
        response         TEXT,
        sources_json     TEXT,
        web_sources_json TEXT,
        prompt_tokens    INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        hit_count        INTEGER DEFAULT 0,
        created_at       TEXT,
        expires_at       TEXT
    )""")
    conn.commit()
    conn.close()


def get_cached(query: str, mode: str, context: str = "") -> dict | None:
    """Return cached entry if fresh, else None."""
    key = _key(query, mode, context)
    now = datetime.now(timezone.utc).isoformat()
    conn = _conn()
    row = conn.execute(
        "SELECT * FROM prompt_cache WHERE cache_key=? AND expires_at > ?",
        (key, now),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE prompt_cache SET hit_count=hit_count+1 WHERE cache_key=?", (key,)
        )
        conn.commit()
        conn.close()
        d = dict(row)
        d["sources"] = json.loads(d.pop("sources_json", "[]") or "[]")
        d["web_sources"] = json.loads(d.pop("web_sources_json", "[]") or "[]")
        return d
    conn.close()
    return None


def set_cached(
    query: str,
    mode: str,
    intent: str,
    response: str,
    sources: list,
    web_sources: list,
    prompt_tokens: int,
    completion_tokens: int,
    context: str = "",
) -> None:
    key = _key(query, mode, context)
    now = datetime.now(timezone.utc)
    ttl = WEB_CACHE_TTL_HOURS if intent == "web" else RAG_CACHE_TTL_HOURS
    expires = (now + timedelta(hours=ttl)).isoformat()
    conn = _conn()
    conn.execute(
        """INSERT OR REPLACE INTO prompt_cache
           (cache_key, query, mode, intent, response,
            sources_json, web_sources_json,
            prompt_tokens, completion_tokens,
            hit_count, created_at, expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,0,?,?)""",
        (
            key, query, mode, intent, response,
            json.dumps(sources), json.dumps(web_sources),
            prompt_tokens, completion_tokens,
            now.isoformat(), expires,
        ),
    )
    conn.commit()
    conn.close()


def clear_cache() -> int:
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) FROM prompt_cache").fetchone()[0]
    conn.execute("DELETE FROM prompt_cache")
    conn.commit()
    conn.close()
    return n


def cache_stats() -> dict:
    conn = _conn()
    row = conn.execute("""
        SELECT COUNT(*) as total,
               SUM(hit_count) as total_hits,
               SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as active
        FROM prompt_cache
    """).fetchone()
    conn.close()
    return dict(row) if row else {"total": 0, "total_hits": 0, "active": 0}
