"""
Step 4 — Draft an evaluation set using the local LLM, grounded in real chunks.

Why generate with Ollama instead of hand-writing 25-30 questions: writing
good ground-truth Q&A pairs by hand is slow and you (the project owner)
don't need to be the bottleneck for every single pair. qwen3:8b already
runs locally for the chat feature, so it's free to reuse here. The model
reads ONE chunk at a time and is asked to write a question that chunk
answers, plus an answer grounded only in that chunk's text -- this keeps
the "ground truth" tied to a specific, traceable source (PDF + page).

This is a DRAFT, not a finished eval set. The generated `ground_truth`
answers should be skimmed by a human before being trusted as a benchmark --
an LLM grading its own LLM-written answer (which RAGAS does, since it also
needs a judge LLM) is a weaker signal than a human-verified one. Treat this
script as removing the "blank page" problem, not as removing the review
step.

Sampling strategy: pulls a stratified sample across all 4 source PDFs
(proportional-ish, capped per source) so no single PDF dominates the eval
set, and skips chunks flagged `low_confidence` or chunks under ~200 chars
(too short to ask a meaningful question about).

Output: data/evaluation_set_v2.json
Each entry: {question, ground_truth, source, page_number, section,
             chunk_index, difficulty, type, needs_review: true}
"""

from __future__ import annotations

import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import EVAL_SET_PATH, OLLAMA_MODEL, PARSED_MD  # noqa: E402

PER_SOURCE_SAMPLE = 8  # ~8 * 4 sources = ~32 draft pairs
MIN_CHUNK_CHARS = 200
SEED = 42

GEN_PROMPT = """You are creating ONE evaluation question for a RAG system, based ONLY on the passage below.

Passage (from "{source}", page {page}):
\"\"\"
{text}
\"\"\"

Write a question that this passage directly answers, and the answer to that question using ONLY information in the passage. Also classify the question's difficulty (easy/medium/hard) and type (definition/example/calculation/comparison/process).

Respond with ONLY a JSON object, no other text, in this exact shape:
{{"question": "...", "answer": "...", "difficulty": "easy|medium|hard", "type": "definition|example|calculation|comparison|process"}}
"""


def load_chunks() -> list[dict]:
    chunks = []
    for f in sorted(PARSED_MD.glob("*.chunks.json")):
        chunks.extend(json.loads(f.read_text(encoding="utf-8")))
    return chunks


def stratified_sample(chunks: list[dict]) -> list[dict]:
    rng = random.Random(SEED)
    by_source: dict[str, list[dict]] = {}
    for c in chunks:
        meta = c["metadata"]
        if meta.get("low_confidence"):
            continue
        if len(c["text"]) < MIN_CHUNK_CHARS:
            continue
        by_source.setdefault(meta["source"], []).append(c)

    sample = []
    for source, items in by_source.items():
        rng.shuffle(items)
        sample.extend(items[:PER_SOURCE_SAMPLE])
    return sample


def extract_json(raw: str) -> dict | None:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def generate_pair(chunk: dict) -> dict | None:
    from ollama import chat

    meta = chunk["metadata"]
    prompt = GEN_PROMPT.format(
        source=meta["source"],
        page=meta.get("page_number", "?"),
        text=chunk["text"][:2000],
    )
    response = chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}], think=False)
    parsed = extract_json(response.message.content or "")
    if not parsed or "question" not in parsed or "answer" not in parsed:
        return None
    return {
        "question": parsed["question"],
        "ground_truth": parsed["answer"],
        "source": meta["source"],
        "page_number": meta.get("page_number"),
        "section": meta.get("section"),
        "chunk_index": meta.get("chunk_index"),
        "difficulty": parsed.get("difficulty", "medium"),
        "type": parsed.get("type", "definition"),
        "needs_review": True,
    }


def main() -> None:
    chunks = load_chunks()
    if not chunks:
        raise FileNotFoundError("No chunks found -- run 02_parse_and_chunk.py first")

    sample = stratified_sample(chunks)
    print(f"Sampled {len(sample)} chunks across {len({c['metadata']['source'] for c in sample})} sources")

    eval_set = []
    failed = 0
    for i, chunk in enumerate(sample, start=1):
        print(f"  [{i}/{len(sample)}] {chunk['metadata']['source']} p.{chunk['metadata'].get('page_number')} ...", end=" ")
        pair = generate_pair(chunk)
        if pair is None:
            print("SKIP (could not parse model output)")
            failed += 1
            continue
        print("ok")
        eval_set.append(pair)

    EVAL_SET_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVAL_SET_PATH.write_text(json.dumps(eval_set, indent=2), encoding="utf-8")

    print(f"\nWrote {len(eval_set)} draft Q&A pairs to {EVAL_SET_PATH} ({failed} failed to parse)")
    print("These are DRAFTS -- review ground_truth answers before treating this as a golden eval set.")


if __name__ == "__main__":
    main()
