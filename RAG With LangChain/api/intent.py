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
    Classify message intent without calling the LLM.

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
