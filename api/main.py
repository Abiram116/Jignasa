from __future__ import annotations

import json
import time
from collections.abc import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ollama import chat
from pydantic import BaseModel, Field

from api import db, rag
from api.cache import init_cache, get_cached, set_cached
from api.config import OLLAMA_MODEL, TOP_K, WEB_SEARCH_RESULT_COUNT
from api.evaluation import (
    EVAL_DESCRIPTION,
    EVAL_TYPE,
    iter_evaluation,
    load_evaluation_summary,
    load_saved_metrics,
    save_named_snapshot,
    stream_evaluation,
)
from api.intent import classify_intent, classify_intent_llm, run_guardrails
from api.rag import build_prompt, search_with_transform
from api.security import (
    SecurityHeadersMiddleware,
    check_prompt_injection,
    sanitise_text,
    validate_session_id,
)
from api.websearch import build_web_prompt, web_search

# ── Allowed origins ───────────────────────────────────────────────────
_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app = FastAPI(title="Jignasa PDF RAG API")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    mode: str = Field(default="auto")
    quoted_text: str | None = Field(default=None, max_length=1000)
    confirm_web_search: bool = Field(default=False)


class EvalRequest(BaseModel):
    k: int = Field(default=TOP_K, ge=1, le=10)


class SaveEvalRequest(BaseModel):
    name: str = Field(min_length=1)
    k: int = Field(default=TOP_K, ge=1, le=10)
    summary: dict | None = None
    rows: list[dict] | None = None


class PartialAssistantRequest(BaseModel):
    message: str = Field(min_length=1)
    mode: str = Field(default="casual")
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    latency_ms: int = Field(default=0, ge=0)


@app.on_event("startup")
def startup() -> None:
    db.init_db()
    init_cache()


@app.get("/api/status")
def get_status() -> dict:
    return {
        **rag.index_status(),
        "eval_type": EVAL_TYPE,
        "eval_description": EVAL_DESCRIPTION,
    }


@app.get("/api/conversations")
def get_conversations() -> list[dict]:
    return db.list_conversations()


@app.post("/api/conversations")
def post_conversation() -> dict:
    return db.create_conversation()


class RenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=60)


@app.put("/api/conversations/{session_id}")
def put_conversation(session_id: str, body: RenameRequest) -> dict:
    validate_session_id(session_id)
    db.set_title(session_id, sanitise_text(body.title, max_length=60))
    return {"ok": True}


@app.delete("/api/conversations/{session_id}")
def remove_conversation(session_id: str) -> dict:
    validate_session_id(session_id)
    db.delete_conversation(session_id)
    return {"ok": True}


@app.delete("/api/conversations/{session_id}/truncate/{message_id}")
def truncate_conversation(session_id: str, message_id: int) -> dict:
    validate_session_id(session_id)
    if message_id < 1:
        raise HTTPException(400, "Invalid message ID.")
    db.truncate_messages(session_id, message_id)
    return {"ok": True}


@app.get("/api/conversations/{session_id}/messages")
def get_messages(session_id: str) -> dict:
    validate_session_id(session_id)
    return {
        "session_id": session_id,
        "title": db.get_title(session_id),
        "messages": db.load_messages(session_id),
    }


@app.post("/api/conversations/{session_id}/partial-assistant")
def save_partial_assistant(session_id: str, body: PartialAssistantRequest) -> dict:
    validate_session_id(session_id)
    msg = sanitise_text(body.message, max_length=20000)
    db.append_message(
        session_id,
        "assistant",
        msg,
        prompt_tokens=body.prompt_tokens,
        completion_tokens=body.completion_tokens,
        mode=body.mode,
        cached=False,
        latency_ms=body.latency_ms,
    )
    return {"ok": True}


# ── System prompts ────────────────────────────────────────────────────

