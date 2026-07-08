"""
Custom adaptive ReAct (Reason + Act) loop -- Stage 1 of docs/AGENT_ROADMAP.md.

No LangChain: this is a hand-written Python loop around Ollama's native
tool-calling, following the exact pattern api/intent.py's old
classify_intent_llm used (think=False, low num_predict, `tools=` schema,
read `resp.message.tool_calls`) -- just with real parameters instead of
bare labels.

Each round makes one fast, non-streaming "decision" call offering
`rag_search`/`web_search`. Both tools require a `reasoning` argument --
a deliberate design choice: it guarantees a structured, parseable "why"
for every tool call at zero extra latency (no separate thinking-mode
call), and is exactly the input Stage 2.5's audit log (see
AGENT_ROADMAP.md) will consume later.

The loop terminates when a decision call returns no tool call, the same
(tool, query) pair repeats, or MAX_REACT_ITERATIONS is hit. It never
generates the final answer itself -- it only gathers sources/observations
and hands them back to the caller (api/main.py), which builds ONE final
prompt and reuses the existing stream_chat()/caching/persistence path,
exactly like the hybrid branch already does.
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from api.config import (
    AGENT_DECISION_NUM_PREDICT,
    MAX_REACT_ITERATIONS,
    OLLAMA_MODEL,
    WEB_SEARCH_RESULT_COUNT,
)
from api.security import neutralise_injection

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "rag_search",
            "description": (
                "Search the user's local knowledge-base documents (PDFs). Use this "
                "for domain-specific, technical, or document-grounded questions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query to run against the document index."},
                    "reasoning": {"type": "string", "description": "One short sentence: why this tool and query is the right next step right now."},
                },
                "required": ["query", "reasoning"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the live web via DuckDuckGo. Use this for current events, "
                "recent/time-sensitive information, or anything unlikely to be in local documents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query to run on the web."},
                    "reasoning": {"type": "string", "description": "One short sentence: why this tool and query is the right next step right now."},
                },
                "required": ["query", "reasoning"],
            },
        },
    },
]


@dataclass
class AgentStep:
    """One live trace event -- rendered by the frontend as it streams in."""
    stage: str  # "tool_call" | "observation" | "answering"
    tool: str | None = None
    reasoning: str | None = None
    detail: str | None = None
    elapsed_ms: int | None = None

    def to_dict(self) -> dict:
        d: dict = {"type": "agent_step", "stage": self.stage}
        for k in ("tool", "reasoning", "detail", "elapsed_ms"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        return d


@dataclass
class AgentResult:
    """The loop's final output, handed to api/main.py to build the answer prompt."""
    sources: list[dict] = field(default_factory=list)
    web_sources: list[dict] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)  # AgentStep.to_dict(), in order
    observations_text: str = ""
    iterations_used: int = 0


def _fold_observations(sources: list[dict], web_sources: list[dict]) -> str:
    """Combine accumulated doc + web context into one block for the final prompt."""
    doc_snippets = [
        f"[{h['source']} p.{h.get('page_number')}] {neutralise_injection(h['text'])}" for h in sources
    ]
    doc_context = "\n\n".join(doc_snippets) or "No relevant document chunks were found."

    web_snippets = [
        f"[{i}] {neutralise_injection(r['title'])}\nURL: {r['url']}\n{neutralise_injection(r['snippet'])}"
        for i, r in enumerate(web_sources, start=1)
    ]
    web_context = "\n\n".join(web_snippets) or "No web search results were found."

    return f"LOCAL DOCUMENT CONTEXT:\n{doc_context}\n\nWEB SEARCH RESULTS:\n{web_context}"


