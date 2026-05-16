"""Unit tests for VaultManager."""

import json

import pytest

from core.exceptions import (
    InvalidVaultNameError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.vault import CORE_FOLDERS, VaultManager


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
