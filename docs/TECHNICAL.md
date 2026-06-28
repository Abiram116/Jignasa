# Jignasa — Technical Deep Dive

The root `README.md` is a project overview, written to be read by anyone
landing on the GitHub page. This file is the implementation-level
companion: how the pieces actually work, why specific decisions were made,
and a real case study of a bug that was found, root-caused, and fixed with
evidence rather than guesswork. It isn't linked from the root README on
purpose — it's for whoever is actually working on the code.

Each subdirectory also has its own short README for what's local to it.
This file is the index and the place for things that cut across multiple
directories.

| Area | README |
|---|---|
| RAG index build pipeline | [`pipeline/README.md`](../pipeline/README.md) |
| Why the pipeline was rebuilt (root-cause history) | [`pipeline/REBUILD_LOG.md`](../pipeline/REBUILD_LOG.md) |
| API-invoked evaluation scripts | [`scripts/README.md`](../scripts/README.md) |
| Evaluation question sets (what's what) | [`data/README.md`](../data/README.md) |
| Evaluation results (current numbers + methodology caveats) | [`data/evaluations/README.md`](../data/evaluations/README.md) |
| Generated FAISS index — don't hand-edit | [`rag_index/README.md`](../rag_index/README.md) |
| Source PDFs (not in git) | [`knowledge-base/README.md`](../knowledge-base/README.md) |
| Retired code, kept for reference | [`archive/README.md`](../archive/README.md) |
| Frontend design system, fonts, colors, motion stack | [`web/README.md`](../web/README.md) |

---

## Architecture, in one picture

```
Browser (React, web/)
   │  HTTP / SSE
   ▼
FastAPI backend (api/)
   │
   ├─ casual  ──────────────────────────────► Ollama (qwen3:8b)
   ├─ docs    ─► FAISS + query transform ───► Ollama
   ├─ web     ─► DuckDuckGo (ddgs) ──────────► Ollama
   └─ hybrid  ─► FAISS + DuckDuckGo (parallel)► Ollama
   │
   ├─ SQLite (chat_history.sqlite3): conversations, messages, prompt cache
   └─ data/evaluations/: retrieval + RAGAS benchmark snapshots
```

Everything runs locally: no API keys, no cloud LLM calls, no paid services.
That constraint shapes several decisions documented below (DuckDuckGo
instead of a paid search API, a small 8B local model instead of GPT-4-class,
FAISS instead of a managed vector DB).

## Backend internals (`api/`)

### Mode routing

Every chat message resolves to one of four modes before generation:
`casual`, `docs` (RAG), `web`, or `hybrid` (RAG + web concurrently, via a
`ThreadPoolExecutor`). In `auto` mode, `classify_intent_llm()` (`api/intent.py`)
makes that call; otherwise the user's explicit mode selection is used, with
a couple of guardrails (e.g. `docs`/`hybrid` silently downgrade if the FAISS
index isn't built yet; `web` downgrades to `casual` if the message is
heuristically conversational rather than a real query).

### System prompts — one per mode, each with its own "personality"

`api/main.py` defines `CASUAL_SYSTEM`, `RAG_SYSTEM`, `WEB_SYSTEM`,
`HYBRID_SYSTEM`, and `NO_KB_SYSTEM`. Each has its own formatting rules and
its own honesty rule, tuned to what that mode is actually vulnerable to:

- **Casual**: hedge on uncertain factual claims rather than guessing with
  false confidence.
- **RAG**: if context only *partially* covers the question, say what's
  supported and what isn't, instead of stretching thin evidence into a
  complete-sounding answer.
- **Web** / **Hybrid**: re-check that a cited source number actually
  supports the specific claim before attaching it — and if results are
  weak/tangential, present 2-3 plausible candidates instead of forcing one
  confident (and possibly wrong) answer. This rule exists because of a real
  failure — see the case study below.

### SSE streaming protocol

The chat endpoint (`POST /api/conversations/{id}/chat`) streams
Server-Sent Events in this order:

```
{"type": "intent", "mode": "casual|rag|web|hybrid"}
{"type": "cached", "is_cached": true}                    ← cache hit only
{"type": "sources", "sources": [...]}                    ← docs/hybrid
{"type": "web_sources", "sources": [...], "degraded": false}  ← web/hybrid
{"type": "ask_web_search", "message": "..."}              ← auto mode, weak RAG hit
{"type": "token", "content": "..."}                       ← repeated
{"type": "done", "content": "...", "prompt_tokens": N, "completion_tokens": M, "cached": false, "latency_ms": N}
{"type": "error", "message": "..."}
```

`degraded: true` on `web_sources` means hybrid mode's web search failed and
the answer is docs-only — added so that failure isn't silent (see the
robustness section below).

