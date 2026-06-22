"""Unit tests for VaultManager."""

import json
from pathlib import Path

import pytest

from core.exceptions import (
    InvalidVaultNameError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.vault import CORE_FOLDERS, VaultManager, VaultPathError


class TestInitVault:
    """Tests for vault initialization."""

    def test_creates_threads_folders(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        for folder in CORE_FOLDERS:
            assert (root / "threads" / folder).is_dir()

    def test_creates_loom_agent_dirs(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        for agent in ["weaver", "spider", "archivist", "scribe", "sentinel"]:
            agent_dir = root / "agents" / agent
            assert agent_dir.is_dir()
            assert (agent_dir / "config.yaml").is_file()
            assert (agent_dir / "memory.md").is_file()
            assert (agent_dir / "state.json").is_file()
            assert (agent_dir / "logs").is_dir()
            assert not (agent_dir / "chat").exists()

    def test_creates_shuttle_agent_dirs_with_chat(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        for agent in ["researcher", "standup"]:
            agent_dir = root / "agents" / agent
            assert (agent_dir / "chat").is_dir()

    def test_creates_council_chat(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert (root / "agents" / "_council" / "chat").is_dir()

    def test_creates_rules(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert (root / "rules" / "prime.md").is_file()
        assert "constitution" in (root / "rules" / "prime.md").read_text().lower()
        for schema in ["project.md", "topic.md", "person.md", "daily.md", "capture.md"]:
            assert (root / "rules" / "schemas" / schema).is_file()

    def test_creates_prompts(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert (root / "prompts" / "shared" / "system-preamble.md").is_file()

    def test_creates_loom_meta_and_changelogs(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert (root / ".loom" / "changelog").is_dir()
        for agent in [
            "weaver",
            "spider",
            "archivist",
            "scribe",
            "sentinel",
            "researcher",
            "standup",
        ]:
            assert (root / ".loom" / "changelog" / agent).is_dir()

    def test_creates_vault_yaml(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert (root / "vault.yaml").is_file()

    def test_agent_state_is_valid_json(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        state = json.loads((root / "agents" / "weaver" / "state.json").read_text())
        assert state["action_count"] == 0

    def test_default_files_have_content(self, vault_manager: VaultManager) -> None:
        root = vault_manager.init_vault("test")
        assert len((root / "rules" / "prime.md").read_text()) > 100
        assert len((root / "rules" / "schemas" / "project.md").read_text()) > 50
        assert len((root / "prompts" / "shared" / "system-preamble.md").read_text()) > 50

    def test_duplicate_raises(self, vault_manager: VaultManager) -> None:
        vault_manager.init_vault("test")
        with pytest.raises(VaultExistsError):
            vault_manager.init_vault("test")

    @pytest.mark.parametrize("name", ["", " spaces", "a/b", "../evil", "a" * 65])
    def test_invalid_name_raises(self, vault_manager: VaultManager, name: str) -> None:
        with pytest.raises(InvalidVaultNameError):
            vault_manager.init_vault(name)

    @pytest.mark.parametrize("name", ["my-vault", "vault_2", "A123"])
    def test_valid_names_accepted(self, vault_manager: VaultManager, name: str) -> None:
        root = vault_manager.init_vault(name)
        assert root.is_dir()


class TestInitDemoVault:
    """Tests for seeding a new vault from the demo template."""

    @staticmethod
    def _make_template(tmp_path: Path) -> Path:
        """Build a tiny synthetic demo template so tests stay hermetic."""
        src = tmp_path / "demo-template"
        (src / "threads" / "topics").mkdir(parents=True)
        (src / "threads" / ".archive").mkdir(parents=True)
        (src / "threads" / "topics" / "graphs.md").write_text(
            "---\nid: thr_demo01\ntitle: Graphs\ntype: topic\n---\n\nBody.\n"
        )
        (src / "threads" / ".archive" / "old.md").write_text("archived note")
        return src

    def test_seeds_threads_notes_over_full_scaffold(
        self, vault_manager: VaultManager, tmp_path: Path
    ) -> None:
        src = self._make_template(tmp_path)
        root = vault_manager.init_demo_vault("demo", source=src)

        # Full scaffold is present (agents, rules) — not just the demo content.
        assert (root / "agents" / "weaver" / "config.yaml").is_file()
        assert (root / "rules" / "prime.md").is_file()
        # The demo note was seeded into its folder.
        assert (root / "threads" / "topics" / "graphs.md").is_file()
        # The new vault is active (first vault).
        assert vault_manager.get_active_vault() == "demo"

    def test_does_not_resurrect_archived_demo_notes(
        self, vault_manager: VaultManager, tmp_path: Path
    ) -> None:
        src = self._make_template(tmp_path)
        root = vault_manager.init_demo_vault("demo", source=src)
        assert not (root / "threads" / ".archive" / "old.md").exists()

    def test_missing_template_raises(self, vault_manager: VaultManager, tmp_path: Path) -> None:
        with pytest.raises(VaultPathError):
            vault_manager.init_demo_vault("demo", source=tmp_path / "nope")

    def test_default_template_points_at_bundled_demo_vault(
        self, vault_manager: VaultManager
    ) -> None:
        assert vault_manager._settings.demo_vault_dir.name == "demo-vault"


class TestListVaults:
    """Tests for vault listing."""

    def test_empty(self, vault_manager: VaultManager) -> None:
        assert vault_manager.list_vaults() == []

    def test_multiple(self, vault_manager: VaultManager) -> None:
        vault_manager.init_vault("alpha")
        vault_manager.init_vault("beta")
        vault_manager.init_vault("gamma")
        assert vault_manager.list_vaults() == ["alpha", "beta", "gamma"]


class TestActiveVault:
    """Tests for active vault management."""

    def test_get_set_roundtrip(self, vault_manager: VaultManager) -> None:
        vault_manager.init_vault("first")
        vault_manager.init_vault("second")
        vault_manager.set_active_vault("second")
        assert vault_manager.get_active_vault() == "second"

    def test_first_vault_becomes_active(self, vault_manager: VaultManager) -> None:
        vault_manager.init_vault("first")
        assert vault_manager.get_active_vault() == "first"

    def test_set_nonexistent_raises(self, vault_manager: VaultManager) -> None:
        with pytest.raises(VaultNotFoundError):
            vault_manager.set_active_vault("nope")
