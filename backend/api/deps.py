"""FastAPI dependencies — config loader + writer.

Config is loaded lazily and cached in a module-level holder; ``write_config``
re-loads from disk after each save to keep the in-memory copy consistent.
A threading lock protects writes that come in concurrently.
"""

from __future__ import annotations

import threading

from core.config import LoomConfig
from core.config_io import load_config, save_config

_config: LoomConfig | None = None
_lock = threading.Lock()


def _ensure_loaded() -> LoomConfig:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def get_config() -> LoomConfig:
    """FastAPI dependency: return the in-memory config snapshot."""
    return _ensure_loaded()


def reload_config() -> LoomConfig:
    """Force a re-read from disk. Used after external mutations."""
    global _config
    _config = load_config()
    return _config


def write_config(updated: LoomConfig) -> LoomConfig:
    """Persist ``updated`` to disk under the write lock and refresh memory."""
    global _config
    with _lock:
        save_config(updated)
        _config = updated
    return _config
