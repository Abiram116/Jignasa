# RAG pipeline — what this is and why it looks the way it does

This folder rebuilds the knowledge base index from the 4 PDFs in
`knowledge-base/`. It replaces the original `rag_with_langchain.ipynb`
notebook, which is kept around for historical reference but should not be
used to rebuild the index anymore.

## Why scripts instead of a notebook

The notebook ran all 4 PDFs through Docling in a single long-lived Jupyter
kernel. Docling's layout/OCR model doesn't fully release memory between
documents, so by the 2nd or 3rd large PDF the process would crash (OOM-kill
or segfault on WSL). The notebook "recovered" from this by silently falling
back to a cheap markdown-text-splitter for the PDFs that failed — which is
why, before this rebuild, 3 of the 4 PDFs in the index had no page numbers
and no section headings, while only the smallest PDF got real structured
chunking. Nobody saw an error; the index just quietly contained two
different quality tiers of data.

Each script here does one stage and can be re-run independently. Stage 2
(parsing) runs every PDF in its own **subprocess** (`_parse_one_pdf.py`),
so a crash on one PDF can't leak memory into the next, and a PDF that fails
is reported as **failed**, never silently downgraded.

## Stages

| Script | What it does | Output |
|---|---|---|
| `01_profile_corpus.py` | Reads each PDF's page count, text density, and flags pages that look image-heavy or have suspicious font encodings, *before* spending 20+ minutes parsing. | `rag_index/corpus_profile.json` |
| `_parse_one_pdf.py` | Worker (not run directly): parses ONE pdf with Docling's `HybridChunker`, which preserves page numbers and section headings. Flags any chunk that's mostly non-Latin/garbled characters (a sign of a PDF font with no proper character map) as `low_confidence` instead of silently keeping it. | `rag_index/parsed_markdown/<name>.chunks.json` |
| `02_parse_and_chunk.py` | Driver: runs the worker once per PDF (subprocess each), skips PDFs already done, retries failures, exits non-zero if any PDF truly fails. | same as above, for all PDFs |
| `03_build_index.py` | Embeds **all** chunks with BGE and builds a fresh `IndexIDMap`-wrapped FAISS index from scratch, assigning each vector a stable ID. Used for the initial build and full recovery. | `rag_index/faiss.index`, `rag_index/metadata.json` |
| `_add_to_index.py` | Worker (not run directly; used by the in-app upload feature): embeds **only** one PDF's chunks and adds them to the *existing* index via `index.add_with_ids()`, instead of rebuilding it. Atomic writes (temp file + rename). | updates the same two files above, in place |
| `_migrate_to_id_map.py` | One-time migration (run once, 2026-06-28): converts a pre-`IndexIDMap` flat index/list-metadata into the new ID-mapped format, by reconstructing existing vectors rather than re-embedding. See `REBUILD_LOG.md`. | rewrites the same two files, backs up the originals first |
| `04_generate_eval_set.py` | Uses the local Ollama model to **draft** question/answer pairs grounded in specific chunks, across all 4 sources. You review/edit the draft before treating it as a trusted eval set — see that script's docstring for why. | `data/evaluation_set_v2.json` |

## Why these specific technical choices

**Why Docling + HybridChunker, not a plain text splitter?**
A plain character/markdown splitter (like `RecursiveCharacterTextSplitter`)
cuts text by length only — it doesn't know where a heading, a table, or a
page boundary is. `HybridChunker` chunks by document structure first
(sections, headings) and only splits further by token budget within a
section, which is what lets every chunk carry an accurate page number and
section path. That metadata is what eventually lets retrieval *cite* a
specific page instead of just "somewhere in this PDF."

**Why BAAI/bge-base-en-v1.5 for embeddings?**
It's a strong open embedding model that runs fully locally (matches the
project's local-first design), and it's small enough (768-dim) to keep
FAISS fast and the index small.

**Why FAISS `IndexFlatIP` and not HNSW/IVF or a "real" vector DB?**
At ~2000-3000 chunks, exact brute-force cosine search (`IndexFlatIP` on
L2-normalized vectors) is sub-millisecond and has zero recall loss — it's
strictly *more* correct than an approximate index, not less production
grade. Approximate indexes (HNSW, IVF) only start paying off past roughly
100K+ vectors, where exact search gets slow. Swapping to a dedicated vector
DB (e.g. Qdrant) only becomes worth it if/when this needs multi-user
filtering (e.g. "only search docs this user uploaded") or true horizontal
scale — not at this corpus size.

