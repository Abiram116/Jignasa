from __future__ import annotations

import json
from functools import lru_cache

import faiss
import numpy as np
from langchain_huggingface import HuggingFaceEmbeddings

from api.config import (
    EMBEDDING_MODEL,
    INDEX_PATH,
    METADATA_PATH,
    OLLAMA_MODEL,
    RAG_INDEX,
    TOP_K,
)
from api.security import neutralise_injection


@lru_cache(maxsize=1)
def _embeddings() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )


def index_ready() -> bool:
    return INDEX_PATH.exists() and METADATA_PATH.exists()


def index_status() -> dict:
    chunk_count = 0
    if METADATA_PATH.exists():
        chunk_count = len(json.loads(METADATA_PATH.read_text(encoding="utf-8")))
    return {
        "ready": index_ready(),
        "chunk_count": chunk_count,
        "index_dir": str(RAG_INDEX),
        "embedding_model": EMBEDDING_MODEL,
        "llm_model": OLLAMA_MODEL,
        "top_k": TOP_K,
    }


def load_index() -> tuple[faiss.IndexFlatIP, list[dict]]:
    if not index_ready():
        raise FileNotFoundError(
            f"No index in `{RAG_INDEX}`. Run `pipeline/02_parse_and_chunk.py` "
            "and `pipeline/03_build_index.py` first (see pipeline/README.md)."
        )
    index = faiss.read_index(str(INDEX_PATH))
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    return index, metadata


def search(query: str, k: int = TOP_K) -> list[dict]:
    """Search FAISS using the raw query string."""
    index, metadata = load_index()
    emb = _embeddings()
    qv = np.asarray([emb.embed_query(query)], dtype=np.float32)
    faiss.normalize_L2(qv)
    scores, indices = index.search(qv, k)
    hits: list[dict] = []
    for rank, (score, idx) in enumerate(zip(scores[0], indices[0], strict=True), start=1):
        if idx == -1:
            continue
        item = metadata[idx]
        hits.append(
            {
                "rank": rank,
                "score": float(score),
                "source": item.get("source"),
                "page_number": item.get("page_number"),
                "text": item.get("text", ""),
            }
        )
    return hits


def search_with_transform(original_query: str, k: int = TOP_K) -> tuple[list[dict], str]:
    """
    Apply query transformation before retrieval.

    Returns (hits, transformed_query) so the caller can pass the original
    question to the prompt builder while benefiting from improved retrieval.
    """
    from api.query_transform import transform_query  # lazy import to avoid circular deps
    transformed = transform_query(original_query)
    hits = search(transformed, k=k)
    return hits, transformed


def build_prompt(question: str, hits: list[dict], history: list[dict] | None = None) -> str:
    """
    Build the RAG prompt. History is now passed via Ollama messages[] in main.py,
    so we only embed context + question here to avoid duplication.
    The `history` param is kept for backwards compatibility but ignored.
    """
    context = "\n\n".join(
        f"[{h['source']} p.{h.get('page_number')}] {neutralise_injection(h['text'])}" for h in hits
    ) or "No relevant chunks were retrieved."
    return f"""Answer the question using ONLY the document context below.
If the answer is not in the context, say exactly: "I don't have enough information in the documents to answer that."
Be concise, factual, and cite the source file when possible.

Document context:
{context}

Question: {question}

Answer:"""
