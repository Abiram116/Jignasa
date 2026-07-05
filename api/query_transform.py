"""
Query transformation techniques applied before RAG retrieval.

Techniques:
  - Query rewriting  : clean & expand the raw user query
  - HyDE             : generate a hypothetical answer, embed that instead
"""
from __future__ import annotations

from api import ollama_discovery
from api.config import OLLAMA_MODEL


# ── Query rewriting ───────────────────────────────────────────────────

def rewrite_query(question: str) -> str:
    """
    Ask the LLM to rewrite the question into a clean, search-optimised form.
    Falls back to the original question on any error.
    """
    prompt = (
        "Rewrite the following user question into a clear, precise, "
        "self-contained search query that will retrieve the most relevant "
        "passages from a document collection. Output ONLY the rewritten query "
        "with no explanation, quotes, or prefix.\n\n"
        f"Question: {question}\n\nRewritten query:"
    )
    try:
        response = ollama_discovery.client().chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
            think=False,
            options={"temperature": 0.0, "num_predict": 80},
        )
        rewritten = (response.message.content or "").strip().strip('"').strip("'")
        return rewritten if rewritten else question
    except Exception:
        return question


# ── HyDE (Hypothetical Document Embedding) ───────────────────────────

def generate_hypothetical_document(question: str) -> str:
    """
    Generate a short hypothetical passage that would answer the question.
    Embedding this passage instead of the raw query often yields better matches.
    Falls back to the original question on any error.
    """
    prompt = (
        "Write a short (2-3 sentence) passage from a document that directly "
        "answers the following question. Output ONLY the passage, no preamble.\n\n"
        f"Question: {question}\n\nPassage:"
    )
    try:
        response = ollama_discovery.client().chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
            think=False,
            options={"temperature": 0.3, "num_predict": 150},
        )
        hyp = (response.message.content or "").strip()
        return hyp if hyp else question
    except Exception:
        return question


# ── Public API ────────────────────────────────────────────────────────

def transform_query(question: str, use_hyde: bool = True) -> str:
    """
    Apply the query transformation pipeline dynamically.

    1. If the query is very short (<= 4 words), it is likely a keyword query -> bypass transforms.
    2. Check for conversational pronouns (it, they, this, that, etc.).
    3. If conversational -> run rewrite first to resolve context, then optionally HyDE.
    4. If self-contained -> skip rewrite (save 1 LLM call) and directly run HyDE.
    """
    stripped = question.strip()
    words = stripped.lower().split()
    
    # 1. Bypass all transforms for short keyword queries
    if len(words) <= 4:
        return question

    # 2. Check for conversational pronouns or context dependencies
    conversational_pronouns = {
        "it", "its", "they", "them", "their", "this", "that", "these", "those",
        "here", "there", "him", "her", "which", "above", "below", "former", "latter",
        "that", "then", "so"
    }
    has_pronoun = any(word in conversational_pronouns for word in words)
    
    if has_pronoun:
        # Conversational query -> needs rewriting first to resolve reference, then optionally HyDE
        rewritten = rewrite_query(question)
        if use_hyde:
            return generate_hypothetical_document(rewritten)
        return rewritten
    else:
        # Self-contained query -> skip rewrite (save 1 LLM call) and run HyDE directly
        if use_hyde:
            return generate_hypothetical_document(question)
        return question
