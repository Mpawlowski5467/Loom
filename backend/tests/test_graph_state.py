"""Tests for the graph dirty-flag mechanism."""

from pathlib import Path

from core.graph_state import clear_dirty, is_dirty, mark_dirty
from core.notes import atomic_write_text


class TestMarkAndClear:
    def test_initially_clean(self, tmp_path: Path) -> None:
        loom = tmp_path / ".loom"
        loom.mkdir()
        assert is_dirty(loom) is False

    def test_mark_then_dirty(self, tmp_path: Path) -> None:
        loom = tmp_path / ".loom"
        loom.mkdir()
        mark_dirty(loom)
        assert is_dirty(loom) is True

    def test_clear_resets(self, tmp_path: Path) -> None:
        loom = tmp_path / ".loom"
        loom.mkdir()
        mark_dirty(loom)
        clear_dirty(loom)
        assert is_dirty(loom) is False

    def test_clear_when_not_dirty_is_noop(self, tmp_path: Path) -> None:
        loom = tmp_path / ".loom"
        loom.mkdir()
        # Should not raise.
        clear_dirty(loom)
        assert is_dirty(loom) is False

    def test_mark_creates_loom_dir_if_missing(self, tmp_path: Path) -> None:
        loom = tmp_path / "fresh" / ".loom"
        assert not loom.exists()
        mark_dirty(loom)
        assert loom.is_dir()
        assert is_dirty(loom) is True


class TestAtomicWriteMarksDirty:
    def test_write_under_vault_marks_dirty(self, tmp_path: Path) -> None:
        """A write to a markdown file inside a vault marks the graph dirty."""
        vault = tmp_path / "vault"
        threads = vault / "threads" / "topics"
        threads.mkdir(parents=True)
        loom = vault / ".loom"
        loom.mkdir()

        note_path = threads / "alpha.md"
        atomic_write_text(note_path, "---\nid: thr_x\n---\n\ncontent")

        assert is_dirty(loom) is True

    def test_write_outside_vault_does_not_mark(self, tmp_path: Path) -> None:
        """Writes with no .loom ancestor are a no-op for graph state."""
        path = tmp_path / "scratch.md"
        atomic_write_text(path, "scratch")
        # No exception, and obviously no .loom dir was created.
        assert not (tmp_path / ".loom").exists()

    def test_mark_graph_dirty_false_skips(self, tmp_path: Path) -> None:
        """Callers can opt out (e.g. for non-content writes)."""
        vault = tmp_path / "vault"
        threads = vault / "threads"
        threads.mkdir(parents=True)
        loom = vault / ".loom"
        loom.mkdir()

        path = threads / "alpha.md"
        atomic_write_text(path, "x", mark_graph_dirty=False)

        assert is_dirty(loom) is False
