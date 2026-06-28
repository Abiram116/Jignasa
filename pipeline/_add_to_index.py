"""
Worker (not part of the main 01->02->03 sequence): incrementally adds ONE
already-parsed PDF's chunks into the existing FAISS index, instead of
re-embedding the entire corpus.

Why this exists: 03_build_index.py re-embeds every chunk in the corpus on
every run -- correct, but wasteful once the knowledge base has many
documents and someone uploads just one more through the running app. This
worker embeds only the new file's chunks and appends them to the existing
index/metadata in place. 03_build_index.py is still the right tool for the
initial multi-PDF build and for full-recovery rebuilds (e.g. after deleting
a .chunks.json to force a PDF to be reparsed) -- this worker is strictly
additive and is only safe to use for chunks that aren't already indexed.

Usage: python _add_to_index.py <chunks_json_path>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import EMBEDDING_MODEL, INDEX_PATH, METADATA_PATH  # noqa: E402


def _atomic_write_bytes_via(write_fn, target: Path) -> None:
    """Write to a temp file next to `target`, then rename over it -- so a
    crash mid-write never leaves a half-written index/metadata file."""
    tmp = target.parent / f"{target.name}.tmp"
    write_fn(tmp)
    tmp.replace(target)


def main() -> None:
    chunks_path = Path(sys.argv[1]).resolve()
    chunks = json.loads(chunks_path.read_text(encoding="utf-8"))
    if not chunks:
        print("No chunks to add (empty file).")
        return

    from langchain_huggingface import HuggingFaceEmbeddings

    print(f"Loading embedding model: {EMBEDDING_MODEL} ...")
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )

    texts = [c["text"] for c in chunks]
    print(f"Embedding {len(texts)} new chunks ...")
    vectors = np.asarray(embeddings.embed_documents(texts), dtype=np.float32)
    faiss.normalize_L2(vectors)

    if INDEX_PATH.exists():
        index = faiss.read_index(str(INDEX_PATH))
    else:
        index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_bytes_via(lambda tmp: faiss.write_index(index, str(tmp)), INDEX_PATH)

    metadata = []
    if METADATA_PATH.exists():
        metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    metadata.extend(c["metadata"] | {"text": c["text"]} for c in chunks)
    _atomic_write_bytes_via(
        lambda tmp: tmp.write_text(json.dumps(metadata, indent=2), encoding="utf-8"),
        METADATA_PATH,
    )

    print(f"Added {len(chunks)} chunks. Index now has {index.ntotal} vectors.")


if __name__ == "__main__":
    main()
