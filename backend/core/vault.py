from pathlib import Path

from core.config import LoomConfig

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
