# Upgrading Jignasa: The Desktop Agent Roadmap

This roadmap outlines the transformation of Jignasa from a reactive RAG chatbot into a proactive, fully local desktop agent with dynamic tool capabilities and persistent memory.

## Proposed Changes

### Stage 1: The Brain (Memory & Adaptive ReAct Loop) — ✅ Implemented
To give Jignasa true agency and personality, we built a custom adaptive ReAct (Reason + Act) loop with long-term memory. No LangChain — every piece below is hand-written Python.

*   **Persistent Memory Core (`api/memory.py`):** A global, cross-session store of durable facts (name, standing instructions), extracted via Ollama tool-calling after each turn and injected into every future system prompt. Deliberately conservative — the extraction prompt was tightened mid-build after it over-saved (turning every question asked into a "memory"); it now saves almost nothing by design, matching how ChatGPT's memory behaves rather than logging a transcript. A deterministic regex safety net catches self-introductions ("my name is X") independent of the LLM call, since that's the single highest-value fact to never miss. Viewable and deletable from the sidebar (`MemoryModal.tsx`).
*   **Dynamic Routing:** A cheap heuristic (`classify_intent` in `api/intent.py`) catches obvious small talk instantly, with zero LLM round-trip. This went further than originally scoped here: instead of gating only the *first* upfront choice, every non-casual message — regardless of which mode is pinned — enters the loop below, which then decides for itself, every turn, whether it needs a tool at all.
*   **The Execution Loop (`api/agent.py`):** A native Python loop around Ollama's tool-calling API offering `rag_search`/`web_search` (MCP tools are Stage 2). Both tools require a `reasoning` argument as part of their schema — a structured "why" captured at zero extra cost, which is exactly the input Stage 2.5's audit log will consume. Pinning a mode (Knowledge/Web/Hybrid) only changes which tools are on the menu; it never forces a call. See [`docs/TECHNICAL.md`](TECHNICAL.md) for two real case studies from tuning this loop's decision prompt — one on tool-selection reliability, one on citation grounding — both found, measured, and fixed with evidence rather than guesswork.
*   **UI Reflection (Thinking State):** A live "Thought for N steps" accordion (`AgentTrace` in `ChatInterface.tsx`) streams each tool call and its reasoning as it happens, then collapses into history. The mode badge shown to the user always reflects the actual *outcome* of a turn (which tools it ended up using), never which button was pinned or an internal "agent" label — matching how Claude's own tool-use UI never exposes "agent mode" as a separate concept.

### Stage 2: MCP Integration & Security (Human-in-the-Loop)
Model Context Protocol (MCP) allows Jignasa to learn new skills, but introduces security risks if servers are malicious.

*   **Frontend UI (The Sidebar):** Create a sliding panel with an input to add an MCP server command and a scrollable list of active, connected MCP servers.
*   **Backend MCP Client:** Implement a Python MCP client that connects to user-defined servers via standard input/output (stdio). 
*   **Security & Verification (Crucial):** Jignasa will **not** blindly execute high-risk MCP instructions. We will implement a Human-in-the-Loop (HITL) prompt for destructive actions (e.g., "This MCP server wants to delete 5 files. Approve or Deny?"). 

### Stage 2.5: Observability & Audit Trail
If you can't trace what the agent did, you can't debug it, secure it, or trust it. As soon as the agent can pick its own tools (Stage 2), every action needs a record of what tool was used, what data it touched, and why — not just an error line in stdout when something breaks.

*   **Structured Audit Log:** A new `audit_log` SQLite table, following the same pattern as `api/db.py`'s existing `chats`/`prompt_cache` tables, recording one row per agent action: timestamp, session/message id, event type (`decision`, `tool_call`, `data_access`, `guardrail_block`), tool name, input, output summary, and a `reasoning` field capturing *why*.
*   **Decisions, Not Just Outcomes:** Upgrade intent routing (currently `classify_intent_llm` in `api/intent.py`, which returns a bare label) and future MCP/tool-selection steps to emit a short reasoning string alongside the chosen action — that's what gets written to the "why" field.
*   **Tool & Data-Access Tracing:** Every tool invocation — RAG retrieval, web search, future MCP tools — writes an audit entry describing what was queried or accessed (which chunks, which URLs, which MCP resources) and what came back, so retrieval and execution stay traceable after the fact.
*   **Security Events in the Trail:** Guardrail blocks and prompt-injection detections (`api/security.py`) become audit entries too, not just log lines, so denied or flagged actions are queryable history instead of something that only ever hit stdout.
*   **Inspection Surface:** A read endpoint (e.g. `GET /api/conversations/{id}/audit`) to pull the trace for a conversation — enough to debug a bad answer or review what an agent run actually did. No frontend UI yet; that can follow the same "future work" pattern as the Stage 1 UI reflection item.

### Stage 3: The Standalone Desktop App (PySide6 & Onboarding)
We will package the entire stack so users can download a single `.exe` or `.dmg` from GitHub Releases.

*   **Desktop Onboarding Flow:** When the app is launched for the first time, the user will be presented with a beautiful setup wizard. They must explicitly grant OS file permissions, agree to the license, and configure their local model.
*   **Native Desktop Wrapper (PySide6):** Write a `desktop_main.py` script using `PySide6` and `QtWebEngine` to open a native OS window displaying the React UI, ensuring identical rendering on Windows, Mac, and Linux.
*   **PyInstaller Bundling:** Use `PyInstaller` to compress the Python interpreter, dependencies, and the React frontend into a single distributable executable.
*   **CI/CD Pipeline:** Create a GitHub Actions workflow to automatically build these executables on every new release.
