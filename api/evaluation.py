from __future__ import annotations

import json
import time
from collections.abc import Iterator
from datetime import datetime, timezone
from statistics import mean

from langchain_huggingface import HuggingFaceEmbeddings
from scripts.evaluate_rag_metrics import (
    EMBEDDING_MODEL,
    EVALUATION_SET_PATH,
    MetricsSummary,
    compute_row,
    load_index,
    save_snapshot,
    search,
)

from api.config import SAVED_METRICS_PATH

EVAL_TYPE = "retrieval_only"
EVAL_DESCRIPTION = (
    "Retrieval evaluation only: embed each question, search FAISS top-k, "
    "check if the expected PDF appears in results. Does NOT call Qwen/LLM."
)


def load_saved_metrics() -> list[dict]:
    if not SAVED_METRICS_PATH.exists():
        return []
    return json.loads(SAVED_METRICS_PATH.read_text(encoding="utf-8"))


def _evaluate_rows(k: int) -> Iterator[tuple[int, int, str, dict, float, list[dict]]]:
    """Yield (current, total, question, row, elapsed, all_rows_so_far) per question."""
    start = time.perf_counter()
    index, metadata = load_index()
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )
    items = json.loads(EVALUATION_SET_PATH.read_text(encoding="utf-8"))
    total = len(items)
    rows: list[dict] = []

    for i, item in enumerate(items, start=1):
        question = str(item["question"]).strip()
        expected = str(item["expected_document"]).strip()
        hits = search(question, k=k, index=index, metadata=metadata, embeddings=embeddings)
        metrics = compute_row(hits, expected, k)
        row = {
            "question": question,
            "expected_document": expected,
            "difficulty": item.get("difficulty", ""),
            "type": item.get("type", item.get("question_type", "")),
            **metrics,
        }
        rows.append(row)
        yield i, total, question, row, time.perf_counter() - start, rows


def iter_evaluation(*, k: int) -> tuple[MetricsSummary, list[dict], float]:
    rows: list[dict] = []
    elapsed = 0.0
    for _, _, _, row, elapsed, rows in _evaluate_rows(k):
        pass
    evaluated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    summary = MetricsSummary(
        question_count=len(rows),
        k=k,
        hit_at_k=mean(r["hit_at_k"] for r in rows) if rows else 0.0,
        recall_at_k=mean(r["recall_at_k"] for r in rows) if rows else 0.0,
        precision_at_k=mean(r["precision_at_k"] for r in rows) if rows else 0.0,
        mrr_at_k=mean(r["reciprocal_rank"] for r in rows) if rows else 0.0,
        ndcg_at_k=mean(r["ndcg_at_k"] for r in rows) if rows else 0.0,
        evaluated_at=evaluated_at,
    )
    return summary, rows, elapsed


def stream_evaluation(*, k: int) -> Iterator[dict]:
    """Yield progress dicts, then a final complete dict."""
    yield {
        "type": "start",
        "eval_type": EVAL_TYPE,
        "uses_llm": False,
        "message": EVAL_DESCRIPTION,
    }
    rows: list[dict] = []
    elapsed = 0.0
    for current, total, question, row, elapsed, rows in _evaluate_rows(k):
        yield {
            "type": "progress",
            "current": current,
            "total": total,
            "question": question[:100],
            "hit": row["hit_at_k"] == 1,
            "expected_document": row["expected_document"],
            "top_source": (row.get("top_k_sources") or "").split(" | ")[0] or None,
            "elapsed_seconds": round(elapsed, 2),
        }
    summary = MetricsSummary(
        question_count=len(rows),
        k=k,
        hit_at_k=mean(r["hit_at_k"] for r in rows) if rows else 0.0,
        recall_at_k=mean(r["recall_at_k"] for r in rows) if rows else 0.0,
        precision_at_k=mean(r["precision_at_k"] for r in rows) if rows else 0.0,
        mrr_at_k=mean(r["reciprocal_rank"] for r in rows) if rows else 0.0,
        ndcg_at_k=mean(r["ndcg_at_k"] for r in rows) if rows else 0.0,
        evaluated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    yield {
        "type": "complete",
        "summary": summary_to_dict(summary, elapsed),
        "rows": rows,
    }


def summary_to_dict(summary: MetricsSummary, elapsed: float) -> dict:
    return {
        **summary.as_dict(),
        "eval_type": EVAL_TYPE,
        "eval_description": EVAL_DESCRIPTION,
        "elapsed_seconds": round(elapsed, 2),
        "uses_llm": False,
    }


def save_named_snapshot(name: str, summary: MetricsSummary, rows: list[dict], elapsed: float) -> dict:
    entry = save_snapshot(name, summary, rows)
    entry["eval_type"] = EVAL_TYPE
    entry["elapsed_seconds"] = round(elapsed, 2)
    entry["uses_llm"] = False
    manifest = load_saved_metrics()
    for i, row in enumerate(manifest):
        if row["name"] == entry["name"]:
            manifest[i] = {**row, **entry}
            break
    SAVED_METRICS_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return entry
