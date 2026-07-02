# Contributing to Jignasa

## Ground rule: nothing lands on `master` untested

`master` is always meant to be the version someone can clone and run right
now. So the workflow is always: **build and test your change on your own
machine first, then open a Pull Request** — you can't push directly to this
repo's `master` (you don't have write access to it), and even if you did,
don't.

## Step-by-step: your first contribution

**1. Fork the repo.** Go to
[github.com/Abiram116/Jignasa](https://github.com/Abiram116/Jignasa) and
click the **Fork** button (top right). This creates your own copy of the
repo under your GitHub account — `github.com/<your-username>/Jignasa` —
that you can freely push to.

**2. Clone your fork** (not the original) to your machine:
```bash
git clone https://github.com/<your-username>/Jignasa.git
cd Jignasa
```

**3. Create a branch for your change** — never work directly on `master`,
even in your own fork:
```bash
git checkout -b feature/short-description
```

**4. Set it up and run it locally** — identical to the root
[README.md](README.md#quick-start)'s Quick Start:
```bash
uv sync
cd web && npm install && cd ..
ollama pull qwen3:8b
./run_all.sh
```
This gives you `http://localhost:5173` (frontend) talking to
`http://localhost:8000` (API), running against your own local Ollama —
completely isolated from anyone else's copy, so you can test your change as
many times as you need before it goes near the real project.

**5. Make your change, commit it, push it to *your fork*:**
```bash
git add .
git commit -m "short description of what changed and why"
git push origin feature/short-description
```

**6. Open the Pull Request.** Go back to your fork on GitHub — it'll show a
"Compare & pull request" button for the branch you just pushed. Click it,
make sure the base is set to `Abiram116/Jignasa` → `master`, fill in the
description (see "Opening the Pull Request" below), and submit. From here
the review happens on GitHub, not in your terminal.

## Before opening a Pull Request

- **If you touched `api/agent.py`'s decision prompt or tool schema**, run
  `uv run python3 scripts/eval_tool_selection.py` and paste the pass/fail count
  into your PR description. That prompt has regressed silently before from
  a single anecdotal tweak — see "The adaptive ReAct loop" in
  [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for the actual story. This eval
  is the only thing standing between "seems fine" and "confirmed fine."
- **Backend**: `python3 -m py_compile api/*.py` should succeed with no
  errors.
- **Frontend**: `cd web && npx tsc -b --noEmit` should succeed with no
  errors, and `npm run build` should complete.
- **Manually exercise the actual flow you changed** in the browser at
  `localhost:5173` — a passing compiler is not the same as a working
  feature. If it's a chat-affecting change, send at least one real message
  through each mode (Auto/Knowledge/Web/Hybrid) it could plausibly touch.

## Opening the Pull Request

- Target `master`, with a short, specific title (what changed, not "fix
  bug").
- Describe *why*, not just what — a one-line rationale saves the next
  person (including future-you) from re-deriving it.
- Keep it focused. A PR that fixes one thing is easy to review and easy to
  revert if something's wrong; a PR that bundles three unrelated changes is
  neither.
- Small doc-only fixes (typos, broken links) don't need the full checklist
  above — just open the PR.

## Code style

There's no linter-enforced style guide beyond what's already in the repo —
match the conventions of the file you're editing. A few real, load-bearing
patterns worth knowing before you deviate from them:

- **No LangChain in the RAG pipeline or agent loop.** Both are hand-written
  on purpose — see [`docs/AGENT_ROADMAP.md`](docs/AGENT_ROADMAP.md) and
  [`pipeline/README.md`](pipeline/README.md) for why. The one exception is
  `scripts/evaluate_ragas.py`, which wraps the local judge model in
  `langchain-ollama`/`langchain-huggingface` only because the RAGAS
  library's own API requires a LangChain-shaped model object — isolated to
  one offline evaluation script that never runs as part of the live
  product. A PR that reintroduces LangChain anywhere else will get pushback.
- **Every non-obvious "why" gets a comment or a README line**, not a
  restatement of what the code already says. Look at any existing docstring
  in `api/` for the bar this is held to.
- **Each top-level folder has its own README** (`api/`, `web/`, `pipeline/`,
  `scripts/`, `data/`, `rag_index/`, `knowledge-base/`) — if you add a new
  file whose purpose isn't obvious from its name, add a line there instead
  of leaving it for someone to reverse-engineer later.

## Releases (maintainer-only)

Releases are cut from `master` by pushing a version tag (`git tag v1.1.0 &&
git push origin v1.1.0`), which triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml)
automatically. Contributors don't need to do anything here — this section
just explains why you won't see a new Release for every merged PR.
