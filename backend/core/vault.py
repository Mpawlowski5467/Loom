"""Vault filesystem helpers.

All vault file operations must route through this module. Per the style guide,
routes and agents never touch the filesystem directly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from core.config import LoomConfig
from core.exceptions import VaultExistsError
from core.vault_scaffold import is_scaffolded, scaffold_vault, vault_root_for

CORE_FOLDERS = ["daily", "projects", "topics", "people", "captures"]


def vault_root(config: LoomConfig) -> Path:
    """Return the root path for the active vault."""
    return config.vault_path


def threads_path(config: LoomConfig) -> Path:
    """Return the threads directory for the active vault."""
    return config.vault_path / "threads"


def agents_path(config: LoomConfig) -> Path:
    """Return the agents directory for the active vault."""
    return config.vault_path / "agents"


def vault_exists(loom_dir: Path, name: str) -> tuple[bool, bool]:
    """Return ``(exists_dir, scaffolded)`` for a vault named ``name``."""
    target = vault_root_for(loom_dir, name)
    if not target.exists():
        return (False, False)
    return (True, is_scaffolded(target))


def create_vault(loom_dir: Path, name: str, *, overwrite: bool = False) -> Path:
    """Create (or scaffold over an existing) vault and return its root path.

    If ``overwrite`` is False and a *scaffolded* vault already exists at the
    target path, ``VaultExistsError`` is raised. An unscaffolded directory
    (e.g. a manually-created empty folder) is always safe to scaffold into.

    When ``overwrite`` is True, the existing vault is archived to a sibling
    ``<name>.archived-<timestamp>`` directory before fresh scaffolding runs.
    """
    target = vault_root_for(loom_dir, name)
    if target.exists() and is_scaffolded(target):
        if not overwrite:
            raise VaultExistsError(name, scaffolded=True)
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        archived = target.parent / f"{name}.archived-{stamp}"
        target.rename(archived)
    scaffold_vault(target, name)
    return target
