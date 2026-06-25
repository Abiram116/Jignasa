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
| `evaluate_rag_metrics.py` | Computes retrieval metrics (Hit@k, MRR, nDCG) against `data/evaluation_set.json`. Called live from the API's Evaluation tab in the UI. |
| `generate_evaluation_set.py` | One-off generator that produced `data/evaluation_set.json` (asks Ollama to write questions per-PDF, no ground-truth answers — checks "did we retrieve the right PDF", not answer quality). Re-run only if you want to regenerate that specific eval set from scratch. |

If you're looking for the **newer** eval set with ground-truth answers (for
RAGAS-style generation-quality checks), that's `pipeline/04_generate_eval_set.py`
producing `data/evaluation_set_v2.json` — see `data/README.md`.
