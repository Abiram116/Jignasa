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
   ├─ casual (heuristic short-circuit) ──────────────────► Ollama (qwen3:8b)
   │
   └─ everything else ─► adaptive ReAct loop (api/agent.py)
                             │
                  tool menu scoped by pinned mode:
                  Knowledge→rag_search only, Web→web_search only,
                  Hybrid/Auto→both. The loop decides per-turn
                  whether to call either, both, or neither.
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              FAISS index        DuckDuckGo
              (your PDFs)         (live web)
                             │
                    one final Ollama call, using whichever
                    system prompt matches what was gathered
   │
   ├─ SQLite (chat_history.sqlite3): conversations, messages, prompt cache,
   │  persistent memory (api/memory.py)
   └─ data/evaluations/: retrieval, RAGAS, and tool-selection benchmark snapshots
```

Everything runs locally: no API keys, no cloud LLM calls, no paid services.
That constraint shapes several decisions documented below (DuckDuckGo
instead of a paid search API, a small 8B local model instead of GPT-4-class,
FAISS instead of a managed vector DB) — and it's also the reason the
adaptive loop's decision step is worth reading closely: an 8B model making
tool-selection judgment calls behaves very differently from a frontier
model doing the same job, in ways covered in the case studies below.

## Backend internals (`api/`)

### Mode routing — a heuristic short-circuit plus an adaptive loop, not a fixed pipeline

A cheap regex heuristic (`classify_intent()`, `api/intent.py`) catches
obvious small talk instantly, with zero LLM round-trip, regardless of which
mode is pinned. Everything else enters `run_agent_loop()` (`api/agent.py`),
which is given a *tool menu* scoped by the pinned mode —
`{"agent" (auto): both, "hybrid": both, "docs": rag_search only, "web":
web_search only}`.

**Auto mode** decides for itself, every turn, whether to call either tool,
both, or neither — this is the original adaptive design, unchanged: asking
"what's 2+2" in Auto never triggers a pointless document search.

**Pinned modes (Knowledge/Web/Hybrid) force their tool(s) every turn**
(`force_tools` param on `run_agent_loop`), rather than merely permitting
them. **Found and fixed:** the first version only scoped the *menu* for
pinned modes too, still leaving the actual call up to the model's
discretion — which meant Knowledge mode could intermittently answer as
plain chat with zero sources, because the model sometimes just decided not
to bother calling `rag_search`, silently defeating the entire point of
pinning a mode. A user pinning "Knowledge" is stating a requirement
("search my documents"), not a suggestion the model is free to skip.
Forcing it fixed that; Auto mode's adaptive behavior is untouched by this
change. If a pinned document search comes back empty, the existing "honest
about uncertainty" system prompts (below) still produce a genuine
"not in your documents" answer rather than fabricating one — this fix
made retrieval *run*, it didn't change how a miss is handled afterward.

The persisted mode / UI badge is always derived from the *outcome* of a
turn (which tools it actually ended up using — `rag_attempted`/
`web_attempted`, tracked from the loop's own trace, not just whether
results came back non-empty, so a genuine zero-hit search still gets
credited correctly instead of silently falling back to the casual
personality), never from which pin was selected or an internal "agent"
label. See "The adaptive ReAct loop" below for the full design.

### System prompts — one per mode, each with its own "personality"

`api/main.py` defines `CASUAL_SYSTEM`, `RAG_SYSTEM`, `WEB_SYSTEM`, and
`HYBRID_SYSTEM`. Each has its own formatting rules and its own honesty
rule, tuned to what that mode is actually vulnerable to, and the loop picks
whichever one matches what it actually gathered that turn rather than a
fifth, separate "agent" prompt:

- **Casual**: hedge on uncertain factual claims rather than guessing with
  false confidence.
- **RAG**: if context only *partially* covers the question, say what's
  supported and what isn't, instead of stretching thin evidence into a
  complete-sounding answer; a genuine zero-hit search still gets this
  prompt (not a silent downgrade to the casual personality), so a
  Knowledge-pinned miss says so honestly instead of answering from general
  knowledge.
- **Web** / **Hybrid**: for any specific number, version, date, or
  statistic, find the exact result whose text contains that value and cite
  only that one — if nothing in the provided context explicitly contains
  the value, say it isn't confirmed rather than filling it in from the
  model's own training data and citing the closest-sounding source. This
  rule went through two iterations after two separate real failures — see
  the case studies below.

### SSE streaming protocol

The chat endpoint (`POST /api/conversations/{id}/chat`) streams
Server-Sent Events in this order:

```
{"type": "intent", "mode": "casual|rag|web|hybrid"}       ← fires twice for non-casual turns:
                                                             once as an immediate placeholder,
                                                             again with the real outcome once
                                                             the loop resolves
{"type": "agent_step", "stage": "tool_call", "tool": "rag_search|web_search", "reasoning": "...", "detail": "..."}
{"type": "agent_step", "stage": "observation", "tool": "...", "detail": "3 document chunk(s) found"}
{"type": "agent_step", "stage": "answering"}
{"type": "cached", "is_cached": true}                    ← cache hit only
{"type": "sources", "sources": [...]}                    ← whenever rag_search was used
{"type": "web_sources", "sources": [...], "degraded": false}  ← whenever web_search was used
{"type": "token", "content": "..."}                       ← repeated
{"type": "done", "content": "...", "prompt_tokens": N, "completion_tokens": M, "cached": false, "latency_ms": N}
{"type": "error", "message": "..."}
```

`degraded: true` on `web_sources` means hybrid mode's web search failed and
the answer is docs-only — added so that failure isn't silent (see the
robustness section below). The old `ask_web_search` event (a
human-in-the-loop prompt for low-confidence Knowledge-mode misses) was
removed once Knowledge mode became strictly `rag_search`-only by design —
there's nothing left to ask permission for, since the loop can't reach the
web from that pin at all; a miss just answers honestly instead.

### The adaptive ReAct loop (`api/agent.py`)

`run_agent_loop()` is a hand-written Reason+Act loop, not a framework
construct: each round makes one fast, non-streaming Ollama tool-calling
"decision" call offering whatever tools the pinned mode allows, executes
the chosen tool, and feeds the observation back in as plain text (not a
reconstructed native `tool_calls` message — simpler, and avoids depending
on the exact wire shape Ollama expects for a tool-call round-trip). Both
tools require a `reasoning` argument in their schema, so every call carries
a structured "why" at zero extra latency — no separate thinking-mode call
needed, and it's exactly the input Stage 2.5's planned audit log will
consume (see `docs/AGENT_ROADMAP.md`). The loop terminates on no tool call,
a repeated `(tool, query)` pair, or a hard iteration cap.

The decision prompt below governs Auto mode's tool choice entirely, and
governs any *additional* optional calls a pinned mode's model makes beyond
its one guaranteed call — pinned modes run their required tool(s) first,
unconditionally, before this decision loop ever gets a turn (see "Mode
routing" above).

**The decision prompt went through a real whiplash cycle worth documenting
plainly**: it started simple ("call a tool if you need more information"),
which under-triggered — the Rust-version case study below happened under
this version. It was then hand-edited, reactively, into a wall of
ALL-CAPS "CRITICAL RULES" plus a second, differently-worded reminder
stapled onto every user message — which made tool selection *worse*, not
better ("searches the web when the answer's in the documents, answers by
itself when it shouldn't"). An 8B model gets *less* reliable the more
overlapping, shouted instructions get piled on, especially two differently
phrased rules about the same decision disagreeing slightly. The fix was to
revert to a small number of clear, non-contradictory rules stated once —
and, more importantly, to stop tuning this prompt against single anecdotes
at all. `scripts/eval_tool_selection.py` exists specifically because of
this cycle: a 12-case, deterministic eval (does it call the right tool, or
correctly call none, for each representative query) that any future
prompt change gets checked against before shipping, the same discipline
already applied to retrieval quality. Current baseline: **10/12**, and the
two remaining failures are a measured model-capability ceiling, not a
wording problem — confirmed by re-running the identical prompt twice and
watching one case flip between pass and fail with no change in between.
Documented as a known limit rather than chased further; see "Known
limitations" below.

### Persistent memory (`api/memory.py`)

A small, global, cross-session store — not scoped per conversation, since
this is a single-user local app with no user table, just chat threads. Two
halves:

- **Read, before answering**: `format_memory_block()` renders stored facts
  into a block appended to every casual/loop system prompt. No embedding
  search — the store is small and personal, so injecting everything
  (capped at `MAX_MEMORY_ITEMS`) is correct here, not a shortcut.
- **Write, after answering**: `extract_memory()` runs as a `BackgroundTask`
  strictly *after* the SSE stream has fully sent (Starlette awaits a
  `StreamingResponse`'s background task only once the body finishes), so a
  slow or failed extraction call can never add latency or an error to the
  visible response. An Ollama tool-calling call decides whether anything in
  the turn was worth remembering.

**Found and fixed: memory saved almost everything.** The first version of
the `save_memory` tool's description was too permissive — real usage
showed it turning *every single question asked* into 2-5 stored
"memories" (`"Their question was about the latest version of Rust"`,
`"They might be looking for detailed information on specific C++23
features"` — restatements of the conversation, not durable facts). Fixed
by rewriting the tool description to be explicit about the boundary
(identity-level facts and explicit standing instructions only — name,
role, "always answer in bullet points" — never the topic of the current
exchange), with negative examples anchoring what doesn't qualify, plus "if
in doubt, save nothing" stated directly. Verified after the fix: a routine
technical question saves zero new memories, where before it would have
saved several. The junk data was purged from the live database, not left
in as dead weight.

