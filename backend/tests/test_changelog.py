"""Tests for agents/changelog.py — structured action logging."""

from pathlib import Path

from agents.changelog import log_action


def _setup_vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    root.mkdir()
    (root / ".loom" / "changelog" / "weaver").mkdir(parents=True)
    (root / "agents" / "weaver" / "logs").mkdir(parents=True)
    return root


class TestLogAction:
    def test_creates_changelog_file(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "threads/topics/test.md", details="New note")

        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "# Changelog" in content
        assert "**Agent:** weaver" in content
        assert "**Action:** created" in content
        assert "**Target:** threads/topics/test.md" in content
        assert "**Details:** New note" in content

    def test_creates_agent_log_file(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "linked", "thr_abc123")

        logs_dir = root / "agents" / "weaver" / "logs"
        files = list(logs_dir.glob("*.md"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Action:** linked" in content

    def test_appends_to_existing_file(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "note1")
        log_action(root, "weaver", "linked", "note2")

        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) == 1  # Same day, same file
        content = files[0].read_text(encoding="utf-8")
        assert content.count("**Action:**") == 2

    def test_chain_status_recorded(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "blocked", "target", chain_status="fail")

        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        content = files[0].read_text(encoding="utf-8")
        assert "**Chain:** fail" in content

    def test_missing_dirs_created(self, tmp_path: Path):
        """Directories are auto-created if they don't exist."""
        root = tmp_path / "vault"
        root.mkdir()
        # Don't pre-create dirs — log_action should create them
        log_action(root, "spider", "linked", "thr_xyz")

        assert (root / ".loom" / "changelog" / "spider").is_dir()
        assert (root / "agents" / "spider" / "logs").is_dir()

    def test_entry_has_timestamp(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "note")

        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        content = files[0].read_text(encoding="utf-8")
        # Timestamp should be ISO8601-ish: starts with ##, contains T
        lines = content.strip().split("\n")
        # Find the ## line (after the header)
        heading_lines = [line for line in lines if line.startswith("## 20")]
        assert len(heading_lines) >= 1
