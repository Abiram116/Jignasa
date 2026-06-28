"""
Step 3 — Embed all chunks and build the FAISS index.

Why FAISS IndexFlatIP (exact search) rather than an approximate index:
at the size of this corpus (a few thousand chunks), exact brute-force
cosine search is sub-millisecond and has zero recall loss. Approximate
indexes (HNSW/IVF) trade recall for speed and only pay off once you have
on the order of 100K+ vectors. See pipeline/README.md for the full
reasoning, including why a dedicated vector DB isn't needed yet either.

Why IndexIDMap (since 2026-06-28, see pipeline/REBUILD_LOG.md): wrapping
the flat index in an IndexIDMap lets every vector carry a stable integer
ID instead of being addressed only by its position in the index. That's
what makes pipeline/_add_to_index.py's incremental adds and
api/upload.py's per-document deletes both possible without rebuilding
the whole index -- a plain IndexFlatIP has no concept of "this vector
belongs to this document," only "the vector at position 47."

This script reads every rag_index/parsed_markdown/*.chunks.json (written by
02_parse_and_chunk.py), embeds them all in one batch, and writes:
  - rag_index/faiss.index   (IndexIDMap-wrapped vectors)
  - rag_index/metadata.json ({"next_id": int, "vectors": {"<id>": {...}}})
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import (  # noqa: E402
    EMBEDDING_MODEL,
    INDEX_PATH,
    METADATA_PATH,
    PARSED_MD,
)


def load_all_chunks() -> list[dict]:
    chunk_files = sorted(PARSED_MD.glob("*.chunks.json"))
    if not chunk_files:
        print(f"No *.chunks.json files found in {PARSED_MD}.")
        print("Run pipeline/02_parse_and_chunk.py first, then rerun this script.")
        print("See knowledge-base/README.md for details.")
        sys.exit(0)
    chunks = []
    for f in chunk_files:
        chunks.extend(json.loads(f.read_text(encoding="utf-8")))
    return chunks


def main() -> None:
    from langchain_huggingface import HuggingFaceEmbeddings

    chunks = load_all_chunks()
    low_conf = sum(1 for c in chunks if c["metadata"].get("low_confidence"))
    print(f"Loaded {len(chunks)} chunks ({low_conf} flagged low_confidence)")

    print(f"Loading embedding model: {EMBEDDING_MODEL} ...")
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )

    texts = [c["text"] for c in chunks]
    print(f"Embedding {len(texts)} chunks ...")
    vectors = np.asarray(embeddings.embed_documents(texts), dtype=np.float32)
    faiss.normalize_L2(vectors)

    ids = np.arange(len(chunks), dtype=np.int64)
    index = faiss.IndexIDMap(faiss.IndexFlatIP(vectors.shape[1]))
    index.add_with_ids(vectors, ids)
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_PATH))

    metadata = {
        "next_id": len(chunks),
        "vectors": {
            str(i): (c["metadata"] | {"text": c["text"]})
            for i, c in enumerate(chunks)
        },
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nFAISS index: {INDEX_PATH} ({index.ntotal} vectors, dim={vectors.shape[1]})")
    print(f"Metadata:    {METADATA_PATH}")

    by_source = {}
    for c in chunks:
        by_source[c["metadata"]["source"]] = by_source.get(c["metadata"]["source"], 0) + 1
    print("\nChunks per source:")
    for src, n in sorted(by_source.items()):
        print(f"  {src}: {n}")


if __name__ == "__main__":
    main()
