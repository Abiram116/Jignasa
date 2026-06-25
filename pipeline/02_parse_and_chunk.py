"""
Step 2 — Parse + chunk every PDF with Docling's HybridChunker.

Why subprocess-per-PDF (see pipeline/_parse_one_pdf.py for the worker):
last time, three of four PDFs silently fell back to a naive character
splitter because Docling's layout model crashed/OOM'd mid-notebook-session,
and the notebook quietly recovered by chunking pre-parsed markdown instead
-- losing page numbers and section headings for 94% of the index without
any error surfaced. Isolating each PDF in its own subprocess means a crash
on one PDF can't corrupt or starve the others, and there is no fallback:
if a PDF fails, it's reported as failed, not silently degraded.

This script is resumable: a PDF already chunked (parsed_markdown/<name>.chunks.json
exists) is skipped on rerun.

Output: rag_index/parsed_markdown/<name>.chunks.json (one per PDF)
        rag_index/parsed_markdown/<name>.md (Docling's markdown export)
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import KB, PARSED_MD  # noqa: E402

WORKER = Path(__file__).resolve().parent / "_parse_one_pdf.py"
MAX_RETRIES = 2


def already_done(pdf_path: Path) -> bool:
    return (PARSED_MD / f"{pdf_path.stem}.chunks.json").exists()


def parse_one(pdf_path: Path) -> bool:
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"  attempt {attempt}/{MAX_RETRIES} ...", flush=True)
        start = time.time()
        proc = subprocess.run(
            [sys.executable, str(WORKER), str(pdf_path)],
            capture_output=True,
            text=True,
        )
        elapsed = time.time() - start
        if proc.returncode == 0:
            print(f"  {proc.stdout.strip()}  ({elapsed:.0f}s)")
            return True
        print(f"  FAILED (exit {proc.returncode}, {elapsed:.0f}s):")
        print("  " + (proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "no stderr"))
    return False


def main() -> None:
    pdf_files = sorted(KB.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError(f"No PDFs found in {KB}")

    PARSED_MD.mkdir(parents=True, exist_ok=True)

    failed = []
    for pdf_path in pdf_files:
        print(f"\n=== {pdf_path.name} ===")
        if already_done(pdf_path):
            print("  already parsed, skipping (delete its .chunks.json to redo)")
            continue
        if not parse_one(pdf_path):
            failed.append(pdf_path.name)

    print("\n" + "=" * 50)
    if failed:
        print(f"FAILED: {failed}")
        print("These PDFs have NO chunks -- fix the underlying issue and rerun.")
        sys.exit(1)
    print("All PDFs parsed successfully.")


if __name__ == "__main__":
    main()
