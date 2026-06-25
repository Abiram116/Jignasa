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
| `03_build_index.py` | Embeds all chunks with BGE and builds the FAISS index. | `rag_index/faiss.index`, `rag_index/metadata.json` |
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

**Why per-PDF subprocess isolation?**
See "Why scripts instead of a notebook" above — this is the actual fix for
the crash that caused silent data-quality loss last time.

## Running it

```bash
cd "RAG With LangChain"
python3 pipeline/01_profile_corpus.py
python3 pipeline/02_parse_and_chunk.py   # resumable; skips PDFs already chunked
python3 pipeline/03_build_index.py
python3 pipeline/04_generate_eval_set.py
```

Delete a PDF's `rag_index/parsed_markdown/<name>.chunks.json` to force
re-parsing just that PDF.