CASUAL_SYSTEM = """You are Jignasa, a sharp and helpful AI assistant. You engage naturally in conversation — friendly without being sycophantic.

FORMATTING RULES (follow strictly):
- Use **bold** for key terms or important concepts
- Use bullet points (- item) or numbered lists (1. item) when listing things
- Use `inline code` for technical terms, commands, or variable names
- Use ```language\\ncode\\n``` fenced blocks for multi-line code
- Use > blockquotes sparingly, only for highlighting notable points
- Keep paragraphs short and scannable
- Do NOT start every response with a greeting or acknowledgment
- Do NOT add unnecessary padding or filler phrases like "Great question!" or "Certainly!"

RESPONSE STYLE:
- For factual questions: be direct, accurate, and cite reasoning when needed
- For how-to questions: use numbered steps
- For explanations: lead with the core idea, then elaborate
- For math/logic: show your working clearly
- For opinions or subjective topics: be honest and balanced
- Keep responses concise unless depth is explicitly needed"""

RAG_SYSTEM = """You are Jignasa, a precise document assistant that answers questions from the provided document context.

CORE RULES:
- Answer ONLY from the context provided below
- If the answer is not in the context, say exactly: "I don't have enough information in the documents to answer that."
- Never hallucinate facts, statistics, or quotes not present in the context
- Cite sources naturally when referencing specific documents

FORMATTING RULES:
- Use **bold** for key terms and important concepts
- Use bullet points (- item) for lists of information
- Use numbered lists (1. item) for steps or sequences
- Use ```language\\ncode\\n``` fenced blocks for code or commands
- Use `inline code` for technical terms
- Use > blockquotes when directly quoting from the document
- Structure long answers with clear sections — don't write walls of text
- Be thorough but don't pad responses with irrelevant content"""

WEB_SYSTEM = """You are Jignasa, an AI assistant with access to live web search results. Answer the user's question using the search results provided.

CORE RULES:
- Use search results as your primary source — cite them as [1], [2] etc. inline
- Synthesize information across sources rather than just repeating one
- Acknowledge when sources conflict or are unclear
- Be factual and accurate — do not add information not in the results

FORMATTING RULES:
- Use **bold** for key facts and important terms
- Use bullet points (- item) for lists
- Use numbered lists (1. item) for steps or ranked items
- Use ```language\\ncode\\n``` fenced blocks for code
- Use `inline code` for commands and technical terms
- Structure responses clearly — lead with the direct answer, then elaborate
- Keep it scannable — break up long answers into clear sections"""

HYBRID_SYSTEM = """You are Jignasa, a hybrid assistant that synthesizes answers from both local documents and live web search results.

CORE RULES:
- Cite document sources as [doc: filename p.N] and web sources as [web: N]
- Prioritize document context for domain-specific questions; web for current/live information
- Acknowledge when sources complement or contradict each other
- Never hallucinate — only use what's in the provided context

FORMATTING RULES:
- Use **bold** for key points and important terms
- Use bullet points (- item) for lists
- Use numbered lists (1. item) for steps
- Use ```language\\ncode\\n``` fenced blocks for code
- Structure with clear sections for complex answers
- Lead with the most important information"""

NO_KB_SYSTEM = """You are Jignasa, a document assistant. The user asked a question but nothing relevant was found in the knowledge base, and they've chosen not to search the web.

Respond honestly: acknowledge that this topic isn't covered in your documents and isn't something you can look up right now. Be brief and direct. You can offer general knowledge if you're confident about it, but clearly mark it as general knowledge (not from their documents). Suggest they switch to Web mode if they need current or external information."""


