"""
Lets a PDF be added through the running app instead of copying it into
knowledge-base/ and running the pipeline/ scripts by hand. This module is
glue only -- it saves the file, then calls the exact same code the CLI
pipeline uses to parse it (pipeline/_parse_one_pdf.py's subprocess worker),
then adds just that file's chunks to the existing index incrementally
(pipeline/_add_to_index.py) rather than re-embedding the whole corpus --
important once a knowledge base has many documents, since re-embedding
everything on every single upload would get slower (and use more memory)
as the corpus grows, for no benefit.

Files uploaded here are written to this machine's/server's own
knowledge-base/ folder. Nothing is sent anywhere else.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

from fastapi import HTTPException, UploadFile

from api.config import KB, METADATA_PATH
from pipeline.common.config import PARSED_MD

logger = logging.getLogger("jignasa")

_PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
_PARSE_WORKER = _PIPELINE_DIR / "_parse_one_pdf.py"
_ADD_TO_INDEX_WORKER = _PIPELINE_DIR / "_add_to_index.py"


def list_knowledge_base_files() -> list[dict]:
    return [
        {"name": p.name, "size_bytes": p.stat().st_size}
        for p in sorted(KB.glob("*.pdf"))
    ]


def save_uploaded_pdf(file: UploadFile) -> Path:
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only .pdf files are accepted.")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename.")

    KB.mkdir(parents=True, exist_ok=True)
    dest = (KB / filename).resolve()
    if dest.parent != KB.resolve():
        raise HTTPException(400, "Invalid filename.")
    if dest.exists():
        raise HTTPException(
            400,
            f'A file named "{filename}" already exists in knowledge-base/. '
            "Rename or remove it first.",
        )

    with dest.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            out.write(chunk)

    return dest


def stream_upload_and_reindex(pdf_path: Path) -> Iterator[dict]:
    yield {"type": "start", "filename": pdf_path.name}

    try:
        proc = subprocess.run(
            [sys.executable, str(_PARSE_WORKER), str(pdf_path)],
            capture_output=True,
            text=True,
        )
    except Exception:
        logger.exception("Failed to launch parsing subprocess for %s", pdf_path.name)
        yield {"type": "error", "message": "Couldn't start processing this file. Please try again."}
        return

    if proc.returncode != 0:
        logger.error("Parsing failed for %s:\n%s", pdf_path.name, proc.stderr)
        yield {
            "type": "error",
            "message": (
                f'Couldn\'t parse "{pdf_path.name}". It may be corrupted, '
                "password-protected, or in an unsupported format."
            ),
        }
        return

    yield {"type": "parsed", "ok": True, "message": proc.stdout.strip()}
    yield {"type": "reindexing"}

    # Incremental add (pipeline/_add_to_index.py), not a full rebuild: only
    # this PDF's chunks get embedded and appended to the existing index --
    # re-embedding the whole corpus on every single upload would get slower
    # (and use more memory) the larger the knowledge base grows, for no
    # benefit, since nothing about the already-indexed documents changed.
    # Still run as a subprocess, for the same memory-isolation reason
    # parsing does: the API server is a long-lived process, so loading the
    # embedding model in-process on every upload would accumulate memory
    # there instead of in a process that exits and frees it.
    chunks_path = PARSED_MD / f"{pdf_path.stem}.chunks.json"
    try:
        proc = subprocess.run(
            [sys.executable, str(_ADD_TO_INDEX_WORKER), str(chunks_path)],
            capture_output=True,
            text=True,
        )
    except Exception:
        logger.exception("Failed to launch indexing subprocess after uploading %s", pdf_path.name)
        yield {"type": "error", "message": "Couldn't add this file to the index. Please try again."}
        return

    if proc.returncode != 0:
        logger.error("Indexing failed after uploading %s:\n%s", pdf_path.name, proc.stderr)
        yield {"type": "error", "message": "Couldn't add this file to the index. Please try again."}
        return

    chunk_count = 0
    if METADATA_PATH.exists():
        chunk_count = len(json.loads(METADATA_PATH.read_text(encoding="utf-8")))

    yield {"type": "done", "chunk_count": chunk_count}
