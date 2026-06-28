"""
Web search via DuckDuckGo (ddgs package, no API key required).
Falls back gracefully if the package is not installed or search fails.

Note: a query-rewrite step (reformulating the raw message before searching)
was tried here and removed -- measured against a real failing example, it
made retrieval *worse* (pushed the correct top result down in favor of
SEO-spam pages) because DuckDuckGo already handled the raw conversational
message well. The actual failure mode in that case was the LLM citing a
source number that didn't match what it actually said -- a synthesis
grounding problem, not a retrieval problem. See WEB_SYSTEM / HYBRID_SYSTEM
in api/main.py for the prompt-side fix.
"""
from __future__ import annotations

from api.security import neutralise_injection


def web_search(query: str, n: int = 5) -> list[dict]:
    """
    Search DuckDuckGo and return up to `n` results.
    Each result: { title, url, snippet }.
    Returns [] on any error.
    """
    try:
        from ddgs import DDGS  # type: ignore  (pip install ddgs)
    except ImportError:
        try:
            from duckduckgo_search import DDGS  # type: ignore  # legacy fallback
        except ImportError:
            return []

    try:
        with DDGS() as ddgs:
            raw = list(ddgs.text(query, max_results=n))
        out: list[dict] = []
        for r in raw:
            out.append({
                "title":   r.get("title", ""),
                "url":     r.get("href", r.get("url", "")),
                "snippet": r.get("body", r.get("snippet", "")),
            })
        return out
    except Exception:
        return []


def build_web_prompt(question: str, results: list[dict], history: list[dict]) -> str:
    """Build a Qwen prompt grounded in web search results."""
    if not results:
        context = (
            "No web results were returned for this query. "
            "Inform the user that web search failed to return results and suggest they try again."
        )
    else:
        snippets = []
        for i, r in enumerate(results, start=1):
            snippets.append(
                f"[{i}] {neutralise_injection(r['title'])}\nURL: {r['url']}\n{neutralise_injection(r['snippet'])}"
            )
        context = "\n\n".join(snippets)

    recent = "\n".join(f"{m['role']}: {m['message']}" for m in history[-6:])

    return f"""You are a helpful assistant with access to live web search results. \
Answer the question using the web search results below.
Cite sources by their number [1], [2], etc. when relevant.
If the results don't contain enough information, say so clearly.

Web search results:
{context}

Recent chat:
{recent or "None"}

Question: {question}

Answer:"""