**Found and fixed: personal questions triggered a tool call.** Asking "what
is my name?" — a question only answerable from what the user already told
Jignasa — was routing to `web_search`, because the decision prompt had no
rule distinguishing "I already know this from memory" from "I should look
this up." Fixed by adding an explicit, ordered rule: questions about the
user themselves must be answered directly from the memory notes or
conversation, never searched, since neither the web nor the user's own
documents can know who the user is.

### Local model selection (`GET /api/ollama/models`)

The settings modal lets you pick which pulled Ollama model actually writes
the final answer, instead of hardcoding `qwen3:8b`. The endpoint calls
`ollama.list()` and returns each model's name and size, catching any
failure (Ollama not running, empty library) down to an empty list rather
than a 500 — the frontend falls back to "app default" text either way.

**Deliberate scope: this only changes the final-answer model, never the
reasoning loop.** `_stream_ollama()` in `api/llm.py` takes the user's chosen
model purely for the last generation call; the ReAct decision loop
(`api/agent.py`) and memory extraction (`api/memory.py`) always run on the
project's calibrated `OLLAMA_MODEL` regardless of what's selected here. The
reason is `scripts/eval_tool_selection.py`'s 10/12 baseline is specific to
that model — letting a user swap in a smaller or differently-tuned model
for the decision step would silently invalidate that measurement, trading
a reliability number that's actually been checked for one that hasn't.
Swapping the final-answer model is safe because it only affects prose
quality, not which tools get called or what gets remembered.