### Robustness pass

A `_finish_response()` helper (`api/main.py`) wraps the persist-and-respond
step shared by all four modes. Before this existed, each mode branch called
`db.append_message()` directly with no error handling — if that write
failed (SQLite locked, disk issue) *after* tokens had already streamed to
the client, the exception propagated out of the generator and the client
got a dead connection with no `done` or `error` event, ever. Now a
persistence failure still yields a terminal `error` event.

Other things fixed in the same pass:
- Hybrid mode's web-search failure used to be silently swallowed
  (`except Exception: results = []`) with no signal to the frontend. Now
  surfaced via `degraded: true`.
- `api/rag.py`'s missing-index error used to point at the retired
  `rag_with_langchain.ipynb` notebook. Now points at the actual
  `pipeline/` scripts.

### Citation linking — moved server-side

Web/hybrid responses cite sources as `[1]`, `[2]`, etc. These need to
become clickable links (`[[1]](url)`). This conversion used to happen only
in the frontend, transiently, after a live stream finished — meaning the
raw `[1]` text is what got stored in SQLite, so reloading a conversation or
switching away and back showed plain bracketed text again, not links. The
fix: `_linkify_web_citations()` runs server-side, before the answer is
cached and persisted, so the linked version is what's stored everywhere.
The frontend now just trusts `event.content` from the `done` event instead
of re-deriving it.

Hybrid mode also used to cite web sources as `[web: N]` while web-only mode
used `[N]` — two different formats, and the linking regex only matched
`[N]`, so hybrid's web citations were *never* clickable, live or not.
Standardized both modes to `[N]`.

## Case study: a real grounding failure, found and fixed with evidence

A user asked, in web mode: *"what was some website which predicts the
future of world based on AI development it was famous one"*. The response
confidently cited `[5]` and described "The Mother of ImageNet" as the
answer — then contradicted itself mid-paragraph, admitting *"this website
is not a real website but rather a symbolic representation."* Compared
side-by-side with ChatGPT's answer to the identical prompt (which correctly
named **AI 2027** / **AI Futures Project** and offered several real
candidates), the gap was obvious. What wasn't obvious yet was *why*.

**First hypothesis (tested, wrong): bad search query.** The raw message is
long and colloquial; the instinct was to add an LLM rewrite step before
hitting DuckDuckGo, turning it into a tighter query like *"famous website
predicting future world based on AI development."*

**Then it was actually measured, not assumed.** Running both the raw and
the rewritten query against real DuckDuckGo search:

```
RAW query    → [1] AI Futures Project - Wikipedia   ← the correct answer, rank #1
REWRITTEN    → [1] Future predictions - There's An AI For That®   ← SEO spam
```

The rewrite made retrieval *worse* — it pushed the correct, top-ranked
result down in favor of generic AI-tool spam sites. The raw query was
already fine. This completely invalidated the first hypothesis, so the
rewrite step was removed (code and all — see the note left in
`api/websearch.py` rather than silently deleting the evidence).

