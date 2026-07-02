"""
Evaluate tool-selection accuracy for api/agent.py's run_agent_loop.

Deterministic and fast: compares which tools actually got called against an
expected set, for a small hand-picked set of representative queries. This
does NOT check answer quality (see evaluate_ragas.py for that) -- purely
"did the decision step pick the right tool(s), or correctly pick none, for
this kind of question."

Exists because the agent loop's decision prompt was hand-edited twice in one
session based on single anecdotal failures, and the second edit made tool
selection worse, not better (see docs/PENDING_WORK.md's "Status update").
This gives any future prompt change something concrete to check before
shipping it, instead of re-litigating from one example each time.

Run: python3 scripts/eval_tool_selection.py [-v]
Requires: Ollama running locally with the configured model, network access
for web_search cases. rag_search cases don't require the index to be
built -- a missing/empty index just means 0 hits, not a crash -- but their
tool-SELECTION check (did it call rag_search at all) is independent of hit
count either way.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.agent import AgentResult, run_agent_loop  # noqa: E402

EVAL_SET: list[dict] = [
    {"query": "hi", "expect": set()},
    {"query": "thanks, that's helpful!", "expect": set()},
    {"query": "what's 2+2 times 3", "expect": set()},
    {"query": "what do you think about pineapple on pizza", "expect": set()},
    {"query": "What does the attention mechanism in transformers do?", "expect": {"rag_search"}},
    {"query": "Explain how KV cache works and why it matters for inference", "expect": {"rag_search"}},
    {"query": "What's the latest stable version of Rust, and when was it released?", "expect": {"web_search"}},
    {"query": "What happened in AI news today?", "expect": {"web_search"}},
    {"query": "What's the weather in Bangalore right now?", "expect": {"web_search"}},
    {
        "query": "Compare what the knowledge base says about transformers with what's new in transformer research this year",
        "expect": {"rag_search", "web_search"},
    },
    {"query": "What does the document say about quantum computing?", "expect": {"rag_search"}},
    {"query": "Who won the most recent cricket World Cup?", "expect": {"web_search"}},
]


def run_case(query: str) -> tuple[set[str], list[dict]]:
    """Runs one query through the decision loop. Returns (tools called, full trace)."""
    for item in run_agent_loop(query, [], "", allow_rag=True, allow_web=True):
        if isinstance(item, AgentResult):
            called = {t["tool"] for t in item.trace if t.get("stage") == "tool_call"}
            return called, item.trace
    return set(), []  # pragma: no cover -- run_agent_loop always yields a final AgentResult


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate agent-loop tool-selection accuracy.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print every case's trace, not just failures")
    args = parser.parse_args()

    passed = 0
    for case in EVAL_SET:
        start = time.monotonic()
        actual, trace = run_case(case["query"])
        elapsed = time.monotonic() - start
        expected = case["expect"]
        ok = actual == expected
        passed += ok

        print(f"{'PASS' if ok else 'FAIL'}  ({elapsed:4.1f}s)  {case['query']!r}")
        print(f"      expected={sorted(expected) or 'none'}  actual={sorted(actual) or 'none'}")
        if args.verbose or not ok:
            for step in trace:
                if step.get("stage") == "tool_call":
                    print(f"      -> {step['tool']}({step.get('detail')!r}) because: {step.get('reasoning')}")

    print(f"\n{passed}/{len(EVAL_SET)} passed")
    sys.exit(0 if passed == len(EVAL_SET) else 1)


if __name__ == "__main__":
    main()
