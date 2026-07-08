# Changelog

Dated entries for real fixes made after initial development — what was
noticed, what was actually wrong, and what changed. Kept separate from the
root [README.md](../README.md) so a first-time visitor sees the project
first, not a running log of bug fixes.

### 2026-07-08 — README overstated what breaks without Ollama on BYOK

- **The README claimed that using your own API key with no Ollama running
  at all disables document search, web search, and memory together** — that
  turned out to only be true for one of those three, and only in one mode.
  Tested directly (not assumed): simulated Ollama being completely
  unreachable and ran the real agent code against the real document index.
  - **Knowledge / Web / Hybrid mode kept working perfectly** — 5 real
    chunks retrieved from the actual knowledge base with zero Ollama
    involved. Pinning a mode forces its tool call before the code ever
    tries to reach Ollama, and document search's embeddings come from a
    separate always-local model (sentence-transformers), not Ollama.
  - **Auto mode is the one real exception** — deciding *whether* to search
    is itself something only Ollama can answer, so with Ollama unreachable
    Auto mode found 0 sources and just answered from the cloud model
    directly, same as the old README described.
  - Long-term memory: saving *new* facts from a turn needs Ollama and
    silently no-ops without it (chat itself is never affected); memories
    already saved earlier still load and work normally regardless.
  - README corrected to say this precisely instead of lumping all three
    features under one blanket "stays off" statement — if you're running
    fully keyless-Ollama, pin Knowledge/Web/Hybrid instead of leaving it on
    Auto and search still works.

### 2026-07-08 — Settings modal Save button gave no feedback

- **Clicking "Save" in the Model settings modal closed the popup instantly
  with zero confirmation, and typing a cloud API key made Chrome pop up its
  own "Save password?" prompt** — reported after someone tried BYOK for the
  first time and (reasonably) assumed Save was broken. Two separate causes:
  - The Save button called `onClose()` in the same instant as saving, so
    nothing on screen ever showed the click had done anything.
  - The API key field used `<input type="password">`. Chrome doesn't need a
    real `<form>` to offer to save a password — it just watches for a
    filled password field disappearing from the page right after a click,
    which is exactly what closing the modal did. `autocomplete="off"` does
    nothing here; Chrome has ignored that attribute for password fields
    since 2014.
  - Fixed both: Save now shows a visible "Saved ✓" confirmation with a
    "Saved to this browser. Closing…" line for about a second before the
    modal closes, and the API key field is no longer a real password
    input — it's a normal text field visually masked with CSS
    (`-webkit-text-security`), with a Show/Hide toggle for checking what
    you typed. Since Chrome never sees a password field at all, there's
    nothing for its save-password heuristic to key off. Verified with a
    headless-browser test: field renders masked by default, Show/Hide
    toggles it, clicking Save immediately renders the confirmation, and
    the value lands correctly in the browser's own `localStorage`.
  - To be clear on where the key goes, since that was also asked: it's
    saved only in your own browser's `localStorage`, never sent to or
    stored by the backend server — same as before, just now actually
    confirmed on screen instead of left to assumption.

### 2026-07-05 — Auto mode missing obvious searches, homepage stats getting stuck

- **Auto mode sometimes answered from its own memory instead of searching
  your documents, even for clearly document-related questions.** Noticed
  when asking "tell about AI engineering concepts" — it answered on its
  own, but the exact same topic asked as "what is AI engineering?" in
  Knowledge mode correctly searched. The reason: the instruction telling
  the model when to search documents only gave it question-shaped examples
  ("what does X do", "explain how Y works"). "Tell about X" is a command,
  not a question, so it fell outside what the model recognized as
  "obviously search this." Fixed by rewording the instruction to explicitly
  cover commands too, and added the exact failing question as a permanent
  automated test (`scripts/eval_tool_selection.py`) so this can't quietly
  break again. Verified live — the same question now correctly searches
  the knowledge base.
- **A smaller, related finding while checking this:** first attempt at the
  wording fix looked like it broke two *other*, previously-working
  questions. Before assuming that and reverting, re-tested those same two
  questions against the completely unedited, original wording — and they
  failed there too. So that wasn't something this fix broke; it's the
  local model occasionally being unsure on borderline cases regardless of
  wording, which was already a known, accepted limitation. Worth
  mentioning because it's exactly the kind of thing that's easy to
  misdiagnose as "my change caused a regression" without checking.
- **The homepage's live evaluation numbers could get stuck showing "no
  results" and never recover without a manual page reload**, reported by
  someone testing the project on their own laptop. On a slower machine,
  the backend can take longer to finish starting up than the page's
  retry window allowed for, and once that window ran out, the page showed
  the exact same message as "no evaluation has ever been run" — no way to
  tell the two apart, and no further attempts after that. Fixed three
  ways: gave the backend more time before giving up, made the two
  situations show different, honest messages, and — the actual fix for
  the "stuck forever" part — added a quiet background retry that keeps
  checking indefinitely, so the section fixes itself the moment the
  backend catches up, with no reload needed. Verified by deliberately
  starting the page with the backend off, then turning it on and watching
  the real numbers appear on their own.
- Corrected a code comment that claimed the memory feature only works in
  some chat modes — it doesn't, it works the same everywhere, the comment
  was just never updated after that changed. Also added one clear, single
  place in the backend code listing exactly which of these behind-the-
  scenes features apply to which chat modes, instead of that being spread
  across the code and easy to lose track of.

### 2026-07-05 — Ollama fix completed, docs corrected, repo cleanup

