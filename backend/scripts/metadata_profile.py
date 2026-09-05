"""Profile metadata-first API payloads against a synthetic 1,000-note vault."""

from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

from starlette.testclient import TestClient

from api.main import app
from core.config import LoomSettings
from core.note_index import NoteIndex, get_note_index
from core.notes import note_to_file_content, now_iso
from core.vault import VaultManager, get_vault_manager


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="Optional JSON report path (stdout is always printed)"
    )
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="loom-metadata-profile-") as temporary:
        settings = LoomSettings(loom_home=Path(temporary) / ".loom")
        manager = VaultManager(settings=settings)
        manager.init_vault("profile")
        manager.set_active_vault("profile")
        root = manager.active_vault_dir()
        body = ("profile content " * 700)[:10_240]
        stamp = now_iso()
        for number in range(1000):
            path = root / "threads" / "topics" / f"note-{number}.md"
            path.write_text(
                note_to_file_content(
                    {
                        "id": f"n{number}",
                        "title": f"Note {number}",
                        "type": "topic",
                        "tags": ["profile"],
                        "created": stamp,
                        "modified": stamp,
                        "author": "user",
                        "status": "active",
                        "history": [],
                    },
                    body,
                )
            )
        index = NoteIndex()
        index.build(root / "threads")
        app.dependency_overrides[get_vault_manager] = lambda: manager
        app.dependency_overrides[get_note_index] = lambda: index
        try:
            client = TestClient(app)
            try:
                metadata_started = time.perf_counter()
                pages = [
                    client.get("/api/notes", params={"offset": offset, "limit": 200})
                    for offset in range(0, 1000, 200)
                ]
                graph = client.get("/api/graph")
                selected = client.get("/api/notes/n0")
                metadata = (
                    sum(len(response.content) for response in pages)
                    + len(graph.content)
                    + len(selected.content)
                )
                metadata_elapsed = round((time.perf_counter() - metadata_started) * 1000, 2)
                bulk_started = time.perf_counter()
                bulk_pages = [
                    client.get("/api/notes/bulk", params={"offset": offset, "limit": 200})
                    for offset in range(0, 1000, 200)
                ]
                bulk_elapsed = round((time.perf_counter() - bulk_started) * 1000, 2)
                assert all(
                    response.status_code == 200
                    for response in [*pages, graph, selected, *bulk_pages]
                )
                assert sum(len(response.json()["notes"]) for response in pages) == 1000
                assert sum(len(response.json()["notes"]) for response in bulk_pages) == 1000
                bulk = sum(len(response.content) for response in bulk_pages)
                report = {
                    "notes": 1000,
                    "body_bytes_each": len(body),
                    "metadata_pages_graph_selected_bytes": metadata,
                    "bulk_bytes": bulk,
                    "bytes_reduction": bulk - metadata,
                    "metadata_elapsed_ms": metadata_elapsed,
                    "bulk_elapsed_ms": bulk_elapsed,
                }
            finally:
                client.close()
        finally:
            app.dependency_overrides.clear()
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
