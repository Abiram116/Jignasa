# Jignasa

**A fully local AI assistant that reads your documents, searches the live web, and reasons over both — without a single byte leaving your machine.**

Jignasa is a complete RAG system built from first principles: a structure-aware document pipeline, a retrieval layer with measured (not assumed) accuracy, and a generation layer that's explicitly tuned to admit uncertainty rather than fabricate an answer. No API keys, no subscriptions, no cloud dependency by default.

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](pyproject.toml)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688)](api/)
[![React 19](https://img.shields.io/badge/frontend-React%2019-61DAFB)](web/)
[![Ollama](https://img.shields.io/badge/LLM-Ollama-black)](https://ollama.com)
[![FAISS](https://img.shields.io/badge/vector%20store-FAISS-009999)](rag_index/)
[![Docker ready](https://img.shields.io/badge/docker-self--host%20ready-2496ED)](docs/DEPLOYMENT.md)
[![BYOK supported](https://img.shields.io/badge/BYOK-OpenAI%20%7C%20Anthropic%20%7C%20Gemini-orange)](docs/TECHNICAL.md)

[**Live showcase →**](https://abiram116.github.io/Jignasa/) &nbsp;·&nbsp; [Quick Start](#quick-start) &nbsp;·&nbsp; [Technical deep-dive](docs/TECHNICAL.md)

---

## Demo

> 🎥 *Demo video coming soon — a full walkthrough of casual chat, document Q&A, live web search, and the hybrid mode will go here.*

<!-- Screenshots coming soon: homepage hero, a RAG-mode chat with sources, the live evaluation results. -->

## What it does

Ask it anything. Jignasa runs a small hand-written ReAct (Reason + Act) loop — no LangChain. In **Auto** mode, it decides for itself, every turn, whether it needs to search your documents, search the web, both, or just answer directly — "what's 2+2" gets a direct answer, not a pointless document search. If you pin a specific mode instead (Knowledge/Web/Hybrid), that's you telling it exactly what to use, so it uses it every turn, no second-guessing — that's the actual point of pinning a mode. Every answer streams live with sources, and a live "thinking" trace shows exactly which tool it called and why before the answer even starts.

It also remembers durable things you tell it — your name, a stated preference — the same way ChatGPT's memory works: sparingly, only for identity-level facts, never a running summary of what you asked about. Concretely: after each reply, it decides whether anything you said is worth keeping, and if so saves it to a small local SQLite table on your own machine (nothing leaves your computer). Every future conversation — not just the one you said it in — reads that same stored list before answering, so "my name is Abiram" said once is remembered from then on, in any new chat. You can see and delete everything it remembers from the sidebar.

Everything runs on a local model via [Ollama](https://ollama.com) — there's no per-message cost, no rate limit from a provider, and no risk of your documents or conversations ever touching someone else's server.

### Modes

The mode selector above the input box has four buttons: **Auto**, **Knowledge**, **Web**, and **Hybrid**. All four run through the same loop, but only Auto lets it decide for itself which tools to use:

- **Auto** (default) — a cheap heuristic catches obvious small talk instantly; everything else goes to the loop, which decides on its own whether to search documents, search the web, both, or neither
- **Knowledge** — always searches your documents that turn; a genuine miss gets an honest "not in your documents" answer, not a fabricated one
- **Web** — always searches the live web that turn, cited inline, no API key needed
- **Hybrid** — always searches both that turn, then combines whatever it finds

The badge under each answer always reflects what actually happened that turn (PDF RAG / Web / Hybrid / Chat), never which button you pressed.

### Under every response

- **Live thinking trace** — a "Thought for N steps" panel shows each tool call the loop made and its stated reasoning, live as it happens, collapsing into history once the answer starts
- **Token counts** — input/output/total tokens for that exact reply
- **Latency** — wall-clock time for that response, shown as a badge
- **Cache hits** — a "Cached" badge when an answer came from the prompt cache instead of a fresh LLM call (instant, no re-generation)
- **Token cost calculator** — estimates what the whole conversation would have cost on GPT-4o, Claude, Gemini, etc. — useful context for why running locally is free, even though you're seeing real token numbers
- **Model settings** — swap between local Ollama (pick from whatever models you've actually pulled, auto-detected) and your own OpenAI/Anthropic/Gemini key, per conversation
- **Memory** — a sidebar panel showing everything Jignasa has remembered about you, with per-item delete and clear-all
- **Installable as its own app, once it's running** — after you start it locally (see Quick Start below), Chrome/Edge can install it with its own icon and window, no address bar, no browser chrome. Not a separate download — same backend, same React bundle, just not stuck looking like a browser tab pointed at `localhost`

## Why it's worth a look

Most "chat with your docs" projects are a thin wrapper around a hosted API. Jignasa builds every layer itself:

- **A real RAG pipeline** — PDF parsing, structure-aware chunking that keeps page and section context, vector search, and query rewriting to actually find the right passage, not just a keyword match
- **Genuinely agentic, not a routing table** — a hand-written ReAct loop decides per-turn whether to call a tool at all, the same mechanism Claude's own tool use runs on. No LangChain, no framework magic — see [`docs/AGENT_ROADMAP.md`](docs/AGENT_ROADMAP.md) for how this was built and [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for real "found it, measured it, fixed it" case studies from tuning it
- **Honest about uncertainty** — the model is explicitly prompted to say "I don't know" rather than make something up, and citations are verified before being shown
- **Measured, not just claimed** — retrieval quality and answer quality are both benchmarked against real test questions, and the results are shown live on the homepage, not just asserted in this README
- **A genuinely designed interface** — not a default template: custom type, a real motion/scroll system, and a UI built to feel as considered as the backend (see [`web/README.md`](web/README.md))
- **Optional cloud fallback** — if you'd rather not run a local model, plug in your own OpenAI, Anthropic, or Gemini key instead. Your key only ever goes from your browser to your own backend to the provider — never logged, never saved.
- **A real audit trail, not just chat history** — every routing decision, tool call, and guardrail block is logged with its reasoning to a queryable table (`GET /api/conversations/{id}/audit`), independent of what's shown in the chat UI. If you can't trace what an agent did, you can't debug it, secure it, or trust it — see [`docs/AGENT_ROADMAP.md`](docs/AGENT_ROADMAP.md#stage-25-observability--audit-trail--implemented)

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

**Before you start**, you need these installed on your machine:

| Tool | Why | Get it |
|---|---|---|
| Git | to clone this repo | [git-scm.com](https://git-scm.com/downloads) |
| Python 3.11+ | runs the backend | [python.org](https://www.python.org/downloads/) |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Python dependency manager this project uses | `curl -LsSf https://astral.sh/uv/install.sh \| sh` (Mac/Linux) or see the link for Windows |
| Node.js 18+ | runs the frontend | [nodejs.org](https://nodejs.org/) |

Ollama is **not** in that table on purpose — see Step 4 below, it's one of
two choices, not a hard requirement.

**Step 1 — get the code:**
```bash
git clone https://github.com/Abiram116/Jignasa.git
```
```bash
cd Jignasa
```

**Step 2 — install dependencies** (backend, then frontend):
```bash
uv sync
```
```bash
cd web && npm install && cd ..
```

**Step 3 — (optional) add your own documents.** Jignasa can answer
questions about PDFs you give it, but this step is entirely optional —
skip straight to Step 4 if you just want to try casual chat and live web
search first. If you do want document Q&A: drop your PDF(s) into the
`knowledge-base/` folder, then build the search index from them:
```bash
uv run python3 pipeline/01_profile_corpus.py
```
```bash
uv run python3 pipeline/02_parse_and_chunk.py
```
```bash
uv run python3 pipeline/03_build_index.py
```
(Each command prints what to do next if something's missing — e.g. if
`knowledge-base/` is empty, it'll tell you that instead of crashing.)

**Step 4 — choose how it should think.** Pick one:

- **Option A — fully local (free, private, needs a one-time download).**
  Install [Ollama](https://ollama.com/download) itself first, then pull a
  model:
  ```bash
  ollama pull qwen3:8b
  ```
  Already have Ollama with other models pulled from something else? You
  don't need to repull `qwen3:8b` specifically — once the app is running,
  open **Settings** and it automatically lists every model you've already
  got installed, so you can pick any of them instead.
- **Option B — bring your own API key, no local model at all.** Skip
  Ollama entirely. Start the app (Step 5), open **Settings**, and paste in
  an OpenAI, Anthropic, or Gemini API key — your key is only ever used for
  that one request and is never stored on the server. Note: with this
  option, casual chat works fully through your chosen cloud model, but
  document search / live web search and long-term memory currently still
  need a local Ollama connection for their own internal decision step —
  without Ollama running at all, those specific features stay off and
  Jignasa behaves as a plain chat assistant using your API key.

**Step 5 — run it** (starts backend + frontend together):
```bash
./run_all.sh
```

Open `http://localhost:5173` in your browser — that's the app. The backend
API runs separately at `http://localhost:8000` (the frontend talks to it
automatically, you don't need to open that one yourself).

**Or double-click to launch it, instead of typing the command:**

| Platform | What to double-click | Notes |
|---|---|---|
| Mac | `run_all.command` | Opens Terminal.app, starts everything, opens your browser automatically |
| Linux (desktop) | `Jignasa.desktop` | Open it in a text editor first and replace the two `/path/to/your/Jignasa` placeholders with wherever you actually cloned it, then double-click. Most file managers will ask to confirm "Allow Launching" the first time only — that's normal |
| Windows (native — Python/Node/Ollama installed directly on Windows) | `run_all.bat` | Opens two console windows (backend, frontend) and your browser. Closing both windows stops the app |
| Windows via **WSL** | — | Don't use `run_all.bat` — it runs as a native Windows process and won't see anything installed inside your WSL distro. Keep using `./run_all.sh` from your WSL terminal exactly as before |

Any of these break if you move the project folder afterward, the same way
any desktop shortcut to any app breaks if you move that app — just
re-point it (or re-edit the path, for the Linux one) if that happens.

**WSL users specifically: where should Ollama actually run?** WSL2 has its
own network namespace separate from Windows, so if Ollama is installed on
the **Windows side** while Jignasa runs **inside WSL**, `127.0.0.1:11434`
inside WSL does not reach it — you'll see "Can't reach Ollama" errors.
Two ways to fix it:

- **Simplest: install Ollama inside WSL itself** (`curl -fsSL
  https://ollama.com/install.sh | sh`, run inside your WSL terminal, same
  as any other Linux install). Then everything is on the same side of the
  boundary and `127.0.0.1` just works, no configuration needed.
- **Or, if you want to keep using Ollama on Windows** (e.g. the Windows
  GUI app, shared with other non-WSL projects): point Jignasa at the
  Windows host's IP instead, from inside your WSL terminal:
  ```bash
  export OLLAMA_HOST="http://$(ip route show default | awk '{print $3}'):11434"
  ./run_all.sh
  ```
  This works with no code changes — the `ollama` Python package already
  reads `OLLAMA_HOST` from the environment natively.

A note on the commands above: every Python command is prefixed with
`uv run` — that's what tells it to use the dependencies from Step 2
instead of your system Python. If you ever run one without it, you'll get
a `ModuleNotFoundError`.

**Prefer Docker instead of installing Python/Node yourself?** Skip Steps
2-5 above and see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — one
`docker compose up` does the same thing.

**Installing it as an app is completely optional.** Using
`http://localhost:5173` as a normal webpage in any browser works exactly
the same — nothing is locked behind installing it. If you'd rather it not
look like a browser tab, open that URL specifically in **Chrome or Edge**
and you'll see an "Install Jignasa" icon appear in the address bar;
clicking it gives the app its own window and taskbar/dock icon, no browser
chrome. This only works in Chrome/Edge — Firefox and Safari don't support
installing web apps this way on desktop, so on those browsers (or if you
just don't bother clicking it) you use the regular webpage, which is fully
supported too. Either way it's the exact same backend and frontend, just
presented as an app window instead of a page.

PDFs can also be added or removed later through the running app itself —
an "Add document" button in the chat sidebar uploads and indexes a file
without touching the terminal again. See
[`knowledge-base/README.md`](knowledge-base/README.md) for more.

**Prefer Docker?** One `docker compose up` runs the whole stack — backend, frontend, and Ollama — with no Python/Node toolchain needed on your machine. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**Getting updates.** Jignasa isn't an app that updates itself — it's your
own local copy of this code, so getting the latest fixes/features is just:
```bash
git pull
uv sync              # picks up any new/changed Python dependencies
cd web && npm install && cd ..   # same, for frontend dependencies
```
Then restart it (`./run_all.sh`). Both `uv sync` and `npm install` are
safe to run even when nothing changed — they just do nothing extra in
that case. If you installed it as an app (see above), it'll pick up the
new frontend automatically the next time you open it; only the backend
needs the manual pull + restart.

## Project layout

```
Jignasa/
├── api/             ← FastAPI backend (see api/README.md for a file-by-file map)
├── web/             ← React frontend (see web/README.md for the design system)
├── pipeline/        ← Builds the document index from PDFs (see pipeline/README.md)
├── rag_index/       ← Generated vector index (see rag_index/README.md)
├── knowledge-base/  ← Your source PDFs, not in git (see knowledge-base/README.md)
├── data/            ← Evaluation question sets & saved runs (see data/README.md)
├── scripts/         ← Evaluation utilities used by the API (see scripts/README.md)
├── archive/         ← Retired code, kept for reference (see archive/README.md)
├── docs/            ← Technical deep-dive, Docker guide, and dated changelog (docs/CHANGELOG.md)
└── run_all.sh       ← Start backend + frontend together
```

## About this project

Built end-to-end — RAG pipeline, evaluation, backend, and frontend — by **Abiram Mandava**, as a portfolio project to show what a complete, production-minded AI application looks like beyond a single notebook.

📧 [sreeabirammandava@gmail.com](mailto:sreeabirammandava@gmail.com) &nbsp;·&nbsp; 📞 +91 8309816750 &nbsp;·&nbsp; [GitHub Pages showcase](https://abiram116.github.io/Jignasa/)

Licensed under [MIT](LICENSE) — use it, fork it, learn from it. Want to
contribute? See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the local
test-before-PR workflow.

---

*Looking for implementation details — prompt formats, SSE event schema, the motion/scroll system, or a real debugging case study (a grounding-fidelity bug found, root-caused, and fixed with evidence)? See [`docs/TECHNICAL.md`](docs/TECHNICAL.md). For a dated log of bugs found and fixed after initial development, see [`docs/CHANGELOG.md`](docs/CHANGELOG.md). Each non-obvious folder also has its own short README.*
