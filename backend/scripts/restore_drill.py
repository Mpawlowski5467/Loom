#!/usr/bin/env python3
"""Run a provider-free export/restore drill against a temporary multi-vault home."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.routers.vaults import _build_export_archive, _restore_tarball
from core.config import LoomSettings
from core.notes import note_to_file_content
from core.vault import VaultManager


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="loom-restore-drill-") as raw:
        loom_home = Path(raw) / "loom-home"
        drill_settings = LoomSettings(loom_home=loom_home)
        manager = VaultManager(drill_settings)
        source = manager.init_vault("source")
        manager.init_vault("companion")

        note = source / "threads" / "projects" / "release-drill.md"
        note.write_text(
            note_to_file_content(
                {
                    "id": "thr_release_drill",
                    "title": "Release restore drill",
                    "type": "project",
                    "tags": ["release", "backup"],
                    "created": "2026-01-01T00:00:00+00:00",
                    "modified": "2026-01-01T00:00:00+00:00",
                    "author": "user",
                    "status": "active",
                    "history": [],
                },
                "# Restore drill\n\nIntegrity marker: loom-release-restore.",
            ),
            encoding="utf-8",
        )
        expected_hash = _sha256(note)

        archive = _build_export_archive(source, "source", loom_home)
        restored = manager.vault_path("restored")
        _restore_tarball(
            archive,
            restored,
            drill_settings.vaults_dir,
            overwrite=False,
        )
        restored_note = restored / "threads" / "projects" / "release-drill.md"
        actual_hash = _sha256(restored_note)
        report = {
            "vaults_before_restore": ["companion", "source"],
            "archive_bytes": archive.stat().st_size,
            "restored_vault": "restored",
            "note_sha256": actual_hash,
            "integrity_ok": actual_hash == expected_hash,
        }
        print(json.dumps(report, indent=2))
        raise SystemExit(0 if report["integrity_ok"] else 1)


if __name__ == "__main__":
    main()
