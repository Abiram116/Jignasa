"""
Worker script: parses exactly ONE PDF with Docling and writes its chunks to
rag_index/parsed_markdown/<name>.chunks.json.

Why a separate worker invoked via subprocess (see 02_parse_and_chunk.py):
Docling's layout model does not fully release memory between documents in
the same Python process. Running each PDF in a fresh subprocess guarantees
the OS reclaims all memory when the subprocess exits, regardless of what
Docling/PyTorch leak internally. This is what was missing last time and
caused the silent fallback to a low-quality chunker on the larger PDFs.

Usage: python _parse_one_pdf.py <pdf_path>
"""

from __future__ import annotations

import json
import logging
import sys
import warnings
from pathlib import Path

logging.getLogger("RapidOCR").setLevel(logging.CRITICAL)
logging.getLogger("docling").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", message=".*unauthenticated.*HF Hub.*")
warnings.filterwarnings("ignore", message=".*sequence length is longer than.*")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import KNOWN_GARBLED_PAGES, PARSED_MD  # noqa: E402


def page_from_meta(meta) -> int | None:
    if meta is None:
        return None
    for item in getattr(meta, "doc_items", None) or []:
        for prov in getattr(item, "prov", None) or []:
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                return int(page_no)
    return None


def section_from_meta(meta) -> str | None:
    headings = getattr(meta, "headings", None) if meta is not None else None
    if headings:
        return " > ".join(headings)
    return None


def normalize(text: str) -> str:
    return " ".join(text.split()).strip()


# Glyphs from fonts with no ToUnicode CMap land outside normal Latin/Greek/
# punctuation ranges (Hebrew, Arabic, private-use blocks mixed into
# otherwise-English text). A chunk that's mostly this is unusable signal,
# not content -- flag it for human review instead of silently embedding it.
_ALLOWED_RANGES = (
    (0x0000, 0x036F),  # Basic Latin, Latin-1, combining marks
    (0x0370, 0x03FF),  # Greek (common in math/science text)
    (0x2000, 0x206F),  # general punctuation
    (0x2070, 0x20CF),  # superscripts/subscripts, currency
    (0x2100, 0x214F),  # letterlike symbols (e.g. R-blackboard, ell)
    (0x2190, 0x22FF),  # arrows, mathematical operators
)


def _is_allowed(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in _ALLOWED_RANGES)


def is_garbled(text: str) -> bool:
    if not text:
        return False
    bad = sum(1 for c in text if not _is_allowed(c))
    return bad / len(text) > 0.05


def main() -> None:
    pdf_path = Path(sys.argv[1]).resolve()

    from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker

    opts = PdfPipelineOptions(
        do_ocr=False,
        do_table_structure=False,
        force_backend_text=True,
        generate_page_images=False,
        generate_picture_images=False,
    )
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opts, backend=PyPdfiumDocumentBackend)
        }
    )

    result = converter.convert(pdf_path)

    PARSED_MD.mkdir(parents=True, exist_ok=True)
    md_path = PARSED_MD / f"{pdf_path.stem}.md"
    md_path.write_text(result.document.export_to_markdown(), encoding="utf-8")

    chunker = HybridChunker()
    known_garbled = set(KNOWN_GARBLED_PAGES.get(pdf_path.name, []))

    chunks = []
    garbled_count = 0
    for i, chunk in enumerate(chunker.chunk(dl_doc=result.document), start=1):
        text = normalize(getattr(chunk, "text", "") or "")
        if not text:
            continue
        meta = getattr(chunk, "meta", None)
        page_number = page_from_meta(meta)
        flagged_garbled = is_garbled(text) or page_number in known_garbled
        if flagged_garbled:
            garbled_count += 1
        chunks.append(
            {
                "text": text,
                "metadata": {
                    "source": pdf_path.name,
                    "page_number": page_number,
                    "section": section_from_meta(meta),
                    "chunk_index": i,
                    "chunk_type": "docling_hybrid",
                    "low_confidence": flagged_garbled,
                },
            }
        )

    out_path = PARSED_MD / f"{pdf_path.stem}.chunks.json"
    out_path.write_text(json.dumps(chunks, indent=2), encoding="utf-8")

    print(f"OK {pdf_path.name}: {len(chunks)} chunks ({garbled_count} flagged low_confidence)")


if __name__ == "__main__":
    main()