- **Two Ollama call sites (`api/query_transform.py`) were still using the
  old default client**, missed in the previous fix. RAG query rewriting
  would silently stop working (falling back to the raw question, no error
  shown) in exactly the WSL-gateway case the fix was built for. Now
  consistent everywhere — confirmed with `grep -rn "from ollama import"
  api/` that only `ollama_discovery.py` itself imports from the package
  directly.
- **Fixed a duplicate React key on document source cards** — `key={s.rank}`
  could collide when hybrid mode or multiple search iterations retrieved
  overlapping chunks, silently dropping or mis-rendering a card. Now a
  compound key that can't collide.
- **The GitHub Pages showcase kept redeploying (and occasionally failing)
  from unrelated app changes** — its trigger matched all of `web/**`,
  which also contains the real chat app's own source. Scoped to just the
  files the showcase page's homepage actually imports.
- **Documentation caught up with the code — several claims were flatly
  wrong**, not just outdated wording: the architecture docs still said
  pinning a mode "never forces a tool call" (the opposite of the fix a few
  days earlier), the security docs described CORS as a fixed origin list
  (it's been a regex for a while), and the rate-limiter claim didn't
  mention it was dead code until recently. All corrected, with the Ollama
  client bug and the prompt-cache leak added as proper case studies in
  `docs/TECHNICAL.md` — this project's whole premise is admitting real bugs
  with evidence, not just claiming things work.
- Removed 3 unused leftover files from the original Vite scaffold template
  (`react.svg`, `vite.svg`, `hero.png`) that nothing in the app referenced.

### 2026-07-03 — Quit reliability + Ollama auto-detection follow-up

- **Quit Jignasa could falsely report "Couldn't confirm the backend shut
  down"** even when it actually worked. The post-shutdown check went
  through Vite's dev proxy, which returns a real (non-throwing) HTTP 502
  when the backend is dead but Vite is still alive for a moment longer —
  the old check only trusted a thrown `fetch()` as "it's down" and read
  that 502 as "still running." Now polls the backend directly, bypassing
  the proxy, and checks the response status instead of ignoring it.
- **Ollama host is now auto-detected, WSL included.** At startup,
  `api/ollama_discovery.py` probes `127.0.0.1:11434`; if that fails and
  it detects it's running inside WSL2, it automatically tries the Windows
  host's gateway IP instead — no more manually exporting `OLLAMA_HOST` for
  that specific setup. An explicit `OLLAMA_HOST` you've already set is
  always respected, never overridden. `/api/status` now reports
  reachability, and the sidebar shows a clear "Can't reach Ollama at
  {host}" message instead of a generic error surfacing only after you send
  a message.

### 2026-07-03 — Reliability & correctness pass

Real usage turned up a batch of genuine bugs, not cosmetic nitpicks. Fixed:

- **Knowledge/Web/Hybrid modes could silently answer as plain chat with no
  sources.** Pinning a mode only *permitted* its tool — the model could
  still decide not to call it. Pinned modes now call their tool
  deterministically every turn; only Auto mode still adaptively decides
  (`api/agent.py`'s `force_tools`).
- **Cache key collision across unrelated conversations.** The prompt cache
  was keyed on message text + mode only, globally — a context-dependent
  follow-up like "explain more" in one conversation could return a
  different conversation's cached answer. Now folds in a short fingerprint
  of recent history, and zero-source answers are never cached at all
  (`api/cache.py`).
- **"Quit Jignasa" wasn't fully reliable.** Added a Windows fallback
  (`os.killpg` doesn't exist there), a SIGKILL escalation if graceful
  shutdown hangs on an open connection, and the frontend now actually
  verifies the backend went down instead of assuming success.
- **First launch could show a blank white screen.** `run_all.sh`/`run_all.bat`
  now install missing frontend dependencies automatically and wait for the
  backend to actually be ready before opening the browser, instead of a
  blind timer. Added a static HTML loading splash as a last-resort fallback.
- **Installed PWA required deleting and reinstalling to get updates.** Added
  `skipWaiting`/`clientsClaim` so a new version now takes over automatically.
- **The rate limiter was defined but never actually applied** to any route
  — now enforced on chat and document upload (429 after 30 requests/minute
  per IP).
- **Wrong model name shown in the UI.** The chat page showed a hardcoded
  backend value that didn't reflect BYOK or an alternate local model
  selection; now derived from your actual active setting.
- **Sidebar had no closing animation.** A CSS Grid track change
  (`264px 1fr → 1fr`) isn't something a browser can animate between, so
  the exit animation played invisibly. Fixed by keeping the grid shape
  constant and animating the sidebar's own width instead.
- **Deleting a conversation had no confirmation** — one misclick, gone.
  Now uses the same click-to-arm confirm pattern as Quit/Clear-memories.
- **No guidance for WSL users whose Ollama runs on the Windows side** — a
  real networking boundary (WSL2's separate network namespace), not a bug,
  but it produced a confusing generic error with no explanation. Errors
  now specifically say "Can't reach Ollama" with a pointer to the fix, and
  the README documents both options (run Ollama inside WSL, or set
  `OLLAMA_HOST`, which needed zero code changes since the `ollama` client
  already reads it natively).

Known, deliberately not changed: Auto mode's decision prompt still
proactively searches documents for concept questions even when the
knowledge base might not cover them — this is a calibrated, eval-tested
behavior (`scripts/eval_tool_selection.py`), and the "worse answers" reports
that prompted this pass are more plausibly explained by the cache bug above.
Not touching it without re-running the eval to confirm a change actually helps.
