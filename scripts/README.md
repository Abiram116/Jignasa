# scripts/ — vs. pipeline/, what's the difference?

This folder is easy to confuse with `pipeline/` since both touch evaluation
and PDFs. The distinction:

- **`pipeline/`** — offline, one-time (or rerun-when-PDFs-change) scripts
  that build the index: parse PDFs, chunk, embed, write `rag_index/`.
- **`scripts/`** (this folder) — utilities invoked by the running API
  (`api/evaluation.py` imports `evaluate_rag_metrics.py` directly), plus a
  standalone generator for the original retrieval-only eval set.

| File | What it does |
|---|---|
| `evaluate_rag_metrics.py` | Computes retrieval metrics (Hit@k, MRR, nDCG) against `data/evaluation_set.json`. Run via CLI, or via `POST /api/evaluation/run`/`/save` (still live for scripted/CLI use even though the homepage now reads `GET /api/evaluation/summary` instead of a live in-app runner — see `data/evaluations/README.md`). |
| `generate_evaluation_set.py` | One-off generator that produced `data/evaluation_set.json` (asks Ollama to write questions per-PDF, no ground-truth answers — checks "did we retrieve the right PDF", not answer quality). Re-run only if you want to regenerate that specific eval set from scratch. |
| `evaluate_ragas.py` | Runs the full pipeline (retrieve + generate) for every question in `data/evaluation_set_v2.json` and scores the actual answers with RAGAS: `faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`. This is the **generation-quality** check the other two scripts don't do. Uses the project's own local `qwen3:8b` as the judge LLM (see the script's docstring for why that makes absolute scores directional, not a universal benchmark). Slow — roughly 1-2 minutes per question since each metric is itself one or more LLM calls. |

Run `evaluate_ragas.py` with `--limit N` to sanity-check on a few questions
before committing to a full run. Results land in `data/evaluations/` as a
per-question CSV plus a `*_summary.json` — see `data/evaluations/README.md`
for how to read them.
