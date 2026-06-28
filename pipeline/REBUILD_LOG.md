# IndexIDMap migration — 2026-06-28

## What was wrong with the old index

The index was a plain `faiss.IndexFlatIP` with `metadata.json` as a flat
list, positionally aligned to the index's internal vector order. That
positional coupling is the whole problem: FAISS has no built-in concept
of "this vector belongs to this document," only "the vector at position
47." Deleting one document's chunks meant there was no way to remove just
those vectors — the only available operation was to re-embed every
remaining document from scratch and rebuild the index, which the in-app
delete feature did. That's correct but doesn't scale: deleting 1 document
out of 30 re-embedded and rebuilt for all 29 survivors, every time,
regardless of how small the deleted document was.

## What changed

Wrapped the index in a `faiss.IndexIDMap` (`pipeline/03_build_index.py`,
`pipeline/_add_to_index.py`) so every vector carries a stable 64-bit
integer ID, assigned once and never reused (`metadata.json`'s `next_id`
counter). `metadata.json` changed shape from a list to
`{"next_id": int, "vectors": {"<id>": {...}}}`, keyed by that same ID.

This makes deletion surgical: `api/upload.py`'s `delete_knowledge_base_file()`
looks up which vector IDs belong to the deleted file (`metadata["vectors"]`
filtered by `source == filename`) and calls `index.remove_ids([...])`
directly — no re-embedding, no rebuild, cost independent of how many
other documents exist. Measured on the real index (2206 chunks, 5
documents): a delete that previously would have re-embedded and rebuilt
from all remaining chunks now completes in **33ms**.

**Migrating the existing index needed no re-embedding.** `IndexFlatIP`
stores the raw vectors it was given, so `index.reconstruct_n()` hands them
back exactly as originally computed. `pipeline/_migrate_to_id_map.py` used
this to convert the existing 2206-vector index/metadata in place — assign
IDs 0..2205 (matching the old list's order), wrap in an `IndexIDMap`,
write out the new metadata shape. The old files were backed up
(`faiss.index.pre-idmap.bak`, `metadata.json.pre-idmap.bak`) before being
replaced.

**Verified lossless, not just functional**: ran the same query against
the pre-migration backup and the post-migration index side by side —
identical scores and sources, to the float. Also verified a real upload
(incremental add, ID continues from `next_id`) and a real delete (vectors
gone from the index, metadata, and disk; everything else untouched;
`next_id` left at its post-upload value rather than reused) against the
live, real knowledge base — not just a synthetic test.

## Why this, not a dedicated vector DB

`pipeline/README.md`'s existing "why `IndexFlatIP`, not HNSW/IVF or a
dedicated vector DB" reasoning still holds at this scale (a few thousand
chunks). `IndexIDMap` is the natural middle step: it's still FAISS, still
embedded in the same process, but it closes the one real capability gap
(ID-addressable vectors) that the flat index didn't have. A dedicated
vector DB (Qdrant, Milvus, pgvector) would add multi-user filtering and
true horizontal scale — relevant if this ever needs per-user knowledge
bases or 100K+ vectors, not relevant yet.

---

# Index rebuild — 2026-06-25

## What was wrong with the old index

`rag_index/metadata.json` (pre-rebuild) had 2040 chunks. Of those, 1924
(94%) had `page_number: null` and `section: null` and a `chunk_type` of
`markdown_resume` — meaning they came from a naive character-length text
splitter, not Docling's structural parser. Only `Python.pdf` (116 chunks)
went through the intended `docling_hybrid` path with real page/section
metadata. This happened silently: the old notebook (`rag_with_langchain.ipynb`)
fell back to the cheap splitter whenever Docling crashed on a PDF, with no
error surfaced anywhere.

## What changed

Rebuilt via the new `pipeline/` scripts (see `pipeline/README.md` for why
each design choice was made). Each PDF parsed in its own subprocess so a
crash on one can't degrade another — no fallback path exists anymore; a
failed PDF is reported as failed.

**Result: all 4 PDFs now have real page numbers and section headings.**

| Source | Chunks (old) | Chunks (new) | Metadata (new) |
|---|---|---|---|
| AI Engineering.pdf | ~1305 (fallback) | 1264 | full page + section |
| Data Science.pdf | ~454 (fallback) | 612 | full page + section, 2 chunks flagged `low_confidence` |
| ML.pdf | ~165 (fallback) | 173 | full page + section |
| Python.pdf | 116 (docling_hybrid) | 116 | full page + section |
| **Total** | 2040 | **2165** | |

The 2 `low_confidence` chunks in Data Science.pdf are page ~266, where the
source PDF uses a font with no proper character map (math/matrix notation
renders as garbled Unicode on extraction — confirmed during
`01_profile_corpus.py`, not a parsing bug). They're kept in the index but
flagged, not deleted, so they can be filtered or manually fixed later.

## Files removed as part of cleanup

- `rag_index/chunks.json` — old single combined chunks file from the
  notebook pipeline, superseded by `rag_index/parsed_markdown/*.chunks.json`
  (one file per PDF, with metadata already attached).

## Files kept as-is (not part of this rebuild)

- `data/evaluation_set.json` — the original 80-question retrieval-only eval
  set (checks "did we retrieve from the right PDF"). Still valid for that
  purpose; unaffected by the chunking change since it doesn't reference
  specific chunks.
- `rag_with_langchain.ipynb` — kept for historical reference. **Do not use
  it to rebuild the index** — use `pipeline/02_parse_and_chunk.py` instead.

## Next

`data/evaluation_set_v2.json` (RAGAS-oriented, with ground-truth answers
grounded in specific chunks) is generated by `pipeline/04_generate_eval_set.py`
— see that script's docstring for why it's a draft requiring human review,
not a finished benchmark.
