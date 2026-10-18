"""Fixtures for vault-history tests: a real temp vault with git history running."""

from collections.abc import Iterator
from pathlib import Path

import pytest
import yaml

from core.history import VaultHistory, start_history, stop_history
from core.history.git import git_available
from core.vault import VaultManager

requires_git = pytest.mark.skipif(not git_available(), reason="git is not installed")


def note_meta(
    note_id: str, title: str, *, by: str = "agent:weaver", action: str = "created", **extra: object
) -> dict:
    """Frontmatter for a schema-valid note whose newest history entry is ``action`` by ``by``."""
    return {
        "id": note_id,
        "title": title,
        "type": "topic",
        "tags": ["fixture"],
        "created": "2026-01-02T03:04:05+00:00",
        "modified": "2026-01-02T03:04:05+00:00",
        "author": by if by != "user" else "user",
        "status": "active",
        "history": [
            {
                "action": action,
                "by": by,
                "at": "2026-01-02T03:04:05+00:00",
                "reason": f"{action} for a test",
            }
        ],
        **extra,
    }


def set_history_config(root: Path, **values: object) -> None:
    """Merge ``values`` into the vault's ``history:`` block."""
    path = root / "vault.yaml"
    data = yaml.safe_load(path.read_text()) or {}
    data.setdefault("history", {}).update(values)
    path.write_text(yaml.safe_dump(data, sort_keys=False))


@pytest.fixture()
def vault_root(vault_manager: VaultManager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager._settings.vaults_dir / "test"


@pytest.fixture()
def history(vault_root: Path) -> Iterator[VaultHistory]:
    if not git_available():
        pytest.skip("git is not installed")
    set_history_config(vault_root, human_debounce_seconds=1.0)
    recorder = start_history(vault_root)
    assert recorder is not None
    recorder.flush()
    yield recorder
    stop_history()