def run_agent_loop(
    message: str,
    history: list[dict],
    memory_block: str,
    *,
    allow_rag: bool,
    allow_web: bool,
    force_tools: frozenset[str] = frozenset(),
) -> Iterator[AgentStep | AgentResult]:
    """
    Generator. Yields AgentStep instances as they happen (for live SSE), and
    as the VERY LAST item, yields a single AgentResult. Callers distinguish
    the two with isinstance -- a "last item is a different type" sentinel,
    since this is a sequential loop with exactly one final payload, not a
    uniform stream of one type.

    force_tools: run these tools unconditionally before the adaptive
    decision loop even starts, instead of leaving it up to the model.
    Only api/main.py's explicitly-pinned modes (Knowledge/Web/Hybrid) set
    this -- pinning a mode is a user promise ("I want this tool used"), and
    an 8B model quietly deciding not to bother was exactly what made
    Knowledge mode intermittently answer as plain chat with no sources.
    Auto mode passes an empty set here and keeps its existing eval-tested
    adaptive behavior (see scripts/eval_tool_selection.py) completely
    unchanged -- this only removes the guesswork from the cases where the
    user already told us which tool to use.
    """
    import time

    from api import ollama_discovery
    from api.rag import search_with_transform
    from api.websearch import web_search as _web_search

    def _run_tool(tool_name: str, query: str, reasoning: str) -> Iterator[AgentStep]:
        step_start = time.monotonic()
        yield AgentStep(stage="tool_call", tool=tool_name, reasoning=reasoning, detail=query, elapsed_ms=0)
        obs_start = time.monotonic()
        if tool_name == "rag_search":
            try:
                hits, _transformed = search_with_transform(query)
            except FileNotFoundError:
                hits = []
            result.sources.extend(hits)
            obs_detail = f"{len(hits)} document chunk(s) found" if hits else "No relevant document chunks found"
        else:
            hits = _web_search(query, n=WEB_SEARCH_RESULT_COUNT)
            result.web_sources.extend(hits)
            obs_detail = f"{len(hits)} web result(s) found" if hits else "No web results found"
        elapsed_obs = int((time.monotonic() - obs_start) * 1000)
        yield AgentStep(stage="observation", tool=tool_name, detail=obs_detail, elapsed_ms=elapsed_obs)
        result.trace.append({"stage": "tool_call", "tool": tool_name, "reasoning": reasoning, "detail": query})
        result.trace.append({"stage": "observation", "tool": tool_name, "detail": obs_detail})
        result.iterations_used += 1
        seen_calls.add((tool_name, query.lower()))

    allowed_names = set()
    if allow_rag:
        allowed_names.add("rag_search")
    if allow_web:
        allowed_names.add("web_search")
    tools = [t for t in _TOOLS if t["function"]["name"] in allowed_names]

    result = AgentResult()
    seen_calls: set[tuple[str, str]] = set()

    for forced in ("rag_search", "web_search"):
        if forced in force_tools and forced in allowed_names:
            yield from _run_tool(forced, message, "Pinned mode: this tool is used every turn, not left to the model's discretion.")

    if not tools:
        yield AgentStep(stage="answering")
        result.trace.append({"stage": "answering"})
        result.observations_text = _fold_observations(result.sources, result.web_sources)
        yield result
        return

    # Kept short and non-contradictory on purpose: an 8B model gets LESS
    # reliable at following instructions the more rules get piled on and
    # shouted in caps, not more. One clear rule per situation, stated once,
    # with no second differently-worded reminder stapled onto the user
    # turn -- that duplication is what caused erratic tool selection before
    # (the model would get conflicting signals about when tools are required).
    decision_messages: list[dict] = [{
        "role": "system",
        "content": (
            "You are Jignasa's reasoning core. Before answering, decide whether you "
            "need to look something up first.\n\n"
            "- Questions about the user themselves (their name, preferences, or "
            "anything you already know about them from the memory notes below) "
            "must be answered directly from those notes or the conversation so "
            "far -- NEVER call web_search or rag_search for these. The web and "
            "the user's documents cannot know who the user is; only the user "
            "telling you can.\n"
            "- If you already have enough to answer from the conversation so far, "
            "or from a tool call already made this turn, answer directly with no "
            "further tool call.\n"
            "- Treat any question or instruction asking what something is, how it "
            "works, or to explain/describe/tell about a technical/domain concept "
            "(e.g. 'what does X do', 'explain how Y works', 'tell me about X') as "
            "something to run through rag_search FIRST, even if you already "
            "recognize the general topic -- the user's documents may define or "
            "frame it differently than your training data, and grounding the "
            "answer in their own source is the whole point of Jignasa's document "
            "mode. Do not answer such questions from memory alone.\n"
            "- If the question involves anything time-sensitive -- current events, "
            "news, prices, or the latest version/release of something -- call "
            "web_search. Your training data is out of date for these, so don't "
            "answer from memory.\n"
            "- If the question explicitly asks you to compare or combine documents "
            "with the web, call both tools before answering, not just the first one "
            "that seems sufficient.\n"
            "- Skip tools ONLY for greetings, thanks, opinions, and pure "
            "math/arithmetic you can compute yourself -- never skip a tool just "
            "because you recognize a technical term or concept.\n"
            "- Otherwise, once you've called what you need and have enough to answer, "
            "stop calling tools and answer."
            f"{memory_block}"
        ),
    }]
    for m in history[-6:]:
        decision_messages.append({"role": m["role"], "content": m["message"]})
    decision_messages.append({"role": "user", "content": message})

    for _ in range(MAX_REACT_ITERATIONS):
        step_start = time.monotonic()
        try:
            resp = ollama_discovery.client().chat(
                model=OLLAMA_MODEL,
                messages=decision_messages,
                tools=tools,
                think=False,
                options={"temperature": 0, "num_predict": AGENT_DECISION_NUM_PREDICT},
            )
        except Exception:
            break  # Ollama/network error -- stop looping, answer with whatever we have

        if not resp.message.tool_calls:
            break  # model chose to answer directly

        # Only the first tool call is used -- this is a sequential ReAct
        # loop (act, observe, re-decide), not parallel tool execution.
        call = resp.message.tool_calls[0]
        tool_name = call.function.name
        args = call.function.arguments  # already a dict, per ollama's Message.ToolCall.Function type
        query = str(args.get("query", "")).strip()
        reasoning = str(args.get("reasoning", "")).strip()

        dedupe_key = (tool_name, query.lower())
        if tool_name not in ("rag_search", "web_search") or not query or dedupe_key in seen_calls:
            break  # unknown tool, empty query, or a repeated call -- stop looping
        seen_calls.add(dedupe_key)
        result.iterations_used += 1

        elapsed_decision = int((time.monotonic() - step_start) * 1000)
        yield AgentStep(stage="tool_call", tool=tool_name, reasoning=reasoning, detail=query, elapsed_ms=elapsed_decision)

        obs_start = time.monotonic()
        if tool_name == "rag_search":
            try:
                hits, _transformed = search_with_transform(query)
            except FileNotFoundError:
                hits = []
            result.sources.extend(hits)
            obs_detail = f"{len(hits)} document chunk(s) found" if hits else "No relevant document chunks found"
            obs_text = "\n\n".join(
                f"[{h['source']} p.{h.get('page_number')}] {neutralise_injection(h['text'])}" for h in hits
            ) or "No relevant chunks were retrieved."
        else:  # web_search
            hits = _web_search(query, n=WEB_SEARCH_RESULT_COUNT)
            result.web_sources.extend(hits)
            obs_detail = f"{len(hits)} web result(s) found" if hits else "No web results found"
            obs_text = "\n\n".join(
                f"[{r['title']}] {neutralise_injection(r['snippet'])} ({r['url']})" for r in hits
            ) or "No web results were found."

        elapsed_obs = int((time.monotonic() - obs_start) * 1000)
        obs_step = AgentStep(stage="observation", tool=tool_name, detail=obs_detail, elapsed_ms=elapsed_obs)
        yield obs_step

        result.trace.append({"stage": "tool_call", "tool": tool_name, "reasoning": reasoning, "detail": query})
        result.trace.append({"stage": "observation", "tool": tool_name, "detail": obs_detail})

        # Fed back as plain text rather than reconstructing a native
        # assistant tool_calls message -- simpler and avoids depending on
        # the exact wire shape Ollama expects for a tool-call round-trip.
        decision_messages.append({
            "role": "assistant",
            "content": f"[Called {tool_name}(query={query!r}) — reasoning: {reasoning}]",
        })
        decision_messages.append({
            "role": "user",
            "content": f"Observation from {tool_name}:\n{obs_text}\n\nDo you need another tool call, or can you answer now?",
        })

    yield AgentStep(stage="answering")
    result.trace.append({"stage": "answering"})
    result.observations_text = _fold_observations(result.sources, result.web_sources)
    yield result