### Robustness pass

A `_finish_response()` helper (`api/main.py`) wraps the persist-and-respond
step shared by the casual branch and the unified loop branch. Before this existed, each mode branch called
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

### Knowledge base mutations: incremental add + surgical delete (`IndexIDMap`)

The FAISS index started as a plain `IndexFlatIP` with `metadata.json` as a
flat list, positionally aligned to the index's vector order — fine for a
static, build-once index, but it meant the only way to remove a
document's vectors was to re-embed every remaining document and rebuild
from scratch, since FAISS had no way to address "this document's
vectors" specifically.

As of 2026-06-28 (`pipeline/REBUILD_LOG.md` has the full write-up), the
index is wrapped in a `faiss.IndexIDMap`: every vector gets a stable
64-bit integer ID, tracked in `metadata.json`'s new shape —
`{"next_id": int, "vectors": {"<id>": {...}}}` — instead of a bare list.
This makes both knowledge-base mutations cheap and corpus-size-independent:

- **Upload** (`pipeline/_add_to_index.py`): embeds only the new PDF's
  chunks, assigns them the next available IDs, `index.add_with_ids()`.
  Never re-embeds anything already indexed.
- **Delete** (`api/upload.py`'s `delete_knowledge_base_file()`): looks up
  which vector IDs belong to the deleted file, calls
  `index.remove_ids([...])` directly. Measured on the real index (2206
  chunks, 5 documents): **33ms**, where the previous rebuild-based
  approach scaled with total corpus size regardless of how small the
  deleted document was.

Migrating the existing index needed no re-embedding —
`IndexFlatIP.reconstruct_n()` hands back the exact vectors it was given,
so the one-time migration (`pipeline/_migrate_to_id_map.py`) just
reassigns IDs to vectors that already existed. Verified lossless by
running the same query against the pre- and post-migration index side by
side: identical scores and sources, to the float — not just "still
returns results," provably the same results.

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

## Case study 1: a real grounding failure, found and fixed with evidence

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

## Case study 2: the same failure mode recurring, and closing it mechanically

Asked "What's the latest version of Rust, and what changed in it?" in Auto
mode. The answer confidently stated **1.96.0**, citing `[2]` and `[4]`, with
no release date. A manual fact-check found the actual latest version to be
**1.96.1**.

**First check: was this a search problem or a generation problem?**
Measured, not assumed — calling `web_search()` directly with the exact
query the loop had used showed the correct answer sitting in the raw
results the whole time: result `[2]`'s title was literally *"Announcing
Rust 1.96.1 — Rust Blog"*, result `[3]` stated *"Stable: 1.96.1"* in a
structured changelog format. Result `[4]` — the one actually cited — was a
generic GitHub releases page whose snippet didn't mention a version number
at all. This ruled out a retrieval gap immediately: the correct fact was
present and prominent; the model cited the source that didn't support the
claim over the ones that did.

**Confirmed at `temperature=0`, ruling out randomness.** Isolated the
generation step from the rest of the loop — same captured search results,
same `WEB_SYSTEM` prompt, direct `stream_chat()` call — and reproduced the
exact same wrong answer at fully deterministic sampling. This wasn't the
model "getting unlucky" on a sample; it was consistently preferring its own
stale training-data belief about the version number over what was actually
in front of it. The existing citation rule ("re-check that a source
genuinely supports the claim") was already in the prompt from Case Study
1 — an *abstract* self-verification instruction, and the model wasn't
reliably applying it here.

**The fix was mechanical, not just more emphatic wording.** Replaced the
abstract "re-check it supports the claim" instruction with a concrete
matching procedure: for any specific number/version/date/statistic, find
the exact result whose text *contains that value*, and cite only that one
— if no result's text contains it, say the figure isn't confirmed rather
than filling it in from training data. Pattern-matching text is a task
small models handle far more reliably than open-ended "does this genuinely
support X" judgment calls. Re-tested against a clean, unambiguous result
set: correct answer, correct citation.

**What this didn't fully solve, stated plainly**: DuckDuckGo's live
results aren't always this clean — a later run against a *messier* result
set (stable/beta/nightly version numbers mixed across different pages,
some outdated) still produced an occasional wrong number. That residual
error traces to genuine ambiguity in the source data, not a prompt gap, and
is a search-quality ceiling rather than something more prompt engineering
closes. Recorded honestly rather than claimed as fully solved — see "Known
limitations."

**The pattern across both case studies**: the first fix (Case Study 1) was
a general instruction ("verify before citing"); it wasn't specific enough
to survive contact with a genuinely deceptive result (a citation-worthy
title sitting right next to an uncited plain fact). The second fix turned
the same principle into something mechanically checkable. The broader
lesson for anyone extending this project: for small local models, "be more
careful" is weaker guidance than "match this exact pattern" — and both
times, the fix came from measuring the actual search results and actual
model output side by side, not from re-reading the prompt and guessing
what sounded reasonable.

## Case study 3: the prompt cache leaking answers across unrelated conversations

`api/cache.py` caches full responses to skip a repeat LLM call — the key
was `sha256(normalize(query) + mode)`, global across every conversation.
That's correct for a genuinely repeated, standalone question ("what's the
latest Rust version" asked in two different chats should hit the same
cache entry). It's wrong for a *context-dependent* follow-up: "explain
more" or "summarize that" hashes identically regardless of which
conversation asked it or what "that" refers to, so two unrelated
conversations both ending a message with "explain more" would get back
whichever one happened to answer first — a real cross-conversation
correctness bug, not just a caching inefficiency.

**Fix**: fold a short fingerprint of recent history into the key —
the last 2 messages of `prior_history`, joined into `cache_context` in
`api/main.py` and passed to both `get_cached()`/`set_cached()`. A brand-new
conversation's first message still has an empty fingerprint, so genuinely
repeated fresh questions across separate chats still hit the cache exactly
as before; only context-dependent follow-ups now get a different key per
conversation. Also stopped caching zero-source answers ("I don't have
enough information") at all — caching a non-answer risked serving it to a
later, differently-worded-but-similarly-hashed question that might
actually have had a real answer available.

## Case study 4: a fix that looked correct, verified against library source, and wasn't

Built `api/ollama_discovery.py` to solve a real problem: WSL2 users running
Ollama on the Windows host can't reach it at `127.0.0.1:11434` from inside
WSL, since WSL2 has its own network namespace. The fix probed for the
Windows host's gateway IP and, on success, set `os.environ["OLLAMA_HOST"]`
so every `ollama.chat()`/`ollama.list()` call downstream would pick it up.
Code review looked right. Startup logs looked right. `/api/status` correctly
reported the new host as reachable. It didn't work.

**The actual bug required reading the `ollama` package's source, not just
this codebase.** `ollama/__init__.py` constructs a module-level
`_client = Client()` the moment the package is first imported, and
`Client.__init__` reads `os.getenv('OLLAMA_HOST')` exactly once, baking the
resolved host into that instance permanently
(`ollama/_client.py`: `base_url=_parse_host(host or os.getenv('OLLAMA_HOST'))`).
`api/llm.py`'s `from ollama import chat` captures a bound method on that
same frozen instance — and that import happens when `api.main` loads,
which is *before* the FastAPI startup event (where the host detection ran)
ever fires. Setting the env var afterward changed nothing: `chat`/`list`
were already permanently bound to whatever host was resolved at import
time, almost always the unreachable default. `/api/status` wasn't lying
exactly — its probe was a fresh, independent HTTP request that correctly
found the gateway reachable — it just had no relationship to what the
frozen client would actually use, which made the bug worse than a loud
failure: everything *looked* fixed while every real chat call kept
silently eating a connection timeout and falling back to whatever
degrades gracefully (the agent loop skips tools, memory extraction no-ops).

**The fix**: stop treating the env var as sufficient. `ollama_discovery.py`
now owns a lazily-constructed `Client`, explicitly rebuilt whenever host
detection resolves a (different) host, and every call site
(`api/llm.py`, `api/agent.py`, `api/memory.py`, `api/query_transform.py`,
`api/main.py`) goes through `ollama_discovery.client()` instead of the
package's top-level `chat`/`list`. Two of those five call sites were missed
in the first pass of this fix — both wrapped in `try/except` for unrelated
reasons, so the miss was silent rather than a crash, which is exactly why
`grep -rn "from ollama import" api/` is now a standing check documented in
that module's own docstring, not just a one-time cleanup.

**Verified, not just re-reviewed**: a standalone script pointed the client
at a deliberately wrong host (confirmed it failed with `ConnectionError`),
then triggered re-detection with the correct host and confirmed a real
`.list()` call succeeded against it — proving the client actually rebinds
dynamically, which is the exact mechanism the original bug broke.

## Evaluation

Three distinct benchmarks exist, covering different failure modes:

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
- **Tool-selection accuracy** (`scripts/eval_tool_selection.py`): calls
  `run_agent_loop()` directly for 12 representative queries and checks
  whether it picked the right tool(s) — or correctly picked none — no
  answer-quality judgment involved, just the decision step in isolation.
  Exists because of the decision-prompt whiplash documented in "The
  adaptive ReAct loop" above; current baseline is 10/12, with the gap
  attributed to a measured model-capability ceiling rather than left
  unexplained.

The first two feed `GET /api/evaluation/summary`, which the homepage's
"Measured against real questions" section reads live — not hardcoded — so
the numbers shown always reflect whatever was last actually run. Full
current results and methodology caveats:
[`data/evaluations/README.md`](../data/evaluations/README.md). The
tool-selection eval is a development-time check run from the CLI, not
(yet) wired into the homepage.

## Frontend

Covered in full in [`web/README.md`](../web/README.md) — design system
(fonts, colors), the motion library stack and the `#root`-vs-`window`
scroll-container bug that affected multiple components, a rundown of every
homepage motion component and why it exists, and two chat-page bugs found
by actually driving the app with a real (headlessly-patched) browser rather
than reading the code and guessing: a CSS Grid sidebar-collapse layout bug,
and a React 19 discrete-event-flush race that made inline rename appear
completely broken.

## Security & guardrails (`api/security.py`, `api/intent.py`)

- Session IDs validated against a fixed format before any DB lookup.
- Input sanitized (control characters stripped, Unicode NFC-normalized,
  length-capped) before guardrail checks.
- A small blocked-pattern list catches obvious prompt-injection/jailbreak
  attempts (`"ignore previous instructions"`, `"act as if you"`, etc.) —
  this is a basic keyword filter, not a robust defense; treat it as a
  speed bump, not a security boundary.
- Per-IP token-bucket rate limiting (30 req/60s) on the chat and document
  upload endpoints. **Found and fixed**: `_RateLimiter` was fully
  implemented in `api/security.py` but never actually imported or called
  anywhere in `api/main.py` — a real gap between what was claimed and what
  ran, caught by an independent code audit, not by testing (nothing user-
  visible breaks when a rate limiter is silently absent). Now enforced via
  `_limiter.is_allowed(get_client_ip(request))`, returning HTTP 429 —
  verified live by firing 32 rapid requests and confirming the 429s
  actually start appearing. The evaluation endpoints are not currently
  covered by this; worth adding if this project ever runs somewhere
  reachable by more than one person.
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
- **Confirmed safe, no change needed:** CORS uses `allow_origin_regex`
  matching only `localhost`/`127.0.0.1` at any port (`^https?://(localhost|
  127\.0\.0\.1)(:\d+)?$` in `api/main.py`) — a regex, not a hardcoded port
  list, specifically because Vite's dev server silently moves to the next
  free port (5174, 5175...) when 5173 is taken, and a fixed-port allowlist
  would have started rejecting the frontend the moment that happened. Still
  loopback-only, no wildcard host, verified with a live request from a
  disallowed origin (`http://evil.com`) confirmed rejected with "Disallowed
  CORS origin" while any localhost port is accepted; all SQL in
  `api/db.py`/`api/cache.py` uses
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

## Audit trail (`api/audit.py`)

Stage 2.5 of [`docs/AGENT_ROADMAP.md`](AGENT_ROADMAP.md): a structured,
queryable log of what the app actually did, separate from the ephemeral
per-message `agent_trace` already streamed to the frontend for the live
"thinking" UI. That trace is per-turn and disappears once you close the
tab; the audit log is a permanent SQLite table (`audit_log`, same
connection pattern as `api/db.py`) that persists independently of the chat
UI.

One row per event, with `session_id`, a UTC timestamp, an `event_type`
(`decision`, `tool_call`, `data_access`, `guardrail_block`), an optional
`tool_name`, `input_summary`/`output_summary`, and a `reasoning` field.
Four instrumentation points, all in `api/main.py`:

- **`guardrail_block`** — logged in the prompt-injection `except ValueError`
  handler, so a denied request is queryable history, not just a log line.
- **`decision`** (routing) — logged right after the heuristic/pinned mode is
  resolved, capturing which path a message took and why.
- **`tool_call` + `data_access`** — logged by iterating `agent_result.trace`
  after the ReAct loop finishes, reusing the `reasoning` argument the tool
  schema already requires (see "The adaptive ReAct loop" above) rather than
  inventing a second explanation for the same decision.
- **`decision`** (final outcome) — logged once the outcome label (rag / web
  / hybrid / casual) is settled, independent of which button was pinned.

Every call site is wrapped in try/except at the `log_event()` level, so a
logging failure can never break the actual chat response — an audit trail
that can crash the product it's auditing defeats its own purpose.

Read via `GET /api/conversations/{session_id}/audit`, returning the full
ordered trail. No frontend UI for it by design — this is a
developer/debugging surface, not something the target user (someone
chatting with their own documents) needs to see. Example output for a
single web-search turn:

```json
[
  {"event_type": "decision", "tool_name": null,
   "input_summary": "mode=web", "output_summary": "routed=loop",
   "reasoning": "not casual; web tools available"},
  {"event_type": "tool_call", "tool_name": "web_search",
   "input_summary": "latest stable Rust version",
   "output_summary": null,
   "reasoning": "Question asks for a current version number, which changes over time and isn't reliable from training data."},
  {"event_type": "data_access", "tool_name": "web_search",
   "input_summary": "latest stable Rust version",
   "output_summary": "5 results", "reasoning": null},
  {"event_type": "decision", "tool_name": null,
   "input_summary": "outcome", "output_summary": "web",
   "reasoning": "web_search attempted with results"}
]
```

## Known limitations (stated plainly, not hidden)

- **DuckDuckGo search quality** is the ceiling for web mode's grounding —
  free and no API key, but not as comprehensive as Bing/Google-backed
  search. This is a deliberate trade-off of staying fully local/free, not
  an oversight. Case Study 2 above shows a concrete case where this shows
  up: messy, conflicting version numbers spread across multiple pages
  occasionally still produce a wrong specific number even with a
  mechanically precise citation rule in place — the ambiguity is in the
  source data, not something a prompt fix closes.
- **qwen3:8b's grounding fidelity** can fail under weak evidence (see the
  case studies) — mitigated with explicit prompt instructions, not
  eliminated. A larger model would have more headroom here, at the cost of
  the fully-local constraint.
- **Tool-selection reliability tops out around 10/12** on
  `scripts/eval_tool_selection.py`'s benchmark — confirmed to be an 8B
  model capability ceiling (re-running the identical prompt reproduces
  different results on the same borderline cases), not a prompt-wording
  gap. The decision step intentionally always runs on the calibrated local
  `OLLAMA_MODEL`, never on whatever BYOK provider or alternate local model
  is configured for the final answer (see "Local model selection" above) —
  so the actual next lever is a stronger *reasoning* model, which isn't
  wired up on purpose, not an oversight.
- **FAISS `IndexFlatIP`** is exact search, not approximate — correct and
  fast at this corpus size (~2000 chunks), but would need revisiting
  (HNSW/IVF, or a dedicated vector DB) well before reaching 100K+ chunks or
  needing per-user filtering.
- **RAGAS scores use a local judge model**, not a frontier model — useful
  for tracking regressions over time within this project, not for
  comparing against published RAGAS benchmarks from other projects.
