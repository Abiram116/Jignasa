# Jignasa

**A fully local AI assistant that reads your documents, searches the live web, and reasons over both — without a single byte leaving your machine.**

Jignasa is a complete RAG system built from first principles: a structure-aware document pipeline, a retrieval layer with measured (not assumed) accuracy, and a generation layer that's explicitly tuned to admit uncertainty rather than fabricate an answer. No API keys, no subscriptions, no cloud dependency by default.

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](pyproject.toml)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688)](api/)
[![React 19](https://img.shields.io/badge/frontend-React%2019-61DAFB)](web/)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20%7C%20qwen3%3A8b-black)](https://ollama.com)
[![FAISS](https://img.shields.io/badge/vector%20store-FAISS-009999)](rag_index/)
[![Docker ready](https://img.shields.io/badge/docker-self--host%20ready-2496ED)](docs/DEPLOYMENT.md)
[![BYOK supported](https://img.shields.io/badge/BYOK-OpenAI%20%7C%20Anthropic%20%7C%20Gemini-orange)](docs/TECHNICAL.md)

[**Live showcase →**](https://abiram116.github.io/Jignasa/) &nbsp;·&nbsp; [Quick Start](#quick-start) &nbsp;·&nbsp; [Technical deep-dive](docs/TECHNICAL.md)

---

## Demo

> 🎥 *Demo video coming soon — a full walkthrough of casual chat, document Q&A, live web search, and the hybrid mode will go here.*

<!-- Screenshots coming soon: homepage hero, a RAG-mode chat with sources, the live evaluation results. -->

## What it does

Ask it anything. Jignasa runs a small hand-written ReAct (Reason + Act) loop — no LangChain — that decides for itself, every turn, whether it needs to search your documents, search the web, both, or just answer directly. Pinning a mode doesn't force a search; it only changes which tools are on the table. "What's 2+2" in Knowledge mode gets a direct answer, not a pointless document search. Every answer streams live with sources, and a live "thinking" trace shows exactly which tool it called and why before the answer even starts.

It also remembers durable things you tell it — your name, a stated preference — across every future conversation, the same way ChatGPT's memory works: sparingly, only for identity-level facts, never a running summary of what you asked about. You can see and delete everything it remembers from the sidebar.

Everything runs on a local model via [Ollama](https://ollama.com) — there's no per-message cost, no rate limit from a provider, and no risk of your documents or conversations ever touching someone else's server.

### Modes

The mode selector above the input box has four buttons: **Auto**, **Knowledge**, **Web**, and **Hybrid**. All four run through the same adaptive loop — the difference is only which tools are available to it:

- **Auto** (default) — a cheap heuristic catches obvious small talk instantly; everything else goes to the loop with both tools available
- **Knowledge** — only document search is available; a genuine miss gets an honest "not in your documents" answer, not a fabricated one
- **Web** — only live DuckDuckGo search is available, cited inline, no API key needed
- **Hybrid** — both tools available; the loop decides whether it needs one, both, or (for trivial questions) neither

The badge under each answer always reflects what actually happened that turn (PDF RAG / Web / Hybrid / Chat), never which button you pressed.

### Under every response

- **Live thinking trace** — a "Thought for N steps" panel shows each tool call the loop made and its stated reasoning, live as it happens, collapsing into history once the answer starts
- **Token counts** — input/output/total tokens for that exact reply
- **Latency** — wall-clock time for that response, shown as a badge
- **Cache hits** — a "Cached" badge when an answer came from the prompt cache instead of a fresh LLM call (instant, no re-generation)
- **Token cost calculator** — estimates what the whole conversation would have cost on GPT-4o, Claude, Gemini, etc. — useful context for why running locally is free, even though you're seeing real token numbers
- **Model settings** — swap between local Ollama (default) and your own OpenAI/Anthropic/Gemini key, per conversation
- **Memory** — a sidebar panel showing everything Jignasa has remembered about you, with per-item delete and clear-all

## Why it's worth a look

Most "chat with your docs" projects are a thin wrapper around a hosted API. Jignasa builds every layer itself:

- **A real RAG pipeline** — PDF parsing, structure-aware chunking that keeps page and section context, vector search, and query rewriting to actually find the right passage, not just a keyword match
- **Genuinely agentic, not a routing table** — a hand-written ReAct loop decides per-turn whether to call a tool at all, the same mechanism Claude's own tool use runs on. No LangChain, no framework magic — see [`docs/AGENT_ROADMAP.md`](docs/AGENT_ROADMAP.md) for how this was built and [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for two real "found it, measured it, fixed it" case studies from tuning it
- **Honest about uncertainty** — the model is explicitly prompted to say "I don't know" rather than make something up, and citations are verified before being shown
- **Measured, not just claimed** — retrieval quality and answer quality are both benchmarked against real test questions, and the results are shown live on the homepage, not just asserted in this README
- **A genuinely designed interface** — not a default template: custom type, a real motion/scroll system, and a UI built to feel as considered as the backend (see [`web/README.md`](web/README.md))
- **Optional cloud fallback** — if you'd rather not run a local model, plug in your own OpenAI, Anthropic, or Gemini key instead. Your key only ever goes from your browser to your own backend to the provider — never logged, never saved.

## How it's built

| Layer | Technology |
|---|---|
| LLM | [Qwen3:8b](https://ollama.com/library/qwen3) via Ollama (fully local) |
| Embeddings | `BAAI/bge-base-en-v1.5` |
| Vector Store | FAISS |
| PDF Parsing | Docling |
| Backend | FastAPI + Uvicorn |
| Frontend | React 19 + TypeScript + Vite |
| Web Search | DuckDuckGo (no API key) |
| Storage | SQLite (WAL mode) |

```
Browser (React)  ──HTTP/SSE──▶  FastAPI Backend  ──▶  Ollama (qwen3:8b)
                                      │
                         ┌────────────┴────────────┐
                         ▼                          ▼
                  adaptive ReAct loop          SQLite
                  (api/agent.py)          chat history, prompt
                         │                 cache, persistent
              ┌──────────┴──────────┐      memory
              ▼                     ▼
        FAISS index            DuckDuckGo
        (your PDFs)             (live web)
```

Every response streams token-by-token over Server-Sent Events. The loop decides per-turn which tool(s) it actually needs — the diagram's two tool paths are a menu, not a fixed pipeline every message runs through.

**Why exact search (FAISS `IndexFlatIP`) instead of an approximate index (IVF/HNSW):** approximate indexes trade a small amount of accuracy for speed, but only start paying off at roughly 100K+ vectors — below that, exact brute-force cosine search is already sub-millisecond *and* has zero recall loss, so it's strictly more correct, not less production-grade. At this project's scale (a few thousand chunks per knowledge base), approximate search would be a pure downgrade with no real speed benefit. See [`pipeline/README.md`](pipeline/README.md) for the full reasoning.

## Quick start

```bash
# 1. Python deps
uv sync

# 2. Frontend deps
cd web && npm install && cd ..

# 3. Make sure Ollama is running with the model pulled
ollama pull qwen3:8b

# 4. Build the document index (one-time, or whenever your PDFs change)
python3 pipeline/01_profile_corpus.py
python3 pipeline/02_parse_and_chunk.py
python3 pipeline/03_build_index.py

# 5. Run it
./run_all.sh
```

Open `http://localhost:5173`. The API runs separately at `http://localhost:8000`.

Drop your own PDFs into `knowledge-base/` before step 4 — see [`knowledge-base/README.md`](knowledge-base/README.md). (Skip this and the scripts will tell you clearly what to do next, not crash.) PDFs can also be added later through the running app itself — an "Add document" button in the chat sidebar uploads and indexes a file without touching the terminal.

**Prefer Docker?** One `docker compose up` runs the whole stack — backend, frontend, and Ollama — with no Python/Node toolchain needed on your machine. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Project layout

```
Jignasa/
├── api/             ← FastAPI backend (routing, retrieval, caching, streaming)
├── web/             ← React frontend (see web/README.md for the design system)
├── pipeline/        ← Builds the document index from PDFs (see pipeline/README.md)
├── rag_index/       ← Generated vector index (see rag_index/README.md)
├── knowledge-base/  ← Your source PDFs, not in git (see knowledge-base/README.md)
├── data/            ← Evaluation question sets & saved runs (see data/README.md)
├── scripts/         ← Evaluation utilities used by the API (see scripts/README.md)
├── archive/         ← Retired code, kept for reference (see archive/README.md)
├── docs/            ← Technical deep-dive (docs/TECHNICAL.md) and Docker self-host guide (docs/DEPLOYMENT.md)
└── run_all.sh       ← Start backend + frontend together
```

## About this project

Built end-to-end — RAG pipeline, evaluation, backend, and frontend — by **Abiram Mandava**, as a portfolio project to show what a complete, production-minded AI application looks like beyond a single notebook.

📧 [sreeabirammandava@gmail.com](mailto:sreeabirammandava@gmail.com) &nbsp;·&nbsp; 📞 +91 8309816750 &nbsp;·&nbsp; [GitHub Pages showcase](https://abiram116.github.io/Jignasa/)

Licensed under [MIT](LICENSE) — use it, fork it, learn from it.

---

*Looking for implementation details — prompt formats, SSE event schema, the motion/scroll system, or a real debugging case study (a grounding-fidelity bug found, root-caused, and fixed with evidence)? See [`docs/TECHNICAL.md`](docs/TECHNICAL.md). Each non-obvious folder also has its own short README.*
