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

import hashlib
import json
import logging
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import faiss
import numpy as np
from fastapi import HTTPException, UploadFile

from api.config import INDEX_PATH, KB, METADATA_PATH
from pipeline.common.config import PARSED_MD

logger = logging.getLogger("jignasa")

_PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
_PARSE_WORKER = _PIPELINE_DIR / "_parse_one_pdf.py"
_ADD_TO_INDEX_WORKER = _PIPELINE_DIR / "_add_to_index.py"


def _sha256_streaming(read_chunk) -> str:
    """Hash a stream of bytes in fixed-size chunks, never holding more than
    one chunk in memory at a time -- matters here since this runs once per
    upload over the new file *and* over every already-indexed PDF."""
    h = hashlib.sha256()
    for chunk in iter(lambda: read_chunk(1024 * 1024), b""):
        h.update(chunk)
    return h.hexdigest()


def _atomic_write(write_fn, target: Path) -> None:
    tmp = target.parent / f"{target.name}.tmp"
    write_fn(tmp)
    tmp.replace(target)


def list_knowledge_base_files() -> list[dict]:
    return [
        {"name": p.name, "size_bytes": p.stat().st_size}
        for p in sorted(KB.glob("*.pdf"))
    ]


def delete_knowledge_base_file(filename: str) -> None:
    """
    Remove a document and its vectors. Since the index is an IndexIDMap
    (pipeline/REBUILD_LOG.md, 2026-06-28), this is a surgical
    `index.remove_ids()` over just this document's vector IDs -- not a
    full rebuild. Cost is independent of how many other documents are in
    the knowledge base, which matters once it holds dozens of them.
    """
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename.")

    pdf_path = (KB / filename).resolve()
    if pdf_path.parent != KB.resolve() or not pdf_path.exists():
        raise HTTPException(404, "File not found.")

    if METADATA_PATH.exists() and INDEX_PATH.exists():
        metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        ids_to_remove = [
            int(vec_id)
            for vec_id, item in metadata["vectors"].items()
            if item.get("source") == filename
        ]

        if ids_to_remove:
            index = faiss.read_index(str(INDEX_PATH))
            index.remove_ids(np.array(ids_to_remove, dtype=np.int64))
            _atomic_write(lambda tmp: faiss.write_index(index, str(tmp)), INDEX_PATH)

            for vec_id in ids_to_remove:
                del metadata["vectors"][str(vec_id)]
            _atomic_write(
                lambda tmp: tmp.write_text(json.dumps(metadata, indent=2), encoding="utf-8"),
                METADATA_PATH,
            )
            logger.info("Removed %d vectors for %s", len(ids_to_remove), filename)

    pdf_path.unlink()
    md_file = PARSED_MD / f"{pdf_path.stem}.md"
    chunks_file = PARSED_MD / f"{pdf_path.stem}.chunks.json"
    if md_file.exists():
        md_file.unlink()
    if chunks_file.exists():
        chunks_file.unlink()


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
    # Check for exact filename match
    if dest.exists():
        raise HTTPException(
            400,
            f'This document ("{filename}") is already in your knowledge base.'
        )

    # Hash the upload in chunks (no need to buffer the whole file just to
    # check its hash), then rewind before the actual save below.
    upload_hash = _sha256_streaming(file.file.read)
    file.file.seek(0)

    # Check for renamed duplicates by hashing all existing PDFs, one chunk
    # at a time -- a knowledge base can hold many, possibly large, PDFs, so
    # this avoids loading any of them fully into memory just for a hash.
    for existing_pdf in KB.glob("*.pdf"):
        with existing_pdf.open("rb") as f:
            existing_hash = _sha256_streaming(f.read)
        if existing_hash == upload_hash:
            raise HTTPException(
                400,
                f'This exact document is already in your knowledge base under the name "{existing_pdf.name}".'
            )

    with dest.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            out.write(chunk)

    return dest


def stream_upload_and_reindex(pdf_path: Path) -> Iterator[dict]:
    yield {"type": "start", "filename": pdf_path.name}

    try:
        proc = subprocess.Popen(
            [sys.executable, str(_PARSE_WORKER), str(pdf_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.stdout is not None:
            for line in iter(proc.stdout.readline, ""):
                line = line.strip()
                if line.startswith("[stage] "):
                    stage = line.replace("[stage] ", "").strip()
                    yield {"type": stage}
        proc.wait()
    except Exception:
        logger.exception("Failed to launch parsing subprocess for %s", pdf_path.name)
        yield {"type": "error", "message": "Couldn't start processing this file. Please try again."}
        return

    if proc.returncode != 0:
        stderr_out = proc.stderr.read() if proc.stderr else ""
        logger.error("Parsing failed for %s:\n%s", pdf_path.name, stderr_out)
        yield {
            "type": "error",
            "message": (
                f'Couldn\'t parse "{pdf_path.name}". It may be corrupted, '
                "password-protected, or in an unsupported format."
            ),
        }
        return

    yield {"type": "parsed", "ok": True}
    yield {"type": "reindexing"}

    chunks_path = PARSED_MD / f"{pdf_path.stem}.chunks.json"
    try:
        proc = subprocess.Popen(
            [sys.executable, str(_ADD_TO_INDEX_WORKER), str(chunks_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.stdout is not None:
            for line in iter(proc.stdout.readline, ""):
                line = line.strip()
                if line.startswith("[stage] "):
                    stage = line.replace("[stage] ", "").strip()
                    yield {"type": stage}
        proc.wait()
    except Exception:
        logger.exception("Failed to launch indexing subprocess after uploading %s", pdf_path.name)
        yield {"type": "error", "message": "Couldn't add this file to the index. Please try again."}
        return

    if proc.returncode != 0:
        stderr_out = proc.stderr.read() if proc.stderr else ""
        logger.error("Indexing failed after uploading %s:\n%s", pdf_path.name, stderr_out)
        yield {"type": "error", "message": "Couldn't add this file to the index. Please try again."}
        return

    chunk_count = 0
    if METADATA_PATH.exists():
        chunk_count = len(json.loads(METADATA_PATH.read_text(encoding="utf-8"))["vectors"])

    yield {"type": "done", "chunk_count": chunk_count}
