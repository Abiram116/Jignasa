# Jignasa

**A fully local, privacy-first AI assistant** — chat naturally, search the web in real time, and ask questions about your own PDFs, with everything running on your machine. No API keys, no data leaving your laptop, no cloud LLM bill.

Built around a local [Ollama](https://ollama.com) model (`qwen3:8b`), a from-scratch RAG pipeline over your documents, and a ChatGPT-style React interface — not a wrapper around someone else's API.

---

## Why this exists

Most "AI chat with your docs" demos are a thin call to a hosted API. Jignasa runs the entire stack locally: parsing, chunking, embedding, retrieval, and generation. It auto-detects whether a question needs your documents, the live web, both, or neither — and answers accordingly, citing its sources either way.

## Highlights

- **Modern chat UI** — ChatGPT-style layout, live token streaming, quoting, message editing, code blocks with copy buttons
- **Smart mode routing** — auto-detects casual chat vs. document Q&A vs. web search vs. hybrid, or pick a mode manually
- **Local RAG pipeline** — Docling-parsed PDFs, structure-aware chunking (page + section metadata preserved), FAISS retrieval, query rewriting + HyDE for better recall
- **Live web search** — grounded answers with clickable citations, no API key required
- **Cost & token tracking** — see exactly what each response would cost on commercial APIs (GPT-4o, Claude, Gemini, etc.) even though you're paying $0 running locally
- **Built-in evaluation** — retrieval benchmarking against a curated question set, with results you can save and compare over time

## Stack

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

## Architecture

```
Browser (React)  ──HTTP/SSE──▶  FastAPI Backend  ──▶  Ollama (qwen3:8b)
                                      │
                       ┌──────────────┼──────────────┐
                       ▼              ▼               ▼
                  FAISS index   DuckDuckGo      SQLite cache
                  (your PDFs)    (live web)      + chat history
```

Every response streams token-by-token over Server-Sent Events, with the backend deciding per-message whether to hit your documents, the web, both, or just chat.

## Project layout

```
Jignasa/
├── api/             ← FastAPI backend (routing, retrieval, caching, streaming)
├── web/             ← React frontend
├── pipeline/        ← Builds the document index from PDFs (see pipeline/README.md)
├── rag_index/        ← Generated vector index (see rag_index/README.md)
├── knowledge-base/  ← Your source PDFs, not in git (see knowledge-base/README.md)
├── data/            ← Evaluation question sets & saved runs (see data/README.md)
├── scripts/         ← Evaluation utilities used by the API (see scripts/README.md)
├── archive/         ← Retired code, kept for reference (see archive/README.md)
└── run_all.sh       ← Start backend + frontend together
```

## Quick start

```bash
# 1. Python deps
uv sync

# 2. Frontend deps
cd web && npm install && cd ..

# 3. Make sure Ollama is running with the model pulled
ollama pull qwen3:8b

# 4. Build the document index (one-time, or whenever PDFs change)
python3 pipeline/01_profile_corpus.py
python3 pipeline/02_parse_and_chunk.py
python3 pipeline/03_build_index.py

# 5. Run it
./run_all.sh
```

Then open `http://localhost:5173`. The API runs separately at `http://localhost:8000`.

Drop your own PDFs into `knowledge-base/` before step 4 — see `knowledge-base/README.md`.

---

*Looking for implementation details — prompt formats, SSE event schema, caching internals, evaluation methodology? A deeper technical write-up is coming as the project matures. For now, the code itself (`api/`, `pipeline/`) is the source of truth, and each non-obvious folder has its own short README.*
