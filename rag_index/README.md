# rag_index/ — 100% generated, never hand-edit

Everything in this folder (except this file and `.gitkeep`) is build
output from `pipeline/`. It's gitignored — if it's missing, that's
expected on a fresh clone, not a bug.

| File/folder | Produced by | Contents |
|---|---|---|
| `corpus_profile.json` | `pipeline/01_profile_corpus.py` | Per-PDF stats (pages, text density, OCR/encoding flags) — informational only, not used at runtime |
| `parsed_markdown/*.md` | `pipeline/02_parse_and_chunk.py` | Docling's markdown export per PDF — useful for skimming what got extracted, not consumed by the API |
| `parsed_markdown/*.chunks.json` | `pipeline/02_parse_and_chunk.py` | Per-PDF chunked text + metadata, before embedding |
| `faiss.index` | `pipeline/03_build_index.py` | The actual vector index the API searches at runtime |
| `metadata.json` | `pipeline/03_build_index.py` | One entry per vector (same order as the index): source, page, section, text |

To rebuild from scratch: delete this folder's contents (keep `.gitkeep`)
and rerun the `pipeline/` scripts in order — see `pipeline/README.md`.
