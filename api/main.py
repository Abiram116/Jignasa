from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from api import db, memory, rag
from api.agent import AgentResult, AgentStep, run_agent_loop
from api.cache import init_cache, get_cached, set_cached
from api.config import MEMORY_MANAGE_LIMIT, TOP_K, WEB_SEARCH_RESULT_COUNT
from api.evaluation import (
    EVAL_DESCRIPTION,
    EVAL_TYPE,
    iter_evaluation,
    load_evaluation_summary,
    load_saved_metrics,
    save_named_snapshot,
    stream_evaluation,
)
from api.intent import classify_intent, run_guardrails
from api.llm import stream_chat
from api.rag import build_prompt, search_with_transform
from api.security import (
    SecurityHeadersMiddleware,
    check_prompt_injection,
    neutralise_injection,
    sanitise_text,
    validate_session_id,
)
from api.upload import list_knowledge_base_files, save_uploaded_pdf, stream_upload_and_reindex, delete_knowledge_base_file
from api.websearch import build_web_prompt, web_search

logger = logging.getLogger("jignasa")

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


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc: Exception):
    # Last-resort net: any exception that escapes a route handler without
    # being caught lands here instead of FastAPI's default (which can
    # include internal detail depending on config). Full detail goes to
    # the server log only; the client gets a clean, generic message.
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Please try again."})


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    mode: str = Field(default="auto")
    quoted_text: str | None = Field(default=None, max_length=1000)
    # BYOK (bring your own key): used only for this request's chat() calls,
    # never written to db.append_message, set_cached, or logs.
    llm_provider: str = Field(default="ollama")
    llm_api_key: str | None = Field(default=None, max_length=300)
    llm_model: str | None = Field(default=None, max_length=100)


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
    memory.init_memory()


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
- Keep responses concise unless depth is explicitly needed
- If you're not actually confident about a specific factual claim (a name, date, statistic, or niche detail), say so plainly rather than guessing with false confidence — a hedged "I'm not certain, but..." is more useful than a fluent-sounding wrong answer"""

