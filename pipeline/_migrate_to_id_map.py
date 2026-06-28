"""
One-time migration (2026-06-28, see pipeline/REBUILD_LOG.md): converts an
existing flat IndexFlatIP + list-shaped metadata.json into the new
IndexIDMap + dict-shaped format, without re-embedding anything.

Why no re-embedding is needed: IndexFlatIP stores the raw vectors it was
given, so `index.reconstruct_n()` hands them back exactly as they were
computed originally -- there's no information loss from skipping the
embedding model entirely. That's strictly better than re-embedding: it's
instant, and it can't drift even if the embedding model's library version
ever changes between when the index was first built and when this script
runs.

Run once, after pulling this change, before using the upload/delete
features. Safe to run on an already-migrated index (it's a no-op then,
see the guard at the top of main()).

Usage: python pipeline/_migrate_to_id_map.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common.config import INDEX_PATH, METADATA_PATH  # noqa: E402


def main() -> None:
    if not INDEX_PATH.exists() or not METADATA_PATH.exists():
        print("No existing index found -- nothing to migrate.")
        return

    old_metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    if isinstance(old_metadata, dict) and "vectors" in old_metadata:
        print("Already migrated (metadata.json is already dict-shaped). Nothing to do.")
        return

    if not isinstance(old_metadata, list):
        print(f"Unrecognized metadata.json shape ({type(old_metadata)}) -- aborting, not safe to migrate.")
        sys.exit(1)

    old_index = faiss.read_index(str(INDEX_PATH))
    if old_index.ntotal != len(old_metadata):
        print(
            f"Index has {old_index.ntotal} vectors but metadata.json has "
            f"{len(old_metadata)} entries -- these should match. Aborting."
        )
        sys.exit(1)

    print(f"Reconstructing {old_index.ntotal} existing vectors (no re-embedding) ...")
    vectors = old_index.reconstruct_n(0, old_index.ntotal)

    ids = np.arange(len(old_metadata), dtype=np.int64)
    new_index = faiss.IndexIDMap(faiss.IndexFlatIP(vectors.shape[1]))
    new_index.add_with_ids(vectors, ids)

    new_metadata = {
        "next_id": len(old_metadata),
        "vectors": {str(i): item for i, item in enumerate(old_metadata)},
    }

    # Back up the old files before overwriting, in case anything looks
    # wrong afterward -- this only ever runs once, so the extra caution
    # costs nothing.
    backup_index = INDEX_PATH.with_suffix(".index.pre-idmap.bak")
    backup_meta = METADATA_PATH.with_suffix(".json.pre-idmap.bak")
    INDEX_PATH.replace(backup_index)
    METADATA_PATH.replace(backup_meta)
    print(f"Backed up old index/metadata to {backup_index.name} / {backup_meta.name}")

    faiss.write_index(new_index, str(INDEX_PATH))
    METADATA_PATH.write_text(json.dumps(new_metadata, indent=2), encoding="utf-8")

    by_source: dict[str, int] = {}
    for item in old_metadata:
        src = item.get("source", "unknown")
        by_source[src] = by_source.get(src, 0) + 1

    print(f"\nMigrated {new_index.ntotal} vectors into an IndexIDMap.")
    print("Chunks per source (unchanged from before migration):")
    for src, n in sorted(by_source.items()):
        print(f"  {src}: {n}")


if __name__ == "__main__":
    main()
