# Contributing to Jignasa

## Ground rule: nothing lands on `master` untested

`master` is always meant to be the version someone can clone and run right
now. So the workflow is always: **build and test your change on your own
machine first, using the exact same local setup described in the root
[README.md](README.md#quick-start), then open a Pull Request** — never push
a new feature straight to `master`.

```bash
# 1. Fork the repo, then clone your fork
git clone git@github.com:<you>/Jignasa.git
cd Jignasa

# 2. Branch off master
git checkout -b feature/short-description

# 3. Set up and run it locally -- same steps as the README's Quick Start
uv sync
cd web && npm install && cd ..
ollama pull qwen3:8b
./run_all.sh
```

That gives you `http://localhost:5173` (frontend) talking to
`http://localhost:8000` (API), running against your own local Ollama —
completely isolated from anyone else, so you can test a new feature or a
change to the agent loop as many times as you need before it ever touches
the real `master`.

## Before opening a Pull Request

- **If you touched `api/agent.py`'s decision prompt or tool schema**, run
  `python3 scripts/eval_tool_selection.py` and paste the pass/fail count
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

- **No LangChain, anywhere.** The RAG pipeline and the agent loop are both
  hand-written on purpose — see [`docs/AGENT_ROADMAP.md`](docs/AGENT_ROADMAP.md)
  and [`pipeline/README.md`](pipeline/README.md) for why. A PR that
  reintroduces a framework dependency to save a few lines will get pushback.
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