**Second hypothesis (confirmed): the model fabricated a citation.**
Re-running the search at the real production result count (`n=8`) showed
`AI Futures Project - Wikipedia` sitting at position `[1]` the whole time.
Position `[5]` was an unrelated AI-tool site — not even close to "Mother of
ImageNet." The model's citation `[5]` didn't correspond to anything real in
its own context; it invented both the citation and the explanation. This
is a small-model (`qwen3:8b`, 8B parameters) grounding-fidelity failure in
*synthesis*, not a retrieval failure — qwen3:8b has thin parametric world
knowledge to fall back on compared to a frontier model, so when it loses
track of which source says what, there's nothing underneath to catch it.

**The fix**: added an explicit instruction to `WEB_SYSTEM` and
`HYBRID_SYSTEM` — *"before citing a source number, re-check that its
actual title/snippet genuinely supports the specific claim you're
attaching it to"* — plus the "list candidates instead of forcing one
answer from weak evidence" rule.

**Verified, not just asserted**: re-ran the exact original query through
the real model with the new prompt. The new answer correctly identifies
**AI2027** and the **A.I. Futures Project**, citing the actual Wikipedia
result at `[1]`. No fabricated citation, no self-contradiction.

The broader lesson, relevant to anyone extending this project: DuckDuckGo
(free, no API key) is a perfectly adequate retrieval layer at this scale —
the dependency that actually needed hardening was the small local model's
faithfulness to its own context, not the search step. Measure before
fixing; the obvious hypothesis was the wrong one here.

## Evaluation

Two distinct benchmarks exist, covering different failure modes:

- **Retrieval-only** (`scripts/evaluate_rag_metrics.py`): Hit@k, MRR, nDCG
  against `data/evaluation_set.json` — "did we pull the right PDF?" No LLM
  call.
- **Generation quality** (`scripts/evaluate_ragas.py`): RAGAS faithfulness,
  answer relevancy, context precision/recall against
  `data/evaluation_set_v2.json` — runs the *actual* pipeline end-to-end and
  scores the generated answer, judged by the project's own local
  `qwen3:8b` (since there's no paid judge-model API in a local-first
  project — see that script's docstring for why this makes scores
  directional, not a universal benchmark).

Both feed `GET /api/evaluation/summary`, which the homepage's "Measured
against real questions" section reads live — not hardcoded — so the
numbers shown always reflect whatever was last actually run. Full current
results and methodology caveats: [`data/evaluations/README.md`](../data/evaluations/README.md).

## Frontend

Covered in full in [`web/README.md`](../web/README.md) — design system
(fonts, colors), the motion library stack and the `#root`-vs-`window`
scroll-container bug that affected multiple components, and a rundown of
every homepage motion component and why it exists.

## Security & guardrails (`api/security.py`, `api/intent.py`)

- Session IDs validated against a fixed format before any DB lookup.
- Input sanitized (control characters stripped, Unicode NFC-normalized,
  length-capped) before guardrail checks.
- A small blocked-pattern list catches obvious prompt-injection/jailbreak
  attempts (`"ignore previous instructions"`, `"act as if you"`, etc.) —
  this is a basic keyword filter, not a robust defense; treat it as a
  speed bump, not a security boundary.
- Per-IP token-bucket rate limiting (30 req/60s) on the chat endpoint and
  the evaluation endpoints (the other expensive path — runs the full RAG
  pipeline over a question set).
- Standard security headers (CSP, HSTS, X-Frame-Options, etc.) via
  `SecurityHeadersMiddleware`.
- BYOK (`api/llm.py`): a user-supplied OpenAI/Anthropic/Gemini key is used
  for exactly one provider-client construction per request and discarded —
  never passed to `db.append_message` or `cache.set_cached`, never logged.

### Security audit (found and fixed during the Docker/BYOK deployment pass)

A self-review pass turned up one real vulnerability and one design gap,
both fixed in the same pass rather than just documented:

