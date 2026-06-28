# Deployment — Docker self-host

This is the "clone, run one command, done" path. It doesn't change the
architecture — still fully local, still Ollama + FAISS, no cloud calls and
no API keys required. Docker just packages the same thing so you don't
need a Python/Node toolchain on the host.

For local dev without Docker (editing code, `vite dev` + `uvicorn` as two
processes), see the root [README.md](../README.md) Quick Start — that
workflow is unchanged by any of this.

## What's in the compose file

`docker-compose.yml` defines two services:

- **`ollama`** — the official `ollama/ollama` image. Pulled models live in
  a named volume (`ollama_models`) so they survive container rebuilds.
- **`api`** — built from the repo's `Dockerfile`. Runs the FastAPI backend
  and serves the pre-built React frontend (`web/dist/`) as static files,
  so there's one container to talk to, not two. Talks to `ollama` over the
  Docker network via `OLLAMA_HOST=http://ollama:11434` (the `ollama` Python
  client reads this env var automatically — no code changes needed for
  this networking to work).

Your PDFs (`knowledge-base/`) and the built FAISS index (`rag_index/`) are
mounted as volumes, not baked into the image — your data persists across
rebuilds and isn't duplicated into the image layer.

## First-time setup

```bash
# 1. Build the frontend (Dockerfile copies web/dist/, doesn't build it)
cd web && npm install && npm run build && cd ..

# 2. Build and start both containers
docker compose up -d --build

# 3. Pull the model into the ollama container
docker compose exec ollama ollama pull qwen3:8b

# 4. Drop your PDFs into ./knowledge-base/, then build the index
#    inside the api container (same pipeline scripts as local dev)
docker compose exec api uv run python pipeline/02_parse_and_chunk.py
docker compose exec api uv run python pipeline/03_build_index.py
```

The app is now at `http://localhost:8000` — frontend and API both served
from the one `api` container.

## Adding new dependencies later

When a future feature needs a new Python package:

```bash
uv add <package>      # updates pyproject.toml and uv.lock
docker compose up -d --build
```

The `Dockerfile` copies `pyproject.toml` + `uv.lock` and runs
`uv sync --frozen` against them, so a rebuild always picks up whatever
those two files currently say — there's no separate dependency list to
keep in sync by hand. Keep `pyproject.toml` to packages that are actually
imported somewhere in `api/`, `pipeline/`, or `scripts/`; unused entries
just make the image bigger and the build slower for no benefit (this is
why `langchain`, `langchain-text-splitters`, `pandas`, and `streamlit`
were removed — none were imported anywhere in the active codebase, only
pulled in historically by since-retired code).

Same idea for the frontend: a new `npm install <package>` updates
`web/package.json`/`package-lock.json`, and the next `npm run build` +
`docker compose up -d --build` picks it up — `web/dist/` is rebuilt from
source, not cached inside the image beyond Docker's normal layer caching.

## Permission errors on knowledge-base/ or rag_index/

The `api` container runs as a non-root user (UID 1000) for security. If the
pipeline scripts fail with a permission error writing to the mounted
`knowledge-base/` or `rag_index/` volumes, your host user's UID doesn't
match — fix it with:

```bash
sudo chown -R 1000:1000 knowledge-base rag_index
```

## Known limitations (same as local)

These aren't introduced by Docker — they're inherent to the project's
local-first design, covered in more depth in
[`docs/TECHNICAL.md`](TECHNICAL.md#known-limitations):

- **DuckDuckGo web search** has no API key and is rate-limited; heavy use
  can get temporarily throttled.
- **qwen3:8b** is a small local model — grounding fidelity on web/hybrid
  mode is good but not perfect; the system prompts are tuned to make it
  say "I don't know" rather than hallucinate, not to be infallible.
- No GPU passthrough is configured by default — Ollama will run on CPU
  unless you add an `nvidia` runtime to the `ollama` service yourself
  (hardware-dependent, intentionally left out of the default compose file).
