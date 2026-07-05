# Upgrading Jignasa: The Agent Roadmap

This roadmap outlines the transformation of Jignasa from a reactive RAG chatbot into a proactive, fully local agent with dynamic tool capabilities, persistent memory, and a real audit trail.

**Status: complete, as scoped.** Stage 1 (adaptive ReAct loop + memory) and Stage 2.5 (audit trail) are implemented and shipped. Stage 2 (MCP) and Stage 3 (native desktop packaging) were deliberately not pursued — each has a short note below explaining the actual reasoning, not just "ran out of time." This is the final state of the project.

## Proposed Changes

### Stage 1: The Brain (Memory & Adaptive ReAct Loop) — ✅ Implemented
To give Jignasa true agency and personality, we built a custom adaptive ReAct (Reason + Act) loop with long-term memory. No LangChain — every piece below is hand-written Python.

*   **Persistent Memory Core (`api/memory.py`):** A global, cross-session store of durable facts (name, standing instructions), extracted via Ollama tool-calling after each turn and injected into every future system prompt. Deliberately conservative — the extraction prompt was tightened mid-build after it over-saved (turning every question asked into a "memory"); it now saves almost nothing by design, matching how ChatGPT's memory behaves rather than logging a transcript. A deterministic regex safety net catches self-introductions ("my name is X") independent of the LLM call, since that's the single highest-value fact to never miss. Viewable and deletable from the sidebar (`MemoryModal.tsx`).
*   **Dynamic Routing:** A cheap heuristic (`classify_intent` in `api/intent.py`) catches obvious small talk instantly, with zero LLM round-trip. Everything else enters the loop below. In **Auto** mode, that loop decides for itself, every turn, whether it needs a tool at all — the same adaptive behavior as originally scoped.
*   **The Execution Loop (`api/agent.py`):** A native Python loop around Ollama's tool-calling API offering `rag_search`/`web_search` (MCP tools are Stage 2). Both tools require a `reasoning` argument as part of their schema — a structured "why" captured at zero extra cost, which is exactly what Stage 2.5's audit log consumes. **Found and fixed:** pinning a mode (Knowledge/Web/Hybrid) originally only changed which tools were *on the menu*, still leaving the model free to skip calling them — which meant Knowledge mode could intermittently answer as plain chat with no sources, silently defeating the point of pinning it. Pinned modes now force their tool deterministically every turn (`force_tools` in `run_agent_loop`); only Auto mode still adaptively decides whether a tool is worth calling at all. See [`docs/TECHNICAL.md`](TECHNICAL.md) for real case studies from tuning this loop — tool-selection reliability, citation grounding, and this pinned-mode fix — all found, measured, and fixed with evidence rather than guesswork.
*   **UI Reflection (Thinking State):** A live "Thought for N steps" accordion (`AgentTrace` in `ChatInterface.tsx`) streams each tool call and its reasoning as it happens, then collapses into history. The mode badge shown to the user always reflects the actual *outcome* of a turn (which tools it ended up using), never which button was pinned or an internal "agent" label — matching how Claude's own tool-use UI never exposes "agent mode" as a separate concept.

### Stage 2: MCP Integration & Security (Human-in-the-Loop) — Not pursued, by decision
Model Context Protocol (MCP) would let Jignasa learn new skills from arbitrary third-party servers, but that's exactly the problem: it opens a real security surface (arbitrary tool execution from code you didn't write) that can't be taken seriously without dedicated sandboxing and a genuine Human-in-the-Loop approval flow, not a token gesture. Building a half-secured version of that would be worse than not building it. Given the choice between spreading into a third capability or making the existing one (the ReAct loop, across every mode, with real evaluation and now a real audit trail) solid and demonstrable, this project chose depth over breadth. The original plan is left below as a record of the design, not a live TODO.

*   **Frontend UI (The Sidebar):** Create a sliding panel with an input to add an MCP server command and a scrollable list of active, connected MCP servers.
*   **Backend MCP Client:** Implement a Python MCP client that connects to user-defined servers via standard input/output (stdio). 
*   **Security & Verification (Crucial):** Jignasa will **not** blindly execute high-risk MCP instructions. We will implement a Human-in-the-Loop (HITL) prompt for destructive actions (e.g., "This MCP server wants to delete 5 files. Approve or Deny?"). 

### Stage 2.5: Observability & Audit Trail — ✅ Implemented
If you can't trace what the agent did, you can't debug it, secure it, or trust it. Scoped to the normal chat flow (casual + the adaptive tool-calling loop across every mode) — there's no MCP to audit, since Stage 2 wasn't built.

*   **Structured Audit Log (`api/audit.py`):** An `audit_log` SQLite table recording one row per action: session id, timestamp, event type (`decision`, `tool_call`, `data_access`, `guardrail_block`), tool name, input/output summaries, and a `reasoning` field capturing *why*.
*   **Decisions, Not Just Outcomes:** Every routing decision — the heuristic router's casual/agent split, and the final choice of which system prompt answered the question — is logged with its reasoning, not just its label.
*   **Tool & Data-Access Tracing:** Every `rag_search`/`web_search` call from the adaptive loop writes an audit entry with the query and the model's own stated reasoning for calling it (reusing the `reasoning` argument already required by both tool schemas — see Stage 1), plus a paired entry for what came back.
*   **Security Events in the Trail:** Guardrail blocks and prompt-injection detections (`api/security.py`) become audit entries, not just log lines — denied requests are queryable history.
*   **Inspection Surface:** `GET /api/conversations/{id}/audit` returns the full trail for a conversation. No frontend UI for it yet by design — this is a developer/debugging surface, not a user-facing feature; see [`docs/TECHNICAL.md`](TECHNICAL.md) for example output.

### Stage 3: The Standalone Desktop App (PySide6 & Onboarding) — Not pursued, by decision
Jignasa ships as a self-hosted web app instead (`docker compose up`, see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)) — that already gets someone from zero to a running instance in one command, with no Python/Node toolchain required, which is the actual problem native packaging would solve. A PySide6/PyInstaller wrapper would mostly demonstrate packaging skill, not agent-engineering skill, and would take real time away from the parts of this project that do (Stages 1 and 2.5 above). Left below as a record of the design, not a live TODO.

*   **Desktop Onboarding Flow:** When the app is launched for the first time, the user will be presented with a beautiful setup wizard. They must explicitly grant OS file permissions, agree to the license, and configure their local model.
*   **Native Desktop Wrapper (PySide6):** Write a `desktop_main.py` script using `PySide6` and `QtWebEngine` to open a native OS window displaying the React UI, ensuring identical rendering on Windows, Mac, and Linux.
*   **PyInstaller Bundling:** Use `PyInstaller` to compress the Python interpreter, dependencies, and the React frontend into a single distributable executable.
*   **CI/CD Pipeline:** Create a GitHub Actions workflow to automatically build these executables on every new release.