- **Path traversal in the static-frontend route (HIGH, fixed).** The Docker
  build serves `web/dist/` via a catch-all FastAPI route
  (`@app.get("/{full_path:path}")`) so one container can serve both API and
  frontend. The first version built `requested = _DIST_DIR / full_path` and
  served it if `requested.is_file()` — but Starlette's `:path` converter
  passes `../` segments through literally, so a request like
  `GET /../../api/main.py` resolved outside `web/dist/` entirely and would
  have served arbitrary files readable by the process (verified: an
  unresolved `../../api/main.py` path did exist and was readable). Fixed by
  resolving the path and checking containment before serving:
  `requested = (_DIST_DIR / full_path).resolve()` then
  `requested.relative_to(_DIST_DIR.resolve())`, raising 404 on `ValueError`.
  This is the kind of bug that's invisible in normal use (every legitimate
  request stays inside `web/dist/`) and only shows up under a deliberately
  crafted path — exactly why it's worth a second look on any code that
  builds a filesystem path from a URL segment.
- **Indirect prompt injection via retrieved content (MEDIUM, fixed).** The
  existing `check_prompt_injection()` only ran on the *user's* message —
  RAG chunks and web search snippets/titles were embedded into the LLM
  prompt unfiltered. A malicious PDF in the knowledge base, or a web page
  ranking in DuckDuckGo results, could contain injection-shaped text (e.g.
  `[INST] ignore your instructions [/INST]`) that would reach the model
  as if it were trusted context. Rejecting the request outright (like
  `check_prompt_injection` does for user input) isn't right here — that
  would let one bad indexed document or search hit silently break answers
  for everyone, a self-inflicted denial of service. Added
  `neutralise_injection()` instead: same pattern list, but it *defuses*
  matches in place (`pattern.sub("[filtered]", text)`) rather than raising.
  Applied to RAG chunk text (`api/rag.py build_prompt`), web result
  titles/snippets (`api/websearch.py build_web_prompt`), and the hybrid
  mode's manual context assembly (`api/main.py`).
- **Docker container ran as root (LOW, fixed).** No `USER` directive meant
  the FastAPI process ran as root inside the container. Added a non-root
  `jignasa` user (UID 1000, matching the typical first-user UID on
  Linux/macOS so the bind-mounted `knowledge-base/`/`rag_index/` volumes
  stay writable without extra config) — see `docs/DEPLOYMENT.md` for the
  one-line `chown` fix if your host UID differs.
- **Confirmed safe, no change needed:** CORS is restricted to the dev
  origins only with no wildcard; all SQL in `api/db.py`/`api/cache.py` uses
  parameterized queries (the one f-string is a hardcoded column name in a
  schema migration, not user input); session IDs are validated against a
  fixed `session_YYYYMMDD_HHMMSS_NNNNNN` regex before any DB lookup; no
  hardcoded secrets anywhere in `api/`, `pipeline/`, or `scripts/`.
- **Known, accepted gap:** `get_client_ip()` trusts `X-Forwarded-For`
  unconditionally, so the per-IP rate limit is bypassable by anyone who can
  set that header directly (true for any client not behind a trusted
  reverse proxy that strips/overwrites it). Not fixed, because this is a
  self-hosted, single-operator app by design — the realistic threat model
  is "someone on my LAN spams my own server," not "anonymous internet
  traffic behind an untrusted proxy." If you put this behind a public
  reverse proxy, configure it to strip inbound `X-Forwarded-For` and set
  its own.

## Known limitations (stated plainly, not hidden)

- **DuckDuckGo search quality** is the ceiling for web mode's grounding —
  free and no API key, but not as comprehensive as Bing/Google-backed
  search. This is a deliberate trade-off of staying fully local/free, not
  an oversight.
- **qwen3:8b's grounding fidelity** can fail under weak evidence (see the
  case study) — mitigated with explicit prompt instructions, not eliminated.
  A larger model would have more headroom here, at the cost of the
  fully-local constraint.
- **FAISS `IndexFlatIP`** is exact search, not approximate — correct and
  fast at this corpus size (~2000 chunks), but would need revisiting
  (HNSW/IVF, or a dedicated vector DB) well before reaching 100K+ chunks or
  needing per-user filtering.
- **RAGAS scores use a local judge model**, not a frontier model — useful
  for tracking regressions over time within this project, not for
  comparing against published RAGAS benchmarks from other projects.