RAG_SYSTEM = """You are Jignasa, a precise document assistant that answers questions from the provided document context.

CORE RULES:
- Answer ONLY from the context provided below
- If the answer is not in the context, say exactly: "I don't have enough information in the documents to answer that."
- If the context only partially covers the question, say clearly what IS supported by the context and what isn't, rather than stretching thin evidence into a complete-sounding answer
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
- For any specific number, version, date, price, or statistic you state: find the exact result whose title or snippet contains that exact value, and cite only that result. If no single result's text explicitly contains the value you're about to write, do not write it as fact — say the precise figure isn't confirmed in the results instead of citing the closest-sounding source anyway. Do not fill in a number from your own training data and attach a citation to it — a wrong citation is worse than no citation
- Synthesize information across sources rather than just repeating one
- Acknowledge when sources conflict or are unclear
- Be factual and accurate — do not add information not in the results
- If the results are tangential, weak, or don't clearly identify a single answer (common for "what was that thing called" recall questions), do NOT force a confident single answer from a weak match. Instead say the results aren't conclusive and list the 2-3 most plausible candidates from what the results actually support, so the user can recognize the right one — this is more useful than committing to a guess that sounds certain but isn't grounded

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
- Cite document sources exactly as they appear in the context, e.g. [filename p.N], and web sources as [N] (e.g. [1], [2])
- For any specific number, version, date, price, or statistic you state: find the exact source (document chunk or web result) whose text contains that exact value, and cite only that one. If nothing in the provided context explicitly contains the value you're about to write, do not write it as fact — say the precise figure isn't confirmed in the provided sources instead of citing the closest-sounding one anyway. Do not fill in a number from your own training data and attach a citation to it
- Prioritize document context for domain-specific questions; web for current/live information
- Acknowledge when sources complement or contradict each other
- Never hallucinate — only use what's in the provided context
- If both the document context and web results are weak, tangential, or only partially answer the question, say so directly rather than forcing a confident-sounding answer out of thin combined evidence — present the best-supported partial answer or candidates instead of a single overreaching claim

FORMATTING RULES:
- Use **bold** for key points and important terms
- Use bullet points (- item) for lists
- Use numbered lists (1. item) for steps
- Use ```language\\ncode\\n``` fenced blocks for code
- Structure with clear sections for complex answers
- Lead with the most important information"""




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

    if mode_requested == "auto":
        heuristic = classify_intent(body.message)
        resolved_mode = "casual" if heuristic == "casual" else "agent"
    else:
        resolved_mode = mode_requested

    _PIN_TOOL_SCOPE = {
        "agent":  (True, True),
        "hybrid": (True, True),
        "docs":   (True, False),
        "web":    (False, True),
    }

    if resolved_mode in _PIN_TOOL_SCOPE:
        pin_allow_rag, pin_allow_web = _PIN_TOOL_SCOPE[resolved_mode]
        if pin_allow_rag and not rag.index_ready():
            pin_allow_rag = False
            if resolved_mode == "docs":
                resolved_mode = "casual"
        allow_rag, allow_web = pin_allow_rag, pin_allow_web
    else:
        allow_rag = allow_web = False 

    _EARLY_INTENT_LABEL = {"docs": "rag", "web": "web", "hybrid": "hybrid"}
    intent = "casual" if resolved_mode == "casual" else _EARLY_INTENT_LABEL.get(resolved_mode, "casual")

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
    # Read-before-answering memory (Stage 1): shared by the casual and agent
    # branches below. Global/cross-session, not scoped to this conversation.
    memory_block = memory.format_memory_block(memory.list_memories())
    # Populated by event_stream() at the end of casual/agent branches only --
    # extraction is scoped to the router-driven auto-mode experience, not
    # explicitly-pinned docs/web/hybrid modes. Read by the background task
    # constructed at the bottom of this function, after the stream finishes.
    memory_holder: dict = {}

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
                    mode=cached["intent"], sources=cached["sources"],
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
            ollama_messages: list[dict] = [{"role": "system", "content": CASUAL_SYSTEM + memory_block}]
            for m in prior_history[-8:]:
                ollama_messages.append({"role": m["role"], "content": m["message"]})
            ollama_messages.append({"role": "user", "content": f"{quote_ctx}{body.message}".strip()})

            answer_parts: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in stream_chat(
                    ollama_messages, temperature=0.7, num_predict=600,
                    provider=body.llm_provider, api_key=body.llm_api_key, model=body.llm_model,
                ):
                    if chunk.content:
                        answer_parts.append(chunk.content)
                        yield _sse({"type": "token", "content": chunk.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_tokens
                        completion_tokens = chunk.completion_tokens
            except Exception:
                logger.exception("LLM call failed in casual mode")
                yield _sse({"type": "error", "message": "Something went wrong generating a response. Please try again."})
                return

            answer = "".join(answer_parts).strip()
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            memory_holder["session_id"] = session_id
            memory_holder["user_message"] = body.message
            memory_holder["assistant_answer"] = answer
            yield from _finish_response(
                session_id, answer, prompt_tokens, completion_tokens, "casual", latency_ms,
            )

        # ── UNIFIED TOOL-CALLING BRANCH (docs/web/hybrid/agent pins) ──
        else:
            agent_result: AgentResult | None = None
            try:
                for item in run_agent_loop(
                    body.message, prior_history, memory_block,
                    allow_rag=allow_rag, allow_web=allow_web,
                ):
                    if isinstance(item, AgentStep):
                        yield _sse(item.to_dict())
                    else:
                        agent_result = item
            except Exception:
                logger.exception("Agent loop failed")
                yield _sse({"type": "error", "message": "Something went wrong while reasoning about your question. Please try again."})
                return

            assert agent_result is not None  # run_agent_loop always yields exactly one AgentResult last

            if agent_result.sources:
                yield _sse({"type": "sources", "sources": agent_result.sources})
            if agent_result.web_sources:
                yield _sse({"type": "web_sources", "sources": agent_result.web_sources})

            rag_attempted = any(t.get("tool") == "rag_search" for t in agent_result.trace if t.get("stage") == "tool_call")
            web_attempted = any(t.get("tool") == "web_search" for t in agent_result.trace if t.get("stage") == "tool_call")

            if agent_result.sources and agent_result.web_sources:
                outcome_label = "hybrid"
                final_system = HYBRID_SYSTEM + memory_block
                final_user_prompt = f"""Synthesize information from both the document context and web search results below to answer the question.

{agent_result.observations_text}

Question: {body.message}

Answer:"""
            elif agent_result.web_sources:
                outcome_label = "web"
                final_system = WEB_SYSTEM + memory_block
                final_user_prompt = build_web_prompt(body.message, agent_result.web_sources, [])
            elif agent_result.sources:
                outcome_label = "rag"
                final_system = RAG_SYSTEM + memory_block
                final_user_prompt = build_prompt(body.message, agent_result.sources, [])
            elif rag_attempted and web_attempted:
                outcome_label = "hybrid"
                final_system = HYBRID_SYSTEM + memory_block
                final_user_prompt = f"""Synthesize information from both the document context and web search results below to answer the question.

{agent_result.observations_text}

Question: {body.message}

Answer:"""
            elif rag_attempted:
                outcome_label = "rag"
                final_system = RAG_SYSTEM + memory_block
                final_user_prompt = build_prompt(body.message, [], [])
            elif web_attempted:
                outcome_label = "web"
                final_system = WEB_SYSTEM + memory_block
                final_user_prompt = build_web_prompt(body.message, [], [])
            else:
                outcome_label = "casual"
                final_system = CASUAL_SYSTEM + memory_block
                final_user_prompt = body.message

            yield _sse({"type": "intent", "mode": outcome_label})

            ollama_messages_final: list[dict] = [{"role": "system", "content": final_system}]
            for m in prior_history[-6:]:
                ollama_messages_final.append({"role": m["role"], "content": m["message"]})
            ollama_messages_final.append({"role": "user", "content": f"{quote_ctx}{final_user_prompt}".strip()})

            answer_parts = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for chunk in stream_chat(
                    ollama_messages_final, temperature=0.3, num_predict=1200,
                    provider=body.llm_provider, api_key=body.llm_api_key, model=body.llm_model,
                ):
                    if chunk.content:
                        answer_parts.append(chunk.content)
                        yield _sse({"type": "token", "content": chunk.content})
                    if chunk.done:
                        prompt_tokens = chunk.prompt_tokens
                        completion_tokens = chunk.completion_tokens
            except Exception:
                logger.exception("LLM call failed in unified tool-calling branch")
                yield _sse({"type": "error", "message": "Something went wrong generating a response. Please try again."})
                return

            answer = "".join(answer_parts).strip()
            if agent_result.web_sources:
                answer = _linkify_web_citations(answer, agent_result.web_sources)
            latency_ms = int((time.monotonic() - stream_start) * 1000)
            set_cached(
                body.message, resolved_mode, outcome_label, answer,
                agent_result.sources, agent_result.web_sources, prompt_tokens, completion_tokens,
            )
            memory_holder["session_id"] = session_id
            memory_holder["user_message"] = body.message
            memory_holder["assistant_answer"] = answer
            yield from _finish_response(
                session_id, answer, prompt_tokens, completion_tokens, outcome_label, latency_ms,
                sources=agent_result.sources, web_sources=agent_result.web_sources,
                agent_trace=agent_result.trace,
            )

    def _run_memory_extraction() -> None:
        # Runs only after event_stream() has fully completed and been sent
        # (Starlette awaits a StreamingResponse's background task strictly
        # after the body finishes) -- so it can never add latency to, or
        # surface an error into, the visible response.
        if not memory_holder.get("assistant_answer"):
            return  # stream errored out, or hit a cache/ask-web-search early return
        try:
            memory.extract_memory(
                memory_holder["user_message"],
                memory_holder["assistant_answer"],
                session_id=memory_holder.get("session_id"),
            )
        except Exception:
            logger.exception("Background memory extraction failed")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        background=BackgroundTask(_run_memory_extraction),
    )


# ── Evaluation endpoints ───────────────────────────────────────────────

@app.post("/api/evaluation/run")
def run_eval(body: EvalRequest) -> StreamingResponse:
    if not rag.index_ready():
        raise HTTPException(503, "RAG index not built.")

    def event_stream() -> Iterator[str]:
        try:
            for event in stream_evaluation(k=body.k):
                yield _sse(event)
        except Exception:
            logger.exception("Evaluation run failed")
            yield _sse({"type": "error", "message": "Something went wrong running the evaluation. Please try again."})

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


# ── Persistent memory management ────────────────────────────────────────
# View/delete surface for the Stage 1 memory core -- lets the user see
# and correct what Jignasa remembers, the same way ChatGPT/Claude expose
# saved memories, instead of it being an opaque background process.

@app.get("/api/memory")
def get_memory() -> list[dict]:
    return memory.list_memories(limit=MEMORY_MANAGE_LIMIT)


@app.delete("/api/memory/{memory_id}")
def delete_memory_route(memory_id: int) -> dict:
    memory.delete_memory(memory_id)
    return {"ok": True}


@app.delete("/api/memory")
def clear_memory_route() -> dict:
    deleted = memory.clear_memories()
    return {"ok": True, "deleted": deleted}


# ── Knowledge-base upload ────────────────────────────────────────────────

@app.get("/api/knowledge-base/files")
def get_knowledge_base_files() -> list[dict]:
    return list_knowledge_base_files()

@app.delete("/api/knowledge-base/files/{filename}")
def delete_knowledge_base_file_route(filename: str) -> dict:
    delete_knowledge_base_file(filename)
    return {"ok": True}


@app.post("/api/knowledge-base/upload")
async def upload_knowledge_base_file(file: UploadFile = File(...)) -> StreamingResponse:
    pdf_path = save_uploaded_pdf(file)

    def event_stream() -> Iterator[str]:
        for event in stream_upload_and_reindex(pdf_path):
            yield _sse(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Static frontend (Docker/self-host only) ─────────────────────────────
# In local dev, the frontend runs separately via `vite dev` (run_all.sh) and
# this block does nothing -- web/dist/ only exists after `npm run build`,
# which the Dockerfile runs before this image is built. Registered last so
# the catch-all route can never shadow an /api/* route defined above.
_DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

if _DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=_DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        # `full_path` is attacker-controlled and Starlette's `:path` converter
        # passes "../" segments through literally, so resolve() + relative_to()
        # is required here -- without it, a request like /../../api/main.py
        # escapes _DIST_DIR and serves arbitrary files on the host.
        requested = (_DIST_DIR / full_path).resolve()
        try:
            requested.relative_to(_DIST_DIR.resolve())
        except ValueError:
            raise HTTPException(404, "Not found")
        if requested.is_file():
            return FileResponse(requested)
        # React Router routes (e.g. /chat) aren't real files -- fall back
        # to index.html so client-side routing can take over.
        return FileResponse(_DIST_DIR / "index.html")


def _linkify_web_citations(answer: str, web_sources: list[dict]) -> str:
    """
    Replace [N] citations with clickable markdown links [[N]](url).

    Done server-side, before caching/persisting, so the converted version
    is what gets stored and returned everywhere -- live stream, cache hit,
    and reload from history all see the same linked text. Previously this
    conversion only happened in the frontend after a live stream finished,
    so it was lost the moment a conversation was reloaded (the DB had only
    ever stored the raw [N] text).
    """
    if not web_sources:
        return answer

    def replace(m: re.Match[str]) -> str:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(web_sources):
            return f"[[{m.group(1)}]]({web_sources[idx]['url']})"
        return m.group(0)

    return re.sub(r"\[(\d+)\]", replace, answer)


def _finish_response(
    session_id: str,
    answer: str,
    prompt_tokens: int,
    completion_tokens: int,
    mode: str,
    latency_ms: int,
    *,
    sources: list | None = None,
    web_sources: list | None = None,
    agent_trace: list | None = None,
) -> Iterator[str]:
    """
    Persist the assistant's answer and yield the terminal `done` event.

    Why this exists: previously each mode branch called db.append_message()
    directly with no error handling. If that write failed (SQLite locked,
    disk issue) after tokens had already streamed to the client, the
    exception propagated out of the generator and the client never received
    a `done` or `error` event -- just a dead connection with no signal of
    what happened. This wraps the persist step so a failure still produces
    a terminal SSE event instead of silently hanging the stream.
    """
    try:
        db.append_message(
            session_id, "assistant", answer,
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            mode=mode, sources=sources, web_sources=web_sources,
            cached=False, latency_ms=latency_ms, agent_trace=agent_trace,
        )
    except Exception as exc:
        yield _sse({
            "type": "error",
            "message": f"Response generated but could not be saved: {exc}",
        })
        return
    yield _sse({
        "type": "done", "content": answer,
        "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
        "cached": False, "latency_ms": latency_ms,
    })
