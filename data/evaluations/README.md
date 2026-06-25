# Evaluation results

Two different evaluations, two different things measured — see
`data/README.md` for why they're not interchangeable.

## 1. Retrieval-only benchmark (`v2_post_rebuild`)

**Question:** for a question with a known source PDF, does FAISS retrieval
surface a chunk from that PDF in the top 5? No LLM involved.

| Metric | Score | What it means |
|---|---|---|
| Hit@5 | **100%** | The correct PDF appeared in the top 5 for every one of the 80 questions |
| MRR@5 | **0.981** | When correct, it was almost always ranked #1 |
| nDCG@5 | **0.986** | Same story, rank-weighted |
| Recall@5 | 1.00 | (Equivalent to Hit@5 here — only one expected document per question) |
| Precision@5 | 0.20 | Expected: only 1 of the 5 retrieved chunks *should* match a single-document question |

Run via: `python3 scripts/evaluate_rag_metrics.py --save-as <name>`
Raw per-question results: `data/evaluations/v2_post_rebuild.csv`

**Caveat:** this only checks "right file," not "right passage" or "right
answer." A 100% score here doesn't mean the chunks retrieved are the *best*
chunks — see the RAGAS results below for that.

## 2. Generation-quality benchmark — RAGAS (`ragas_v1`)

**Question:** for 32 questions each grounded in one specific chunk, does the
full pipeline (retrieve → prompt → generate) produce a faithful, relevant,
well-supported answer?

| Metric | Score | What it means |
|---|---|---|
| Faithfulness | **0.786** | Of the claims in generated answers, ~79% are directly supported by the retrieved context (the rest are unsupported additions/hallucination risk) |
| Answer Relevancy | **0.887** | Generated answers are strongly on-topic for the question asked |
| Context Precision | **0.847** | Most retrieved chunks were actually useful for answering |
| Context Recall | **0.844** | Retrieval usually surfaced what was needed to answer the ground-truth |

Run via: `python3 scripts/evaluate_ragas.py --save-as ragas_v1`
Raw per-question results: `data/evaluations/ragas_v1.csv`
Summary JSON: `data/evaluations/ragas_v1_summary.json`

### Reading this honestly

- **Judge model is local (`qwen3:8b`), not GPT-4.** RAGAS needs an LLM to
  score things like faithfulness. A smaller local judge is less reliable
  than a frontier model judge — treat these numbers as *directional for
  this project*, not as a number you can compare against someone else's
  RAGAS score on a different judge model.
- **8 of 128 metric cells came back `NaN`** (timeouts or malformed JSON
  from the local model under load — visible as `Exception raised in Job[N]`
  during the run). Excluded from the averages above (pandas means skip
  NaN), not counted as zero.
- **Lowest-scoring question** (faithfulness=0, all metrics=0): *"What
  example did Microsoft researchers use to compare GPT-3 vs GPT-4
  generations?"* — the pipeline correctly replied "I don't have enough
  information" rather than hallucinating, because retrieval didn't surface
  the right chunk for that specific phrasing, even though the answer exists
  in the corpus. This is a real, useful finding: it's a retrieval miss on a
  paraphrase-sensitive question, not a generation failure. Worth revisiting
  if/when query transformation (HyDE/rewriting) gets tuned further.

## Reproducing both

```bash
python3 scripts/evaluate_rag_metrics.py --save-as <name>      # retrieval only, ~1 min
python3 scripts/evaluate_ragas.py --save-as <name>            # full pipeline, ~1-2 min/question
```

`evaluate_ragas.py` checkpoints per question (`.{name}_checkpoint.jsonl`) —
safe to stop and rerun the same command to resume instead of starting over.
