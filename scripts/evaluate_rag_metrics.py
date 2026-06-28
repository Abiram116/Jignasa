"""Evaluate retrieval against data/evaluation_set.json using rag_index/."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

import faiss
import numpy as np
from langchain_huggingface import HuggingFaceEmbeddings

PROJECT_DIR = Path(__file__).resolve().parent.parent
RAG_INDEX_DIR = PROJECT_DIR / "rag_index"
INDEX_PATH = RAG_INDEX_DIR / "faiss.index"
METADATA_PATH = RAG_INDEX_DIR / "metadata.json"
EVALUATION_SET_PATH = PROJECT_DIR / "data" / "evaluation_set.json"
EVALUATIONS_DIR = PROJECT_DIR / "data" / "evaluations"
SAVED_METRICS_PATH = EVALUATIONS_DIR / "saved_metrics.json"

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
DEFAULT_K = 5


@dataclass
class MetricsSummary:
    question_count: int
    k: int
    hit_at_k: float
    recall_at_k: float
    precision_at_k: float
    mrr_at_k: float
    ndcg_at_k: float
    evaluated_at: str

    def as_dict(self, *, elapsed_seconds: float | None = None) -> dict:
        out = {
            "question_count": self.question_count,
            "k": self.k,
            "hit_at_k": self.hit_at_k,
            "recall_at_k": self.recall_at_k,
            "precision_at_k": self.precision_at_k,
            "mrr_at_k": self.mrr_at_k,
            "ndcg_at_k": self.ndcg_at_k,
            "evaluated_at": self.evaluated_at,
            "eval_type": "retrieval_only",
            "uses_llm": False,
            "eval_description": (
                "Retrieval only: embed question + FAISS search + check expected PDF. No LLM."
            ),
        }
        if elapsed_seconds is not None:
            out["elapsed_seconds"] = round(elapsed_seconds, 2)
        return out


def load_index() -> tuple[faiss.Index, dict[str, dict]]:
    if not INDEX_PATH.exists() or not METADATA_PATH.exists():
        raise FileNotFoundError(
            f"Missing index in {RAG_INDEX_DIR}. Run pipeline/02_parse_and_chunk.py "
            "and pipeline/03_build_index.py first."
        )
    index = faiss.read_index(str(INDEX_PATH))
    with METADATA_PATH.open("r", encoding="utf-8") as f:
        metadata = json.load(f)
    return index, metadata["vectors"]


def search(
    query: str,
    *,
    k: int,
    index: faiss.Index,
    metadata: dict[str, dict],
    embeddings: HuggingFaceEmbeddings,
) -> list[dict]:
    query_vector = np.asarray([embeddings.embed_query(query)], dtype=np.float32)
    faiss.normalize_L2(query_vector)
    scores, ids = index.search(query_vector, k)
    hits: list[dict] = []
    for rank, (score, vec_id) in enumerate(zip(scores[0], ids[0], strict=True), start=1):
        if vec_id == -1:
            continue
        item = metadata.get(str(vec_id))
        if item is None:
            continue
        hits.append(
            {
                "rank": rank,
                "score": float(score),
                "source": item.get("source"),
                "page_number": item.get("page_number"),
                "text": item.get("text", ""),
            }
        )
    return hits


def compute_row(hits: list[dict], expected_document: str, k: int) -> dict:
    rank = None
    reciprocal_rank = 0.0
    ndcg = 0.0
    for hit in hits[:k]:
        source = Path(hit.get("source") or "").name
        if source == expected_document:
            rank = hit["rank"]
            reciprocal_rank = 1.0 / rank
            ndcg = 1.0 / np.log2(rank + 1)
            break
    hit_at_k = 1 if rank is not None else 0
    return {
        "expected_document_rank": rank,
        "hit_at_k": hit_at_k,
        "recall_at_k": float(hit_at_k),
        "precision_at_k": hit_at_k / k if k else 0.0,
        "reciprocal_rank": reciprocal_rank,
        "ndcg_at_k": ndcg,
        "top_k_sources": " | ".join(str(h.get("source")) for h in hits),
    }


def run_evaluation(*, k: int = DEFAULT_K) -> tuple[MetricsSummary, list[dict]]:
    index, metadata = load_index()
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )

    with EVALUATION_SET_PATH.open("r", encoding="utf-8") as f:
        items = json.load(f)

    rows: list[dict] = []
    for item in items:
        question = str(item["question"]).strip()
        expected = str(item["expected_document"]).strip()
        hits = search(question, k=k, index=index, metadata=metadata, embeddings=embeddings)
        metrics = compute_row(hits, expected, k)
        rows.append(
            {
                "question": question,
                "expected_document": expected,
                "difficulty": item.get("difficulty", ""),
                "type": item.get("type", item.get("question_type", "")),
                **metrics,
            }
        )

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
    return summary, rows


def save_snapshot(name: str, summary: MetricsSummary, rows: list[dict]) -> dict:
    import re

    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip().lower()).strip("_")
    if not slug:
        raise ValueError("Name cannot be empty")

    EVALUATIONS_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    if SAVED_METRICS_PATH.exists():
        manifest = json.loads(SAVED_METRICS_PATH.read_text(encoding="utf-8"))
    if any(entry["name"] == slug for entry in manifest):
        raise ValueError(f"`{slug}` already exists — pick another name.")

    csv_path = EVALUATIONS_DIR / f"{slug}.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "question",
                "expected_document",
                "difficulty",
                "type",
                "expected_document_rank",
                "hit_at_k",
                "recall_at_k",
                "precision_at_k",
                "reciprocal_rank",
                "ndcg_at_k",
                "top_k_sources",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    entry = {
        "name": slug,
        "label": name.strip(),
        "saved_at": summary.evaluated_at,
        **summary.as_dict(),
        "csv_path": str(csv_path),
    }
    manifest.append(entry)
    SAVED_METRICS_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate RAG retrieval metrics.")
    parser.add_argument("--k", type=int, default=DEFAULT_K)
    parser.add_argument("--json", action="store_true", help="Print summary JSON to stdout")
    parser.add_argument("--save-as", type=str, default="", help="Save results under this name")
    args = parser.parse_args()

    summary, rows = run_evaluation(k=args.k)
    if args.save_as:
        save_snapshot(args.save_as, summary, rows)

    if args.json:
        print(json.dumps(summary.as_dict()))
    else:
        print(summary.as_dict())
        if args.save_as:
            print(f"Saved snapshot: {args.save_as}")


if __name__ == "__main__":
    main()
