#!/usr/bin/env python3
"""Benchmark metadata indexing and graph construction on synthetic vaults.

The default 1k/5k/10k sweep is intentionally provider-free and writes only to
a temporary directory. Use ``--max-total-seconds`` in release automation when
the runner class is stable enough to enforce a performance budget.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.graph import build_graph
from core.note_index import NoteIndex
from core.notes import note_to_file_content


def _note_content(index: int) -> str:
    previous = f"note-{index - 1:05d}" if index else ""
    body = f"# Note {index:05d}\n\nSynthetic large-vault fixture."
    if previous:
        body += f"\n\nRelated to [[{previous}]]."
    return note_to_file_content(
        {
            "id": f"thr_{index:08d}",
            "title": f"Note {index:05d}",
            "type": ("project", "topic", "person", "daily")[index % 4],
            "tags": ["benchmark", f"bucket-{index % 20}"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        body,
    )


def benchmark(size: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix=f"loom-benchmark-{size}-") as raw:
        threads = Path(raw) / "threads"
        threads.mkdir()

        started = time.perf_counter()
        for index in range(size):
            folder = threads / ("projects" if index % 4 == 0 else "topics")
            folder.mkdir(exist_ok=True)
            (folder / f"note-{index:05d}.md").write_text(_note_content(index), encoding="utf-8")
        generated_seconds = time.perf_counter() - started

        note_index = NoteIndex()
        started = time.perf_counter()
        note_index.build(threads)
        index_seconds = time.perf_counter() - started

        started = time.perf_counter()
        graph = build_graph(threads)
        graph_seconds = time.perf_counter() - started

        return {
            "notes": size,
            "indexed": note_index.size,
            "nodes": len(graph.nodes),
            "edges": len(graph.edges),
            "generate_seconds": round(generated_seconds, 4),
            "index_seconds": round(index_seconds, 4),
            "graph_seconds": round(graph_seconds, 4),
            "total_seconds": round(index_seconds + graph_seconds, 4),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sizes",
        type=int,
        nargs="+",
        default=[1_000, 5_000, 10_000],
        help="Synthetic vault sizes to benchmark (default: 1000 5000 10000)",
    )
    parser.add_argument(
        "--max-total-seconds",
        type=float,
        help="Fail if indexing + graph construction exceeds this per size",
    )
    args = parser.parse_args()

    results = [benchmark(size) for size in args.sizes]
    print(json.dumps({"results": results}, indent=2))

    invalid = [result for result in results if result["indexed"] != result["notes"]]
    if args.max_total_seconds is not None:
        invalid.extend(
            result for result in results if result["total_seconds"] > args.max_total_seconds
        )
    raise SystemExit(1 if invalid else 0)


if __name__ == "__main__":
    main()
