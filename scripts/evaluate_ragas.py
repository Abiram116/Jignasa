"""
RAGAS-based generation-quality evaluation.

Why this is separate from evaluate_rag_metrics.py: that script only checks
retrieval (did we pull the right PDF). This script runs the FULL pipeline
end-to-end -- transform, retrieve, build prompt, generate with Ollama --
for every question in data/evaluation_set_v2.json, then scores the actual
generated answer against the question's context and ground truth using
RAGAS metrics:

  - faithfulness:       is the answer actually supported by the retrieved
                         context, or did the model make things up?
  - answer_relevancy:   does the answer address the question asked?
  - context_precision:  of the retrieved chunks, how many were relevant?
  - context_recall:     did retrieval surface what was needed to answer
                         (compared against the ground_truth)?

RAGAS needs a "judge" LLM and an embedding model to compute these scores.
Since this project is local-only (Ollama + HuggingFace), this script wires
RAGAS to use the SAME qwen3:8b model via langchain-ollama as the judge --
no API key, no cloud calls, consistent with the rest of the stack. This is
a real constraint worth knowing: a smaller local judge model is less
reliable than e.g. GPT-4 as a judge, so treat absolute scores as directional
within this project, not as a universal/comparable RAGAS benchmark.

This is also the ONE place LangChain appears anywhere in this project.
It's not a design choice -- RAGAS's own `evaluate()` API expects an
`llm=`/`embeddings=` object wrapped in its `LangchainLLMWrapper`/
`LangchainEmbeddingsWrapper` classes, and that's the only supported way to
hand it a local Ollama model today. The actual RAG pipeline (`api/rag.py`,
`pipeline/`) and the agent loop (`api/agent.py`) call `sentence-transformers`
and Ollama directly, with no LangChain involved.

Why per-question checkpointing: each question costs 1 generation call plus
~4-8 judge calls on an 8b local model -- multiple minutes per question, not
seconds. Without checkpointing, killing the process (Ctrl+C, needing the
GPU for something else, a crash) loses all progress since nothing hits disk
until the very end. Here, every question's result is appended to a
`.{name}_checkpoint.jsonl` file as soon as it's scored, and a rerun skips
any question already in that file -- so stop/resume is just "run it again."

Usage:
    python3 scripts/evaluate_ragas.py [--limit N] [--save-as NAME]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.config import EMBEDDING_MODEL, OLLAMA_MODEL  # noqa: E402

PROJECT_DIR = Path(__file__).resolve().parent.parent
EVAL_SET_V2_PATH = PROJECT_DIR / "data" / "evaluation_set_v2.json"
EVALUATIONS_DIR = PROJECT_DIR / "data" / "evaluations"


def question_id(question: str) -> str:
    return hashlib.sha1(question.encode("utf-8")).hexdigest()[:12]


def load_checkpoint(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        rows[row["id"]] = row
    return rows


def append_checkpoint(path: Path, row: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def generate_answer(item: dict, judge):
    """Run the real pipeline (retrieve + generate) for one question."""
    from api.rag import build_prompt, search_with_transform
    from ollama import chat

    hits, _ = search_with_transform(item["question"], k=5)
    prompt = build_prompt(item["question"], hits)
    response = chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}], think=False)
    return {
        "user_input": item["question"],
        "response": response.message.content or "",
        "retrieved_contexts": [h["text"] for h in hits],
        "reference": item["ground_truth"],
        "source": item["source"],
        "page_number": item.get("page_number"),
    }


def score_one(row: dict, judge_llm, judge_embeddings) -> dict:
    """RAGAS-score a single question. Returns the 4 metric scores."""
    from ragas import EvaluationDataset, evaluate
    from ragas.metrics import ContextPrecision, ContextRecall, Faithfulness, ResponseRelevancy
    from ragas.run_config import RunConfig

    dataset = EvaluationDataset.from_list(
        [{k: v for k, v in row.items() if k not in ("source", "page_number")}]
    )
    result = evaluate(
        dataset=dataset,
        metrics=[Faithfulness(), ResponseRelevancy(), ContextPrecision(), ContextRecall()],
        llm=judge_llm,
        embeddings=judge_embeddings,
        raise_exceptions=False,
        run_config=RunConfig(timeout=600, max_workers=2),
    )
    df = result.to_pandas()
    return {
        "faithfulness": float(df["faithfulness"].iloc[0]),
        "answer_relevancy": float(df["answer_relevancy"].iloc[0]),
        "context_precision": float(df["context_precision"].iloc[0]),
        "context_recall": float(df["context_recall"].iloc[0]),
    }


def make_judges():
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_ollama import ChatOllama
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper

    # A local 8b model answering multi-step judge prompts (faithfulness and
    # context_precision both involve several sub-calls per question) is much
    # slower than a hosted judge model -- give it a long per-call timeout.
    judge_llm = LangchainLLMWrapper(
        ChatOllama(model=OLLAMA_MODEL, temperature=0.0, request_timeout=600.0)
    )
    judge_embeddings = LangchainEmbeddingsWrapper(
        HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL, encode_kwargs={"normalize_embeddings": True})
    )
    return judge_llm, judge_embeddings


def write_outputs(rows_by_id: dict[str, dict], items: list[dict], save_as: str) -> None:
    ordered = [rows_by_id[question_id(item["question"])] for item in items if question_id(item["question"]) in rows_by_id]

    csv_path = EVALUATIONS_DIR / f"{save_as}.csv"
    fieldnames = [
        "question", "source", "page_number",
        "faithfulness", "answer_relevancy", "context_precision", "context_recall",
        "answer",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in ordered:
            writer.writerow({
                "question": row["user_input"],
                "source": row["source"],
                "page_number": row["page_number"],
                "faithfulness": row["faithfulness"],
                "answer_relevancy": row["answer_relevancy"],
                "context_precision": row["context_precision"],
                "context_recall": row["context_recall"],
                "answer": row["response"],
            })

    def avg(key: str) -> float:
        import math
        vals = [r[key] for r in ordered if r[key] is not None and not math.isnan(r[key])]
        return round(sum(vals) / len(vals), 4) if vals else float("nan")

    summary = {
        "question_count": len(ordered),
        "expected_count": len(items),
        "faithfulness": avg("faithfulness"),
        "answer_relevancy": avg("answer_relevancy"),
        "context_precision": avg("context_precision"),
        "context_recall": avg("context_recall"),
        "judge_llm": OLLAMA_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    summary_path = EVALUATIONS_DIR / f"{save_as}_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n" + "=" * 50)
    print(json.dumps(summary, indent=2))
    print(f"\nPer-question scores: {csv_path}")
    print(f"Summary: {summary_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="RAGAS generation-quality evaluation.")
    parser.add_argument("--limit", type=int, default=None, help="Only evaluate first N questions")
    parser.add_argument("--save-as", type=str, default="ragas_v1", help="Output name (no extension)")
    args = parser.parse_args()

    EVALUATIONS_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint_path = EVALUATIONS_DIR / f".{args.save_as}_checkpoint.jsonl"

    items = json.loads(EVAL_SET_V2_PATH.read_text(encoding="utf-8"))
    if args.limit:
        items = items[: args.limit]

    done = load_checkpoint(checkpoint_path)
    if done:
        print(f"Resuming: {len(done)}/{len(items)} questions already scored in {checkpoint_path.name}")

    judge_llm, judge_embeddings = make_judges()

    for i, item in enumerate(items, start=1):
        qid = question_id(item["question"])
        if qid in done:
            print(f"  [{i}/{len(items)}] (cached) {item['question'][:60]}...")
            continue

        print(f"  [{i}/{len(items)}] {item['question'][:60]}...", flush=True)
        row = generate_answer(item, judge_llm)
        scores = score_one(row, judge_llm, judge_embeddings)
        row.update(scores)
        row["id"] = qid
        append_checkpoint(checkpoint_path, row)
        done[qid] = row

    write_outputs(done, items, args.save_as)


if __name__ == "__main__":
    main()
