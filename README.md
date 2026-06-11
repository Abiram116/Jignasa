# Jignasa — PDF RAG Assistant

> A fully local, privacy-first AI assistant that answers questions from your PDF documents, searches the web in real time, and chats naturally — all powered by a local [Ollama](https://ollama.com) model (`qwen3:8b`).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Upgraded Features](#upgraded-features)
   - [Segmented Mode Selector](#segmented-mode-selector)
   - [Prompt Cache](#prompt-cache)
   - [Token Tracking & Cost Calculator](#token-tracking--cost-calculator)
   - [Chat Renaming](#chat-renaming)
4. [How It All Works — Full Pipeline](#how-it-all-works--full-pipeline)
   - [Step 1 — Guardrails](#step-1--guardrails)
   - [Step 2 — Mode Routing](#step-2--mode-routing)
   - [Step 3 — Cache Check](#step-3--cache-check)
   - [Step 4a — Casual Chat](#step-4a--casual-chat)
   - [Step 4b — Web Search](#step-4b--web-search)
   - [Step 4c — PDF RAG](#step-4c--pdf-rag)
   - [Step 4d — Hybrid (RAG + Web)](#step-4d--hybrid-rag--web)
5. [Query Transformation Techniques](#query-transformation-techniques)
6. [Chat Memory](#chat-memory)
7. [Project Structure](#project-structure)
8. [Prerequisites](#prerequisites)
9. [Installation & Running](#installation--running)
10. [Configuration](#configuration)
11. [Evaluation](#evaluation)

---

## Overview

Jignasa is a **Retrieval-Augmented Generation (RAG)** application built with:

| Layer | Technology |
|---|---|
| LLM | [Qwen3:8b](https://ollama.com/library/qwen3) via Ollama (fully local) |
| Embeddings | `BAAI/bge-base-en-v1.5` via HuggingFace |
| Vector Store | FAISS (in-process, no external DB) |
| PDF Parsing | Docling |
| Backend API | FastAPI + Uvicorn (Python) |
| Frontend | React 19 + TypeScript + Vite |
| Web Search | DuckDuckGo (`ddgs` package, no API key) |
| Cache & Chat History | SQLite (optimized with WAL mode) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React)                          │
│  Sidebar  │  Chat Panel (segmented selector)  │  Cost Modal     │
└───────────────────────────┬─────────────────────────────────────┘
                            │  HTTP / SSE (Server-Sent Events)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
│                                                                 │
│  POST /api/conversations/{id}/chat                              │
│       │                                                         │
│       ├─ 1. Guardrails (api/intent.py)                          │
│       ├─ 2. Resolve Mode & Cache Check (api/cache.py)           │
│       │     If Cache Hit: Stream cached tokens & Return         │
│       │                                                         │
│       ├─ CASUAL ─► Ollama (direct chat, with history)           │
│       ├─ WEB    ─► DuckDuckGo ─► Ollama (web-grounded)          │
│       ├─ RAG    ─► Query Transform ─► FAISS ─► Ollama           │
│       └─ HYBRID ─► FAISS + DuckDuckGo ─► Ollama (synthesized)   │
│                                                                 │
│  PUT  /api/conversations/{id}      (rename conversation)        │
│  GET  /api/conversations/{id}/msgs (load history + token stats) │
│  POST /api/evaluation/run          (retrieval benchmark stream) │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Local Infrastructure                          │
│                                                                 │
│  Ollama (qwen3:8b)    ─  generates text (LLM inference)         │
│  FAISS index          ─  rag_index/faiss.index                  │
│  Embeddings (BGE)     ─  embedded via HuggingFace locally       │
│  SQLite (WAL mode)    ─  chat_history.sqlite3                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Upgraded Features

### Segmented Mode Selector
Users can bypass automatic intent classification using the Segmented Mode Selector control above the chat input box:
* **Auto-Detect**: Automatically classifies intent into casual conversation, PDF RAG, or Web Search using keywords.
* **PDF RAG**: Forces document retrieval from your FAISS index, bypassing classification.
* **Web Search**: Forces DuckDuckGo search to ground the answer in live web sources.
* **Hybrid**: Queries the FAISS index and DuckDuckGo search concurrently. Synthesizes document facts and web articles using cross-referenced citations (e.g. `[AI Engineering.pdf p.12]` and `[Web 1]`).

### Prompt Cache
To reduce local LLM load, successful queries in PDF RAG, Web Search, and Hybrid modes are cached in SQLite with configurable Time-To-Live (TTL) settings:
* **Docs & Hybrid Cache**: Kept fresh for **7 days**.
* **Web Search Cache**: Kept fresh for **6 hours** (since web search details go stale quickly).
* **Cached Stream Simulation**: When a cached hit occurs, results stream instantly to the user (simulated chunk-by-chunk for smooth typing animations) showing a green `Cached` badge.

### Token Tracking & Cost Calculator
* **Metadata Box**: Under every assistant response bubble, the exact input, output, and combined token count is displayed. It includes the estimated cost of that request if run on a standard commercial API (modeled on GPT-4o pricing).
* **Cost Calculator Modal**: A button in the sidebar pulls all messages for the current conversation and aggregates the total input and output tokens. It displays a comparison table showing what the conversation would cost if deployed in production using standard pricing rates:
  * **GPT-4o (Standard)**: $2.50 / $10.00 per 1M tokens
  * **Claude 3.5 Sonnet**: $3.00 / $15.00 per 1M tokens
  * **GPT-4o mini**: $0.15 / $0.60 per 1M tokens
  * **Gemini 1.5 Flash**: $0.075 / $0.30 per 1M tokens
  * **Llama 3.1 70B (Groq)**: $0.59 / $0.79 per 1M tokens
* **Persistent Stats**: Token stats and cached flags are saved in the SQLite `chats` table. Reloading the page or switching chats preserves all token statistics.

### Chat Renaming
* Users can rename conversations by clicking the pencil/edit icon in the sidebar (next to each conversation) or directly in the chat panel header.
* Triggers a native prompt that commits the title update instantly to SQLite and refreshes the React state.

---

## How It All Works — Full Pipeline

### Step 1 — Guardrails

**File:** `api/intent.py` → `run_guardrails()`

Before routing, the message passes through a guardrail validation:

| Check | Rule | Response if violated |
|---|---|---|
| Empty message | Length < 1 char | HTTP 400: "Message is empty" |
| Too long | Length > 2000 chars | HTTP 400: "Message is too long" |
| Jailbreak patterns | e.g. "ignore previous instructions", "act as if you" | HTTP 400: "Safety filter flagged" |

---

### Step 2 — Mode Routing

**File:** `api/main.py` → `post_chat()`

Based on the Segmented Mode Selector:
- **Auto**: Calls `classify_intent()` to decide between `casual`, `web`, or `rag`.
- **Docs**: Bypasses classifier and routes to `docs`.
- **Web**: Bypasses classifier and routes to `web`.
- **Hybrid**: Routes to `hybrid`.

If the FAISS index is not built and RAG or Hybrid is requested, the system automatically downgrades to casual chat or web search.

---

### Step 3 — Cache Check

**File:** `api/cache.py` → `get_cached()`

For all modes except casual, the system queries the `prompt_cache` table:
* Hash Key: `sha256(normalize(query) + "|" + mode)[:24]`.
* If found and the `expires_at` timestamp is in the future, it streams the cached response and finishes, skipping Ollama execution entirely.
* If missing or expired, it continues to run Ollama and commits the final response to the cache via `set_cached()`.

---

### Step 4a — Casual Chat

1. Builds Ollama message history list:
   ```
   [system: "You are Jijnasa...use Markdown formatting..."]
   [user: previous message 1]
   [assistant: previous reply 1]
   ...
   [user: current message]
   ```
2. Calls Ollama with `temperature=0.7`.
3. Read final token metrics (`prompt_eval_count` and `eval_count`) from the last SSE chunk.
4. Appends assistant message to database along with token statistics.

---

### Step 4b — Web Search

1. Runs DuckDuckGo text search to fetch up to **8 web results** (title, URL, snippet).
2. Emits web source list to frontend.
3. Formats prompt:
   ```
   [system: "You are Jijnasa with live web access...cite [1],[2]..."]
   [prior turns...]
   [user: "Web search results:\n[1] Title\nURL\nSnippet\n...\n\nQuestion: {message}"]
   ```
4. Calls Ollama with `temperature=0.3` and streams response.
5. Saves to cache and database.

---

### Step 4c — PDF RAG

1. **Dynamic Query Transformation**:
   - If query <= 4 words: bypasses rewrite and HyDE completely (FAISS search runs instantly).
   - If query is self-contained (no conversational pronouns): bypasses `rewrite_query` (saves 1 LLM call) and directly runs `generate_hypothetical_document` (HyDE).
   - If query contains conversational pronouns (*it, they, this, that*): runs `rewrite_query` and then `generate_hypothetical_document` (HyDE).
2. Queries the FAISS index (`rag_index/faiss.index`) to fetch top **5 chunks**.
3. Emits document sources to frontend.
4. Formats prompt:
   ```
   [system: "You are Jijnasa, a precise document assistant. Answer ONLY from context..."]
   [prior turns...]
   [user: "Document context:\n[source.pdf p.3] chunk text...\n\nQuestion: {message}"]
   ```
5. Calls Ollama with `temperature=0.2`. If context lacks the answer, Jijnasa replies:
   > "I don't have enough information in the documents to answer that."

---

### Step 4d — Hybrid (RAG + Web)

1. **Concurrent Search**: Queries the FAISS index and searches DuckDuckGo concurrently in parallel threads using a `ThreadPoolExecutor` to eliminate sequential wait times.
2. Emits both document and web sources to the frontend.
3. Formats hybrid prompt:
   ```
   [system: "You are Jijnasa, a hybrid assistant. Synthesize context and web search..."]
   [prior turns...]
   [user: "LOCAL DOCUMENT CONTEXT:\n[doc.pdf p.2] text...\n\nWEB SEARCH RESULTS:\n[Web 1] Title...\n\nQuestion: {message}"]
   ```
4. Calls Ollama with `temperature=0.3`.
5. Synthesizes a unified response combining local papers with live web links.

---

## Query Transformation Techniques

| Technique | What it does | Why it helps | Triggering Logic |
|---|---|---|---|
| **Query Rewriting** | Reformulates conversational query into key search terms | Resolves pronouns (*it, this, that*) based on chat history | Only triggered if conversational pronouns are detected |
| **HyDE** | Generates hypothetical document passage, embeds it for matching | Passage matches target document chunks better than raw questions | Bypassed for short queries (<= 4 words) |

*By executing transformations dynamically, the system avoids redundant LLM calls on simple keyword queries, saving up to 5 seconds of pre-search latency.*

---

## Chat Memory

| Mode | Memory implementation |
|---|---|
| Casual | Full multi-turn `messages[]` array sent to Ollama (last 8 messages = 4 turns) |
| Web / RAG / Hybrid | Prior turns sent as `messages[]`, current turn contains query context |

---

## Project Structure

```
Jignasa/
├── RAG With LangChain/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── cache.py          ← SQLite-backed prompt caching layer
│   │   ├── config.py          ← Config: models, guardrails, top-k, cache TTLs
│   │   ├── intent.py          ← Guardrails + intent classifier
│   │   ├── query_transform.py ← Query rewriting + HyDE
│   │   ├── rag.py             ← FAISS search + RAG prompt builder
│   │   ├── websearch.py       ← DuckDuckGo search + Web prompt builder
│   │   ├── db.py              ← SQLite database: chats, conversations, migration schema
│   │   ├── evaluation.py      ← Retrieval benchmark pipeline
│   │   └── main.py            ← FastAPI server + routes + SSE streaming
│   │
│   ├── web/                   ← React frontend
│   │   ├── src/
│   │   │   ├── App.tsx        ← Main UI, Mode Selector, Cost Modal, bubbles
│   │   │   ├── api.ts         ← Fetch wrappers + SSE stream parser
│   │   │   ├── types.ts       ← TypeScript interfaces
│   │   │   ├── index.css      ← Design System (segmented control, stats card)
│   │   │   └── main.tsx       ← React entry point
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── rag_index/             ← FAISS vector index & metadata
│   ├── data/                  ← Evaluation sets & saved runs
│   ├── scripts/               ← Index building & offline eval scripts
│   ├── streamlit_app.py       ← Legacy Streamlit UI
│   └── run_all.sh             ← Launch backend + frontend concurrently
│
├── pyproject.toml             ← Python dependencies (uv)
└── uv.lock
```

---

## Prerequisites

- **WSL2** (Ubuntu 24.04) or native Linux/macOS
- **Python 3.11+** managed by [`uv`](https://docs.astral.sh/uv/)
- **Node.js 18+** (managed via `nvm` in WSL)
- **[Ollama](https://ollama.com)** installed and running with `qwen3:8b` pulled:
  ```bash
  ollama pull qwen3:8b
  ```
- Build the FAISS index by running `rag_with_langchain.ipynb` before querying documents.

---

## Installation & Running

### 1. Clone and install Python dependencies
```bash
cd /home/abiram/Prayoga/Marga
uv sync
```

### 2. Install Node dependencies (one-time)
```bash
cd "RAG With LangChain/web"
npm install
```

### 3. Build the FAISS index (one-time)
Run all cells in `RAG With LangChain/rag_with_langchain.ipynb` to parse your PDFs and build the index under `rag_index/`.

### 4. Run application
```bash
cd "RAG With LangChain"
./run_all.sh
```
* **React Webapp**: `http://localhost:5173`
* **FastAPI Server**: `http://localhost:8000`

---

## Configuration

All configuration is in `api/config.py`:
* `TOP_K`: Number of PDF chunks to retrieve (default: 5).
* `WEB_SEARCH_RESULT_COUNT`: Number of web links to query (default: 8).
* `MAX_INPUT_LENGTH`: Max character length for messages (default: 2000).
* `RAG_CACHE_TTL_HOURS`: Cache validity for documents/hybrid queries (default: 168 hours / 7 days).
* `WEB_CACHE_TTL_HOURS`: Cache validity for web search queries (default: 6 hours).

---

## Evaluation

The **Evaluation** tab in the UI benchmarks document retrieval performance without calling the LLM:
1. Employs 80 pre-defined test questions (`data/evaluation_set.json`).
2. Embeds each question, queries FAISS, and checks if the expected document is in the top-k.
3. Reports metrics:
   * **Hit@k**: % of queries where the correct file appeared.
   * **MRR@k**: How high the correct file was ranked.
   * **Recall@k**, **Precision@k**, and **nDCG@k**.
4. Save and compare runs to trace performance changes.

---

## SSE Event Protocol

The chat endpoint streams events in this order:

```
data: {"type": "intent",      "mode": "casual|rag|web|hybrid"}
data: {"type": "cached",      "is_cached": true}                  ← Cached hit only
data: {"type": "sources",     "sources": [...]}                  ← RAG/Hybrid only
data: {"type": "web_sources", "sources": [...]}                  ← Web/Hybrid only
data: {"type": "token",       "content": "Hello"}                ← repeated for each token
data: {"type": "done",        "content": "Hello world", "prompt_tokens": 45, "completion_tokens": 85, "cached": false}
```
