"""Shared paths and constants for the pipeline scripts.

Centralised here so every stage (parse, index, eval-gen) agrees on where
things live without re-deriving paths in each file.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
KB = ROOT / "knowledge-base"
RAG_INDEX = ROOT / "rag_index"
PARSED_MD = RAG_INDEX / "parsed_markdown"
CHUNKS_PATH = RAG_INDEX / "chunks.json"
INDEX_PATH = RAG_INDEX / "faiss.index"
METADATA_PATH = RAG_INDEX / "metadata.json"
CORPUS_PROFILE_PATH = RAG_INDEX / "corpus_profile.json"
EVAL_SET_PATH = ROOT / "data" / "evaluation_set_v2.json"

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
OLLAMA_MODEL = "qwen3:8b"

# Pages where text extraction is known to be unreliable (custom font
# encodings without a proper ToUnicode CMap -> garbled glyphs). Found via
# pipeline/01_profile_corpus.py. Format: {"pdf_name": [page_numbers]}.
KNOWN_GARBLED_PAGES = {
    "Data Science.pdf": [266],
}
