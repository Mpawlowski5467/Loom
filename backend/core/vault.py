from pathlib import Path

from backend.core.config import settings

CORE_FOLDERS = ["daily", "projects", "topics", "people", "captures", ".archive"]


def vault_path(vault_name: str | None = None) -> Path:
    """Return the root path for a vault."""
    name = vault_name or settings.active_vault
    return settings.vaults_dir / name


def threads_path(vault_name: str | None = None) -> Path:
    """Return the threads directory for a vault."""
    return vault_path(vault_name) / "threads"


def agents_path(vault_name: str | None = None) -> Path:
    """Return the agents directory for a vault."""
    return vault_path(vault_name) / "agents"