**Why `IndexIDMap` on top of that (since 2026-06-28)?**
A plain `IndexFlatIP` only knows vectors by their position in the index —
there's no way to ask it to remove "this document's vectors" without
rebuilding from scratch. Wrapping it in an `IndexIDMap` gives every vector
a stable integer ID, so deletion becomes `index.remove_ids([...])`: cost
independent of how many other documents exist, instead of scaling with
the whole corpus. This is the standard middle step in production RAG
systems between "flat index, rebuild on every change" and a dedicated
vector DB — see `REBUILD_LOG.md` for the migration details and measured
before/after numbers.

**Why per-PDF subprocess isolation?**
See "Why scripts instead of a notebook" above — this is the actual fix for
the crash that caused silent data-quality loss last time.

## Running it

```bash
cd Jignasa   # repo root
python3 pipeline/01_profile_corpus.py
python3 pipeline/02_parse_and_chunk.py   # resumable; skips PDFs already chunked
python3 pipeline/03_build_index.py
python3 pipeline/04_generate_eval_set.py
```

Delete a PDF's `rag_index/parsed_markdown/<name>.chunks.json` to force
re-parsing just that PDF.

Each script checks for its required input up front (PDFs for `01`/`02`,
`.chunks.json` files for `03`) and exits cleanly with a message telling you
what to run first if it's missing — not a raw traceback. This matters most
on a fresh clone, where `knowledge-base/` is empty until you add PDFs.

## Uploading documents at runtime

PDFs can also be added through the running app itself (an upload control
in the chat sidebar) instead of copying files in and running these scripts
by hand. It reuses the existing parsing code, not a separate
implementation: the uploaded file is saved into `knowledge-base/`, parsed
via the same per-PDF worker (`_parse_one_pdf.py`) `02_parse_and_chunk.py`
already uses, then its chunks are added to the index incrementally via
`_add_to_index.py` (a second worker, alongside `_parse_one_pdf.py`).
Progress streams back to the UI the same way `/api/evaluation/run`
already does.

**Incremental, not a full reindex:** `_add_to_index.py` embeds *only* the
newly uploaded PDF's chunks, loads the existing `faiss.index`, assigns
each new chunk the next available vector ID (from `metadata.json`'s
`next_id` counter) and calls `index.add_with_ids()`, then appends the new
entries to `metadata.json` — it never re-embeds chunks that were already
indexed. This matters once a knowledge base has many documents:
re-embedding the whole corpus on every single upload (which is what an
earlier version of this feature did) would get slower, and use more
memory, the larger the knowledge base grows, for no benefit, since
nothing about the already-indexed documents changed. Both the index file
and metadata file are written atomically (build the new version in a
`.tmp` file, then rename over the original), so a crash mid-write can't
leave a corrupted index. Verified directly: after an incremental add, the
pre-existing metadata entries are byte-for-byte unchanged, and the new
document is immediately retrievable alongside the rest of the corpus.

`03_build_index.py` (the full rebuild) is still the right tool for the
*initial* multi-PDF build, and for full recovery (e.g. after deleting a
`.chunks.json` to force a PDF to be reparsed, or if the index/metadata
ever get out of sync) — `_add_to_index.py` is strictly additive and only
safe for chunks that aren't already in the index.

### Deleting documents at runtime

The same sidebar view lists every indexed document with a delete button.
Deleting is also surgical, not a rebuild (see `REBUILD_LOG.md`,
2026-06-28, for the full story on why this changed and the before/after
measurements): `api/upload.py`'s `delete_knowledge_base_file()` looks up
which vector IDs belong to that file in `metadata.json["vectors"]`, calls
`index.remove_ids([...])`, removes those entries from `metadata.json`,
then deletes the `.pdf`, `.md`, and `.chunks.json` files. Cost is
independent of how many other documents are in the knowledge base — a
delete on a 5-document corpus and a delete on a 500-document corpus take
the same time, because only the deleted document's own vectors are ever
touched. IDs are never reused after a delete (`next_id` only increases),
so there's no risk of a new upload accidentally colliding with a
just-deleted document's old ID.

**Privacy:** files uploaded through the app are written to this machine's
(or server's) own `knowledge-base/` folder. No upload data is sent to any
third party or external service as part of this feature.

**Memory on lower-RAM machines (8-16GB):** one PDF is processed at a time —
the UI uploads and indexes a single file per request, and both the parsing
step and the reindex step run as their own subprocesses (the same
subprocess-isolation pattern explained above for `_parse_one_pdf.py`),
not inside the long-lived API server process. So uploading several PDFs
over a session doesn't accumulate memory in the server itself; each
subprocess's memory is freed by the OS when it exits, win or fail.