@app.post("/api/conversations/{session_id}/chat")
def post_chat(session_id: str, body: ChatRequest) -> StreamingResponse:
    validate_session_id(session_id)

    body.message = sanitise_text(body.message, max_length=2000)
    if body.quoted_text:
        body.quoted_text = sanitise_text(body.quoted_text, max_length=1000)

    try:
        run_guardrails(body.message)
        if body.quoted_text:
            run_guardrails(body.quoted_text)
        check_prompt_injection(body.message)
        if body.quoted_text:
            check_prompt_injection(body.quoted_text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    mode_requested = body.mode.lower().strip()
    if mode_requested not in ["auto", "docs", "web", "hybrid"]:
        mode_requested = "auto"

    intent = mode_requested
    if mode_requested == "auto":
        intent = classify_intent_llm(body.message)
        if intent == "casual":
            resolved_mode = "casual"
        elif intent == "web":
            resolved_mode = "web"
        else:
            resolved_mode = "docs"
    else:
        resolved_mode = mode_requested
        if resolved_mode == "docs":
            intent = "rag"
        elif resolved_mode == "web":
            heuristic = classify_intent(body.message)
            if heuristic == "casual":
                resolved_mode = "casual"
                intent = "casual"
            else:
                intent = "web"
        elif resolved_mode == "hybrid":
            intent = "hybrid"

    if resolved_mode in ["docs", "hybrid"] and not rag.index_ready():
        if resolved_mode == "docs":
            resolved_mode = "casual"
            intent = "casual"
        else:
            resolved_mode = "web"
            intent = "web"

    def _quote_block(quoted: str | None) -> str:
        if not quoted or not quoted.strip():
            return ""
        return (
            "\n\n[USER CONTEXT: The user has highlighted and quoted the following specific "
            "excerpt from a previous assistant message. Their question below refers to "
            "this excerpt specifically — address it directly and precisely.]\n"
            f"Quoted excerpt:\n\"\"\"\n{quoted.strip()}\n\"\"\"\n"
        )

    quote_ctx = _quote_block(body.quoted_text)

    prior_history = db.load_messages(session_id)

    if not prior_history:
        words = body.message.strip().split()[:6]
        db.set_title(session_id, " ".join(words).title() if words else "New Chat")

    display_message = (
        f"> {body.quoted_text.strip()}\n\n{body.message}"
        if body.quoted_text and body.quoted_text.strip()
        else body.message
    )
    db.append_message(session_id, "user", display_message)

    def event_stream() -> Iterator[str]:
        stream_start = time.monotonic()

        yield _sse({"type": "intent", "mode": intent})

        # ── Cache check ─────────────────────────────────────────────
        if resolved_mode != "casual":
            cached = get_cached(body.message, resolved_mode)
            if cached is not None:
                latency_ms = int((time.monotonic() - stream_start) * 1000)
                yield _sse({"type": "cached", "is_cached": True})
                if cached.get("sources"):
                    yield _sse({"type": "sources", "sources": cached["sources"]})
                if cached.get("web_sources"):
                    yield _sse({"type": "web_sources", "sources": cached["web_sources"]})
                res_text = cached["response"]
                chunk_sz = 15
                for idx in range(0, len(res_text), chunk_sz):
                    yield _sse({"type": "token", "content": res_text[idx:idx+chunk_sz]})
                    time.sleep(0.005)
                db.append_message(
                    session_id, "assistant", res_text,
                    prompt_tokens=cached["prompt_tokens"],
                    completion_tokens=cached["completion_tokens"],
                    mode=intent, sources=cached["sources"],
                    web_sources=cached["web_sources"], cached=True, latency_ms=latency_ms,
                )
                yield _sse({
                    "type": "done", "content": res_text,
                    "prompt_tokens": cached["prompt_tokens"],
                    "completion_tokens": cached["completion_tokens"],
                    "cached": True, "latency_ms": latency_ms,
                })
                return

        # ── CASUAL ──────────────────────────────────────────────────
        if resolved_mode == "casual":
            ollama_messages: list[dict] = [{"role": "system", "content": CASUAL_SYSTEM}]
            for m in prior_history[-8:]:
                ollama_messages.append({"role": m["role"], "content": m["message"]})
            ollama_messages.append({"role": "user", "content": f"{quote_ctx}{body.message}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL, messages=ollama_messages,
                    stream=True, think=False,
                    options={"temperature": 0.7, "num_predict": 600},
                ):
                    if chunk.message.content:
                        answer_parts.append(chunk.message.content)
                        yield _sse({"type": "token", "content": chunk.message.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_eval_count or 0
                        completion_tokens = chunk.eval_count or 0
            except Exception as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            answer = "".join(answer_parts).strip()
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            db.append_message(
                session_id, "assistant", answer,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                mode="casual", cached=False, latency_ms=latency_ms,
            )
            yield _sse({
                "type": "done", "content": answer,
                "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                "cached": False, "latency_ms": latency_ms,
            })

        # ── WEB ─────────────────────────────────────────────────────
        elif resolved_mode == "web":
            results = web_search(body.message, n=WEB_SEARCH_RESULT_COUNT)
            yield _sse({"type": "web_sources", "sources": results})

            web_user_prompt = build_web_prompt(body.message, results, [])
            ollama_messages_web: list[dict] = [{"role": "system", "content": WEB_SYSTEM}]
            for m in prior_history[-6:]:
                ollama_messages_web.append({"role": m["role"], "content": m["message"]})
            ollama_messages_web.append({"role": "user", "content": f"{quote_ctx}{web_user_prompt}".strip()})

            answer_parts = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL, messages=ollama_messages_web,
                    stream=True, think=False,
                    options={"temperature": 0.3, "num_predict": 900},
                ):
                    if chunk.message.content:
                        answer_parts.append(chunk.message.content)
                        yield _sse({"type": "token", "content": chunk.message.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_eval_count or 0
                        completion_tokens = chunk.eval_count or 0
            except Exception as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            answer = "".join(answer_parts).strip()
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            db.append_message(
                session_id, "assistant", answer,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                mode="web", web_sources=results, cached=False, latency_ms=latency_ms,
            )
            set_cached(body.message, "web", "web", answer, [], results, prompt_tokens, completion_tokens)
            yield _sse({
                "type": "done", "content": answer,
                "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                "cached": False, "latency_ms": latency_ms,
            })

        # ── RAG ─────────────────────────────────────────────────────
        elif resolved_mode == "docs":
            try:
                hits, _transformed = search_with_transform(body.message)
            except FileNotFoundError as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            # ── Auto mode: ask before web searching if KB miss ──────
            # If we're in auto mode and RAG found nothing useful, signal
            # the frontend to ask the user if they want a web search.
            if mode_requested == "auto" and not body.confirm_web_search:
                # "No useful hits" = fewer than 2 chunks with score > 0.3
                useful = [h for h in hits if h.get("score", 0) > 0.3]
                if len(useful) < 2:
                    yield _sse({"type": "ask_web_search", "message": (
                        "I couldn't find relevant information in your documents for this query. "
                        "Would you like me to search the web instead?"
                    )})
                    return

            yield _sse({"type": "sources", "sources": hits})

            rag_user_prompt = build_prompt(body.message, hits, [])
            ollama_messages_rag: list[dict] = [{"role": "system", "content": RAG_SYSTEM}]
            for m in prior_history[-6:]:
                ollama_messages_rag.append({"role": m["role"], "content": m["message"]})
            ollama_messages_rag.append({"role": "user", "content": f"{quote_ctx}{rag_user_prompt}".strip()})

            answer_parts = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL, messages=ollama_messages_rag,
                    stream=True, think=False,
                    options={"temperature": 0.2, "num_predict": 1000},
                ):
                    if chunk.message.content:
                        answer_parts.append(chunk.message.content)
                        yield _sse({"type": "token", "content": chunk.message.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_eval_count or 0
                        completion_tokens = chunk.eval_count or 0
            except Exception as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            answer = "".join(answer_parts).strip()
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            db.append_message(
                session_id, "assistant", answer,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                mode="rag", sources=hits, cached=False, latency_ms=latency_ms,
            )
            set_cached(body.message, "docs", "rag", answer, hits, [], prompt_tokens, completion_tokens)
            yield _sse({
                "type": "done", "content": answer,
                "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                "cached": False, "latency_ms": latency_ms,
            })

        # ── HYBRID ──────────────────────────────────────────────────
        elif resolved_mode == "hybrid":
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                rag_future = executor.submit(search_with_transform, body.message)
                web_future = executor.submit(web_search, body.message, n=WEB_SEARCH_RESULT_COUNT)

                try:
                    hits, _transformed = rag_future.result()
                except FileNotFoundError as exc:
                    yield _sse({"type": "error", "message": str(exc)})
                    return
                except Exception as exc:
                    yield _sse({"type": "error", "message": f"RAG error: {str(exc)}"})
                    return

                try:
                    results = web_future.result()
                except Exception:
                    results = []

            yield _sse({"type": "sources", "sources": hits})
            yield _sse({"type": "web_sources", "sources": results})

            doc_snippets = []
            for h in hits:
                doc_snippets.append(f"[{h['source']} p.{h.get('page_number')}] {h['text']}")
            doc_context = "\n\n".join(doc_snippets) or "No relevant document chunks were found."

            web_snippets = []
            for i, r in enumerate(results, start=1):
                web_snippets.append(f"[web: {i}] {r['title']}\nURL: {r['url']}\n{r['snippet']}")
            web_context = "\n\n".join(web_snippets) or "No web search results were found."

            hybrid_user_prompt = f"""Synthesize information from both the document context and web search results below to answer the question.

LOCAL DOCUMENT CONTEXT:
{doc_context}

WEB SEARCH RESULTS:
{web_context}

Question: {body.message}

Answer:"""

            ollama_messages_hybrid = [{"role": "system", "content": HYBRID_SYSTEM}]
            for m in prior_history[-6:]:
                ollama_messages_hybrid.append({"role": m["role"], "content": m["message"]})
            ollama_messages_hybrid.append({"role": "user", "content": f"{quote_ctx}{hybrid_user_prompt}".strip()})

            answer_parts = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL, messages=ollama_messages_hybrid,
                    stream=True, think=False,
                    options={"temperature": 0.3, "num_predict": 1200},
                ):
                    if chunk.message.content:
                        answer_parts.append(chunk.message.content)
                        yield _sse({"type": "token", "content": chunk.message.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_eval_count or 0
                        completion_tokens = chunk.eval_count or 0
            except Exception as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            answer = "".join(answer_parts).strip()
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            db.append_message(
                session_id, "assistant", answer,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                mode="hybrid", sources=hits, web_sources=results, cached=False, latency_ms=latency_ms,
            )
            set_cached(body.message, "hybrid", "hybrid", answer, hits, results, prompt_tokens, completion_tokens)
            yield _sse({
                "type": "done", "content": answer,
                "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                "cached": False, "latency_ms": latency_ms,
            })

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Evaluation endpoints ───────────────────────────────────────────────

@app.post("/api/evaluation/run")
def run_eval(body: EvalRequest) -> StreamingResponse:
    if not rag.index_ready():
        raise HTTPException(503, "RAG index not built.")

    def event_stream() -> Iterator[str]:
        try:
            for event in stream_evaluation(k=body.k):
                yield _sse(event)
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/evaluation/saved")
def get_saved_evaluations() -> list[dict]:
    return load_saved_metrics()


@app.get("/api/evaluation/summary")
def get_evaluation_summary() -> dict:
    """Read-only summary for the homepage: latest retrieval + RAGAS results."""
    return load_evaluation_summary()


@app.post("/api/evaluation/save")
def save_evaluation(body: SaveEvalRequest) -> dict:
    if not rag.index_ready():
        raise HTTPException(503, "RAG index not built.")
    summary, rows, elapsed = iter_evaluation(k=body.k)
    try:
        return save_named_snapshot(body.name, summary, rows, elapsed)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"
