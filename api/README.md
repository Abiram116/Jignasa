# api/ — FastAPI backend

This folder is the whole backend: routing, retrieval, the adaptive
tool-calling loop, memory, caching, and streaming. It's the largest folder
in the project, so this is an orientation map, not the deep-dive — for the
actual design decisions (why the ReAct loop looks the way it does, the two
grounding-fidelity case studies, the security audit), see
[`docs/TECHNICAL.md`](../docs/TECHNICAL.md) and
[`docs/AGENT_ROADMAP.md`](../docs/AGENT_ROADMAP.md).

| File | What it does |
|---|---|
| `main.py` | The FastAPI app: every route, SSE streaming, and the router that decides casual short-circuit vs. the adaptive loop for every mode. Start here to see how a request flows end-to-end. |
| `agent.py` | The hand-written ReAct (Reason + Act) loop — no LangChain. Given a message and which tools are pinned, decides per-turn whether to call `rag_search`, `web_search`, both, or neither. |
| `memory.py` | Persistent, cross-session memory of durable user facts (name, standing instructions) — extracted via an Ollama tool call after each turn, read back into every future system prompt. |
| `audit.py` | The structured audit trail (Stage 2.5): one `audit_log` row per decision, tool call, data access, or guardrail block, independent of the ephemeral per-message trace shown in the UI. |
| `intent.py` | The cheap heuristic that catches obvious small talk instantly, plus the prompt-injection/guardrail checks that can raise a user-facing `ValueError`. |
| `rag.py` | Document retrieval: loads the FAISS index, embeds the query, returns the top chunks and builds the RAG prompt. |
| `websearch.py` | Live DuckDuckGo search (no API key) and the web-mode prompt builder. |
| `query_transform.py` | Query rewriting and HyDE, applied before retrieval to close the gap between how a question is phrased and how the answer is phrased in the source documents. |
| `llm.py` | The provider abstraction: local Ollama by default, or a user-supplied OpenAI/Anthropic/Gemini key (BYOK) for exactly one request, never persisted. |
| `upload.py` | Lets a PDF be added or removed through the running app instead of the CLI `pipeline/` scripts — reuses the same parsing/indexing code, just triggered from a request instead of a terminal. |
| `db.py` | SQLite persistence for conversations and messages (WAL mode). |
| `cache.py` | SQLite-backed prompt cache — skips a full LLM call for a repeated query in the same mode. |
| `evaluation.py` | Backs `GET /api/evaluation/summary`, the live numbers shown on the homepage — reads whatever `scripts/evaluate_rag_metrics.py`/`evaluate_ragas.py` last actually produced, not a hardcoded number. |
| `security.py` | Session ID validation, per-IP rate limiting, and the security headers middleware. |
| `config.py` | Every path and tunable constant in one place — model names, file paths, iteration/token limits. |

## Why no per-file deep-dive here

Most of these files carry their own module docstring explaining *why* they
look the way they do (e.g. `agent.py`'s docstring on why this is hand-rolled
instead of LangChain, `cache.py`'s on the cache-key/TTL design) — read the
file itself for that. This README exists so a first-time reader can find
the right file in under a minute; `docs/TECHNICAL.md` is where the actual
engineering narrative (bugs found, evidence, fixes) lives.
