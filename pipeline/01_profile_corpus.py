"""
Step 1 — Understand the knowledge base before touching the pipeline.

Why this step exists: last time we built chunks first and only discovered
mid-build that Docling was crashing on the bigger PDFs (silent fallback to a
naive splitter, no page/section metadata). Profiling every PDF up front tells
us page counts, rough structure, and how "textual" vs "scanned" each PDF is
*before* we spend 20+ minutes parsing it — so problems show up as a report,
not as a crash three PDFs in.

Output: rag_index/corpus_profile.json + a printed summary table.
"""

from __future__ import annotations

import json
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
KB = ROOT / "knowledge-base"
OUT_DIR = ROOT / "rag_index"
OUT_PATH = OUT_DIR / "corpus_profile.json"


def profile_pdf(pdf_path: Path) -> dict:
    with fitz.open(pdf_path) as doc:
        page_count = doc.page_count
        size_mb = pdf_path.stat().st_size / (1024 * 1024)

        text_chars = 0
        image_pages = 0
        sample_pages = []

        for i, page in enumerate(doc):
            text = page.get_text()
            text_chars += len(text)
            images = page.get_images()
            if images and len(text.strip()) < 50:
                # page is mostly an image with little/no extractable text —
                # a signal that OCR might be needed for this page
                image_pages += 1
            if i in (0, page_count // 2, page_count - 1):
                sample_pages.append(
                    {"page": i + 1, "preview": text.strip().replace("\n", " ")[:200]}
                )

        toc = doc.get_toc()  # PDF bookmarks/outline, if present

    avg_chars_per_page = text_chars / page_count if page_count else 0

    return {
        "file": pdf_path.name,
        "size_mb": round(size_mb, 2),
        "page_count": page_count,
        "avg_chars_per_page": round(avg_chars_per_page, 1),
        "image_heavy_pages": image_pages,
        "has_bookmarks": bool(toc),
        "bookmark_count": len(toc),
        "likely_needs_ocr": image_pages > page_count * 0.1,
        "sample_pages": sample_pages,
    }


def main() -> None:
    pdf_files = sorted(KB.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError(f"No PDFs found in {KB}")

    profiles = [profile_pdf(p) for p in pdf_files]

    OUT_DIR.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(profiles, indent=2), encoding="utf-8")

    print("=" * 70)
    print(f"{'PDF':<28} {'Pages':>6} {'MB':>7} {'Chars/pg':>9} {'OCR?':>6} {'TOC':>5}")
    print("=" * 70)
    for p in profiles:
        print(
            f"{p['file']:<28} {p['page_count']:>6} {p['size_mb']:>7.1f} "
            f"{p['avg_chars_per_page']:>9.0f} {'yes' if p['likely_needs_ocr'] else 'no':>6} "
            f"{p['bookmark_count']:>5}"
        )
    print(f"\nFull profile written to {OUT_PATH}")


if __name__ == "__main__":
    main()
