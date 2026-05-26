"""Tests for core/vault_io.py — the safe-write chokepoint for agents."""

from pathlib import Path

import pytest

from core.vault_io import VaultIOError, write_note, write_text


def _vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    (vault / "threads" / "topics").mkdir(parents=True)
    (vault / "threads" / "captures").mkdir()
    (vault / "threads" / ".archive").mkdir()
    (vault / "rules").mkdir()
    (vault / "rules" / "prime.md").write_text("# Prime\n")
    (vault / ".loom").mkdir()
    return vault


class TestWriteNote:
    def test_writes_inside_threads(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        target = vault / "threads" / "topics" / "alpha.md"

        write_note(
            vault,
            target,
            {"id": "thr_x", "title": "Alpha"},
            "## About\n\nbody",
        )

        assert target.exists()
        content = target.read_text(encoding="utf-8")
        assert "id: thr_x" in content
        assert "About" in content

    def test_rejects_path_outside_threads(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        outside = vault / "agents" / "stranger.md"
        with pytest.raises(VaultIOError, match="threads/"):
            write_note(vault, outside, {"id": "x"}, "")

    def test_rejects_archive_path(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        archived = vault / "threads" / ".archive" / "old.md"
        with pytest.raises(VaultIOError, match=".archive"):
            write_note(vault, archived, {"id": "x"}, "")

    def test_rejects_prime_md(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        prime = vault / "rules" / "prime.md"
        with pytest.raises(VaultIOError, match="prime.md"):
            write_note(vault, prime, {"id": "x"}, "")

    def test_rejects_non_md(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        bad = vault / "threads" / "topics" / "alpha.txt"
        with pytest.raises(VaultIOError, match="\\.md"):
            write_note(vault, bad, {"id": "x"}, "")


class TestWriteText:
    def test_writes_index_md(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        idx = vault / "threads" / "topics" / "_index.md"
        write_text(vault, idx, "# Topics Index\n\nhello")
        assert idx.read_text(encoding="utf-8") == "# Topics Index\n\nhello"

    def test_rejects_path_traversal(self, tmp_path: Path) -> None:
        vault = _vault(tmp_path)
        outside = tmp_path / "elsewhere.md"
        with pytest.raises(VaultIOError):
            write_text(vault, outside, "x")
