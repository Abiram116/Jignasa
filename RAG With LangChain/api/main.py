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

# ── Allowed origins: extend this list when deploying to production ────────
_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # "https://your-prod-domain.com",  # ← add prod origin here
]

app = FastAPI(title="Jijnasa PDF RAG API")

# Security headers must be registered BEFORE CORS so they apply everywhere
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],   # explicit — not wildcard
    allow_headers=["Content-Type", "Authorization"],
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    mode: str = Field(default="auto")
    quoted_text: str | None = Field(default=None, max_length=1000)


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
    """
    Save a partial (stopped mid-stream) assistant response to the DB.
    Called by the frontend when the user stops a long response that has
    enough content to be worth keeping (≥ 4 newlines).
    """
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


@app.post("/api/conversations/{session_id}/chat")
def post_chat(session_id: str, body: ChatRequest) -> StreamingResponse:
    # ── Validate session ID format ───────────────────────────────────
    validate_session_id(session_id)

    # ── Sanitise inputs ─────────────────────────────────────────────
    body.message = sanitise_text(body.message, max_length=2000)
    if body.quoted_text:
        body.quoted_text = sanitise_text(body.quoted_text, max_length=1000)

    # ── Guardrails (length + blocked patterns) ───────────────────────
    try:
        run_guardrails(body.message)
        if body.quoted_text:
            run_guardrails(body.quoted_text)
        # Structural prompt-injection check
        check_prompt_injection(body.message)
        if body.quoted_text:
            check_prompt_injection(body.quoted_text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    # ── Intent / Mode classification ─────────────────────────────────
    mode_requested = body.mode.lower().strip()
    if mode_requested not in ["auto", "docs", "web", "hybrid"]:
        mode_requested = "auto"

    intent = mode_requested
    if mode_requested == "auto":
        # Use Ollama tool-calling for smarter routing; falls back to heuristic
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
            # Even in explicit web mode, detect casual messages (hi, hello, etc.)
            # to avoid pointlessly searching the web for greetings.
            heuristic = classify_intent(body.message)
            if heuristic == "casual":
                resolved_mode = "casual"
                intent = "casual"
            else:
                intent = "web"
        elif resolved_mode == "hybrid":
            intent = "hybrid"

    # Downgrade RAG/Hybrid if index is not ready
    if resolved_mode in ["docs", "hybrid"] and not rag.index_ready():
        if resolved_mode == "docs":
            resolved_mode = "casual"
            intent = "casual"
        else:
            resolved_mode = "web"
            intent = "web"

    # ── Build quote context block ────────────────────────────────────
    def _quote_block(quoted: str | None) -> str:
        """
        Return a structured instruction block when the user has quoted part of
        a previous assistant response.  The LLM receives this before the main
        question so it knows exactly which excerpt the user is referring to.
        """
        if not quoted or not quoted.strip():
            return ""
        return (
            "\n\n[USER CONTEXT: The user has highlighted and quoted the following specific "
            "excerpt from a previous assistant message. Their question below refers to "
            "this excerpt specifically — address it directly and precisely.]\n"
            f"Quoted excerpt:\n\"\"\"\n{quoted.strip()}\n\"\"\"\n"
        )

    quote_ctx = _quote_block(body.quoted_text)

    # ── Snapshot history BEFORE writing the new user message ──────
    prior_history = db.load_messages(session_id)

    # ── Title auto-set on first message ────────────────────────────
    if not prior_history:
        words = body.message.strip().split()[:6]
        db.set_title(session_id, " ".join(words).title() if words else "New Chat")

    # Store the display form so the conversation renders correctly when reloaded.
    # If the user quoted text, prepend it as a blockquote so it's visible in history.
    display_message = (
        f"> {body.quoted_text.strip()}\n\n{body.message}"
        if body.quoted_text and body.quoted_text.strip()
        else body.message
    )
    db.append_message(session_id, "user", display_message)

    # ── Build event stream ──────────────────────────────────────────
    def event_stream() -> Iterator[str]:
        stream_start = time.monotonic()

        # Always tell the frontend which mode we're in
        yield _sse({"type": "intent", "mode": intent})

        # ── Check Cache (skip for casual) ───────────────────────────
        if resolved_mode != "casual":
            cached = get_cached(body.message, resolved_mode)
            if cached is not None:
                latency_ms = int((time.monotonic() - stream_start) * 1000)
                yield _sse({"type": "cached", "is_cached": True})
                if cached.get("sources"):
                    yield _sse({"type": "sources", "sources": cached["sources"]})
                if cached.get("web_sources"):
                    yield _sse({"type": "web_sources", "sources": cached["web_sources"]})

                # Stream cached content chunk by chunk with delay
                res_text = cached["response"]
                chunk_sz = 15
                for idx in range(0, len(res_text), chunk_sz):
                    yield _sse({"type": "token", "content": res_text[idx:idx+chunk_sz]})
                    time.sleep(0.005)

                db.append_message(
                    session_id,
                    "assistant",
                    res_text,
                    prompt_tokens=cached["prompt_tokens"],
                    completion_tokens=cached["completion_tokens"],
                    mode=intent,
                    sources=cached["sources"],
                    web_sources=cached["web_sources"],
                    cached=True,
                    latency_ms=latency_ms,
                )
                yield _sse({
                    "type": "done",
                    "content": res_text,
                    "prompt_tokens": cached["prompt_tokens"],
                    "completion_tokens": cached["completion_tokens"],
                    "cached": True,
                    "latency_ms": latency_ms,
                })
                return

        # ── CASUAL: direct conversation, no retrieval ───────────────
        if resolved_mode == "casual":
            casual_system = (
                "You are Jijnasa, a friendly and helpful AI assistant. "
                "Format your responses using Markdown: use **bold** for emphasis, "
                "`inline code` for code snippets, ```language\ncode\n``` fenced blocks for "
                "multi-line code or commands, bullet points (- item) for lists, and "
                "numbered lists (1. item) for steps. Keep answers concise but well-structured."
            )
            ollama_messages: list[dict] = [{"role": "system", "content": casual_system}]
            for m in prior_history[-8:]:   # last 4 turns
                ollama_messages.append({"role": m["role"], "content": m["message"]})
            ollama_messages.append({"role": "user", "content": f"{quote_ctx}{body.message}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL,
                    messages=ollama_messages,
                    stream=True,
                    think=False,
                    options={"temperature": 0.7, "num_predict": 400},
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
                "type": "done",
                "content": answer,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached": False,
                "latency_ms": latency_ms,
            })

        # ── WEB: DuckDuckGo search → Qwen ─────────────────────────
        elif resolved_mode == "web":
            results = web_search(body.message, n=WEB_SEARCH_RESULT_COUNT)
            yield _sse({"type": "web_sources", "sources": results})

            web_system = (
                "You are Jijnasa, an AI assistant with access to live web search results. "
                "Answer questions using the search results provided. "
                "Format responses with Markdown: use **bold** for key points, bullet points "
                "(- item) for lists, numbered lists (1. item) for steps, "
                "```language\ncode\n``` fenced blocks for any code or commands, "
                "and `inline code` for technical terms. "
                "Cite sources by number [1], [2] etc. when relevant. "
                "Be thorough — the user asked for web results specifically."
            )
            web_user_prompt = build_web_prompt(body.message, results, [])
            ollama_messages_web: list[dict] = [{"role": "system", "content": web_system}]
            for m in prior_history[-6:]:
                ollama_messages_web.append({"role": m["role"], "content": m["message"]})
            ollama_messages_web.append({"role": "user", "content": f"{quote_ctx}{web_user_prompt}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL,
                    messages=ollama_messages_web,
                    stream=True,
                    think=False,
                    options={"temperature": 0.3, "num_predict": 700},
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
                "type": "done",
                "content": answer,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached": False,
                "latency_ms": latency_ms,
            })

        # ── RAG: query transform → FAISS → Qwen ────────────────────
        elif resolved_mode == "docs":
            try:
                hits, _transformed = search_with_transform(body.message)
            except FileNotFoundError as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            yield _sse({"type": "sources", "sources": hits})

            rag_system = (
                "You are Jijnasa, a precise document assistant. "
                "Answer questions using ONLY the context provided. "
                "Format responses with Markdown: use **bold** for key terms, "
                "bullet points (- item) for lists, numbered lists (1. item) for steps, "
                "```language\ncode\n``` fenced blocks for any code or commands, "
                "`inline code` for technical terms, and > blockquotes for direct quotes from documents. "
                "If the answer is not in the context, say exactly: "
                "\"I don't have enough information in the documents to answer that.\""
            )
            rag_user_prompt = build_prompt(body.message, hits, [])
            ollama_messages_rag: list[dict] = [{"role": "system", "content": rag_system}]
            for m in prior_history[-6:]:
                ollama_messages_rag.append({"role": m["role"], "content": m["message"]})
            ollama_messages_rag.append({"role": "user", "content": f"{quote_ctx}{rag_user_prompt}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL,
                    messages=ollama_messages_rag,
                    stream=True,
                    think=False,
                    options={"temperature": 0.2, "num_predict": 900},
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
                "type": "done",
                "content": answer,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached": False,
                "latency_ms": latency_ms,
            })

        # ── HYBRID: RAG + Web combined ──────────────────────────────
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

            hybrid_system = (
                "You are Jijnasa, a hybrid assistant with access to both local document context and live web search results. "
                "Answer questions by synthesizing information from both the document context and web search results provided. "
                "Format responses with Markdown: use **bold** for key points, bullet points (- item) for lists, "
                "numbered lists (1. item) for steps, ```language\ncode\n``` fenced blocks for code, and `inline code` for technical terms. "
                "Cite document sources as [source_name p.X] (e.g. [AI Engineering.pdf p.12]) and web sources as [Web X] (e.g. [Web 1]) when using their information. "
                "Be factual, thorough, and structure your response clearly."
            )

            doc_snippets = []
            for h in hits:
                doc_snippets.append(f"[{h['source']} p.{h.get('page_number')}] {h['text']}")
            doc_context = "\n\n".join(doc_snippets) or "No relevant document chunks were found."

            web_snippets = []
            for i, r in enumerate(results, start=1):
                web_snippets.append(f"[Web {i}] {r['title']}\nURL: {r['url']}\n{r['snippet']}")
            web_context = "\n\n".join(web_snippets) or "No web search results were found."

            hybrid_user_prompt = f"""Synthesize information from both the document context and web search results below to answer the question.

LOCAL DOCUMENT CONTEXT:
{doc_context}

WEB SEARCH RESULTS:
{web_context}

Question: {body.message}

Answer:"""

            ollama_messages_hybrid = [{"role": "system", "content": hybrid_system}]
            for m in prior_history[-6:]:
                ollama_messages_hybrid.append({"role": m["role"], "content": m["message"]})
            ollama_messages_hybrid.append({"role": "user", "content": f"{quote_ctx}{hybrid_user_prompt}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in chat(
                    model=OLLAMA_MODEL,
                    messages=ollama_messages_hybrid,
                    stream=True,
                    think=False,
                    options={"temperature": 0.3, "num_predict": 1000},
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
                mode="hybrid", sources=hits, web_sources=results, cached=False,
                latency_ms=latency_ms,
            )
            set_cached(body.message, "hybrid", "hybrid", answer, hits, results, prompt_tokens, completion_tokens)
            yield _sse({
                "type": "done",
                "content": answer,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached": False,
                "latency_ms": latency_ms,
            })

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Evaluation endpoints (unchanged) ──────────────────────────────────

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
