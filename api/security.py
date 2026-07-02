"""
Security utilities for Jignasa.

Covers:
  - Session ID validation (prevents path traversal / DB injection via URL)
  - Rate limiting (in-memory token-bucket per IP — swap for Redis in prod)
  - Input sanitisation (strip null bytes, control chars, normalise whitespace)
  - Security response headers (CSP, HSTS, X-Frame-Options, etc.)
"""
from __future__ import annotations

import re
import time
import unicodedata
from collections import defaultdict
from threading import Lock
from typing import Callable

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# ── Session ID allowlist ─────────────────────────────────────────────────────
# Format: session_YYYYMMDD_HHMMSS_ffffff
_SESSION_RE = re.compile(r"^session_\d{8}_\d{6}_\d{1,6}$")


def validate_session_id(session_id: str) -> str:
    """
    Raise 400 if the session_id doesn't match our own creation format.
    This prevents path traversal and unexpected DB queries.
    """
    if not _SESSION_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format.")
    return session_id


# ── Input sanitisation ───────────────────────────────────────────────────────

def sanitise_text(text: str, max_length: int = 2000) -> str:
    """
    Sanitise free-text input before it reaches the LLM or the DB.

    Steps
    -----
    1. Reject null bytes and most C0 control characters (except \\t, \\n, \\r).
    2. Normalise Unicode to NFC (prevents homograph / invisible-char tricks).
    3. Strip leading/trailing whitespace.
    4. Hard-truncate to max_length.
    """
    # 1. Remove null bytes and non-printable C0 controls (keep tab/newline/CR)
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

    # 2. Unicode NFC normalisation
    cleaned = unicodedata.normalize("NFC", cleaned)

    # 3. Strip edges
    cleaned = cleaned.strip()

    # 4. Hard length cap (belt-and-suspenders on top of Pydantic Field)
    return cleaned[:max_length]


# ── In-memory rate limiter (token bucket) ───────────────────────────────────

class _RateLimiter:
    """
    Simple per-IP token-bucket rate limiter.

    Defaults: 20 requests per 60 seconds per IP.
    Swap for a Redis-backed solution for multi-process / prod deployments.
    """

    def __init__(self, max_calls: int = 20, period_seconds: float = 60.0) -> None:
        self._max = max_calls
        self._period = period_seconds
        self._buckets: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - self._period
        with self._lock:
            calls = self._buckets[ip]
            # Evict expired timestamps
            self._buckets[ip] = [t for t in calls if t > cutoff]
            if len(self._buckets[ip]) >= self._max:
                return False
            self._buckets[ip].append(now)
            return True


_limiter = _RateLimiter(max_calls=30, period_seconds=60.0)


def get_client_ip(request: Request) -> str:
    """Extract the real client IP, respecting common reverse-proxy headers."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── Security headers middleware ──────────────────────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Attach security headers to every response.

    Content-Security-Policy is deliberately permissive for the dev SPA
    (allows the Vite dev server localhost origin).  Tighten `connect-src`
    and remove `unsafe-eval` before deploying to production.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Rate-limit the expensive paths: chat (per-message LLM calls) and
        # evaluation (runs the full RAG pipeline over a question set).
        is_chat = request.url.path.endswith("/chat") and request.method == "POST"
        is_eval = request.url.path.startswith("/api/evaluation/") and request.method == "POST"
        if is_chat or is_eval:
            ip = get_client_ip(request)
            if not _limiter.is_allowed(ip):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please slow down."},
                    headers={"Retry-After": "60"},
                )

        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        # CSP: tighten connect-src and remove unsafe-eval for production
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "   # Vite HMR needs these; remove for prod build
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            # ':*' is valid CSP port-wildcard syntax (any port on that host)
            # -- not a hardcoded 5173, since Vite auto-increments to the
            # next free port when 5173 is already taken by something else.
            "connect-src 'self' http://localhost:* http://127.0.0.1:*; "
            "img-src 'self' data:; "
            "frame-ancestors 'none';"
        )
        # Only send HSTS when running behind HTTPS (prod)
        # response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


# ── Prompt injection guard ───────────────────────────────────────────────────
# Extends the list in config.py with structural injection patterns that are
# harder to catch with simple substring search.

_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)", re.I),
    re.compile(r"you\s+are\s+now\s+", re.I),
    re.compile(r"pretend\s+(you\s+are|to\s+be)\s+", re.I),
    re.compile(r"act\s+as\s+(if\s+you\s+(are|were)\s+)?", re.I),
    re.compile(r"(forget|disregard|override|bypass)\s+(your\s+)?(instructions?|rules?|guidelines?)", re.I),
    re.compile(r"system\s*prompt\s*[:=]", re.I),
    re.compile(r"<\s*/?system\s*>", re.I),       # XML-style prompt injection
    re.compile(r"\[INST\]|\[/INST\]", re.I),      # Llama-style delimiters
    re.compile(r"###\s*instruction", re.I),        # Alpaca-style injection
]


def check_prompt_injection(text: str) -> None:
    """
    Raise ValueError if the text looks like a prompt injection attempt.
    Complements the simple substring checks in config.BLOCKED_PATTERNS.
    """
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            raise ValueError(
                "Your message was flagged by the safety filter. "
                "Please rephrase your question."
            )


def neutralise_injection(text: str) -> str:
    """
    Defuse (not reject) injection-shaped text found in *retrieved* content --
    RAG chunks from a PDF, or web search snippets/titles. Unlike
    check_prompt_injection (used on the user's own message, where rejecting
    and asking them to rephrase is fine), failing the whole answer because a
    retrieved document or web page happens to contain "ignore previous
    instructions" would let any indexed PDF or search result silently break
    answers for everyone -- so this defuses the pattern in place instead.
    """
    for pattern in _INJECTION_PATTERNS:
        text = pattern.sub("[filtered]", text)
    return text
