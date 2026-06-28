# Jignasa

**Your own ChatGPT, running entirely on your laptop.**

Jignasa chats naturally, searches the live web, and answers questions about your own PDFs — all without sending a single byte to the cloud. No API keys, no subscriptions, no data leaving your machine.

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

Ask it anything. Jignasa figures out on its own whether your question is small talk, something answerable from your documents, something that needs a live web search, or both — then answers with sources, streamed live, token by token.

Everything runs on a local model via [Ollama](https://ollama.com) — there's no per-message cost, no rate limit from a provider, and no risk of your documents or conversations ever touching someone else's server.

### Modes

The mode selector above the input box has four buttons: **Auto**, **Knowledge**, **Web**, and **Hybrid**.

- **Auto** (default) — Jignasa classifies your message itself: plain conversation gets a casual reply with no retrieval at all; anything else routes to documents, web, or both
- **Knowledge** — answers strictly from your indexed PDFs, with page citations
- **Web** — live DuckDuckGo search, cited inline, no API key needed
- **Hybrid** — both at once, run concurrently, one answer citing both

### Under every response

- **Token counts** — input/output/total tokens for that exact reply
- **Latency** — wall-clock time for that response, shown as a badge
- **Cache hits** — a "Cached" badge when an answer came from the prompt cache instead of a fresh LLM call (instant, no re-generation)
- **Token cost calculator** — estimates what the whole conversation would have cost on GPT-4o, Claude, Gemini, etc. — useful context for why running locally is free, even though you're seeing real token numbers
- **Model settings** — swap between local Ollama (default) and your own OpenAI/Anthropic/Gemini key, per conversation

## Why it's worth a look

Most "chat with your docs" projects are a thin wrapper around a hosted API. Jignasa builds every layer itself:

- **A real RAG pipeline** — PDF parsing, structure-aware chunking that keeps page and section context, vector search, and query rewriting to actually find the right passage, not just a keyword match
- **Smart, not just scripted** — it classifies what kind of question you're asking and routes it automatically; you can also pin a mode manually
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
                       ┌──────────────┼──────────────┐
                       ▼              ▼               ▼
                  FAISS index   DuckDuckGo      SQLite cache
                  (your PDFs)    (live web)      + chat history
```

Every response streams token-by-token over Server-Sent Events, with the backend deciding per-message whether to use your documents, the web, both, or neither.

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
