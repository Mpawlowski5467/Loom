"""Atomic YAML read/write for the global Loom config.

Crash-safe: write to ``config.yaml.tmp``, fsync, then rename. The file is
chmod'd to ``0600`` on every save so plain-text API keys are at least
unreadable by other users on the machine. A warning header is prepended on
first create so users editing by hand know they're touching a secrets file.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

import yaml

from core.config import LoomConfig
from core.exceptions import ConfigError

WARNING_HEADER = (
    "# Loom config — contains API keys in plain text.\n"
    "# File permissions are set to 0600 on save. Do not commit or share.\n"
    "# Edit via the Settings UI when possible; this file is overwritten atomically.\n"
)

_lock = threading.Lock()


def _default_path() -> Path:
    return Path.home() / ".loom" / "config.yaml"


def load_config(path: Path | None = None) -> LoomConfig:
    """Load config from disk. Returns a fresh ``LoomConfig`` if the file is
    missing — first run is identified by ``onboarding.completed == False``.
    """
    target = path or _default_path()
    if not target.exists():
        config = LoomConfig()
        if path is not None:
            config = LoomConfig(loom_dir=path.parent)
        return config

    try:
        raw = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"Failed to read {target}: {exc}") from exc

    try:
        data = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"Invalid YAML in {target}: {exc}") from exc

    if not isinstance(data, dict):
        raise ConfigError(f"Config at {target} must be a mapping")

    # Force loom_dir to match the file's parent so the config is self-consistent
    # regardless of how the user has moved things around.
    data["loom_dir"] = str(target.parent)
    try:
        return LoomConfig.model_validate(data)
    except Exception as exc:  # pydantic ValidationError, etc.
        raise ConfigError(f"Failed to parse config at {target}: {exc}") from exc


def save_config(config: LoomConfig) -> None:
    """Atomically write the config to disk with ``0600`` permissions."""
    target = config.config_path
    with _lock:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = config.model_dump(mode="json")
            payload.pop("loom_dir", None)  # derived from file location
            body = yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
            text = WARNING_HEADER + body
            tmp = target.with_suffix(target.suffix + ".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(text)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, target)
            os.chmod(target, 0o600)
        except OSError as exc:
            raise ConfigError(f"Failed to write {target}: {exc}") from exc
