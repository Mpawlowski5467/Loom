"""Bridge registry — discovers, instantiates, and caches bridge instances.

Follows the same singleton-registry pattern used by
``core.providers.ProviderRegistry``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from bridge.calendar import CalendarBridge, CalendarBridgeConfig
from bridge.email import EmailBridge, EmailBridgeConfig
from bridge.github import GitHubBridge, GitHubBridgeConfig

if TYPE_CHECKING:
    from pydantic import BaseModel

    from bridge.base import BaseBridge

# ---------------------------------------------------------------------------
# Class / config mappings
# ---------------------------------------------------------------------------

_CONFIG_MODEL_MAP: dict[str, type[BaseModel]] = {
    "github": GitHubBridgeConfig,
    "email": EmailBridgeConfig,
    "calendar": CalendarBridgeConfig,
}

_BRIDGE_CLASS_MAP: dict[str, type[BaseBridge]] = {
    "github": GitHubBridge,
    "email": EmailBridge,
    "calendar": CalendarBridge,
}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class BridgeRegistry:
    """Manages bridge instances.

    Bridges are lazily instantiated the first time they are requested via
    ``get()``.  Raw config dicts (typically loaded from ``config.yaml``)
    are validated through the matching Pydantic config model.

    Args:
        raw_configs: Mapping of bridge name to raw config dict.
            Missing entries are fine — the bridge will be created with
            default (empty) config.
    """

    def __init__(self, raw_configs: dict[str, dict[str, Any]] | None = None) -> None:
        self._raw_configs: dict[str, dict[str, Any]] = raw_configs or {}
        self._bridges: dict[str, BaseBridge] = {}

    def _resolve_config(self, name: str) -> BaseModel:
        """Parse raw config into a typed Pydantic model."""
        config_cls = _CONFIG_MODEL_MAP.get(name)
        if config_cls is None:
            raise ValueError(f"Unknown bridge '{name}'. Supported: {', '.join(_CONFIG_MODEL_MAP)}.")
        raw = self._raw_configs.get(name, {})
        return config_cls.model_validate(raw)

    def get(self, name: str) -> BaseBridge:
        """Return a cached bridge instance by name.

        Args:
            name: Bridge identifier (e.g. ``"github"``).

        Returns:
            The bridge instance.

        Raises:
            ValueError: If *name* is not a known bridge type.
        """
        if name not in self._bridges:
            cfg = self._resolve_config(name)
            bridge_cls = _BRIDGE_CLASS_MAP[name]
            self._bridges[name] = bridge_cls(cfg)  # type: ignore[arg-type]
        return self._bridges[name]

    def list_bridges(self) -> list[str]:
        """Return the names of all supported bridge types."""
        return sorted(_BRIDGE_CLASS_MAP.keys())

    def get_status(self, name: str) -> dict[str, Any]:
        """Return connection status for a bridge.

        Instantiates the bridge (with default config) if it has not been
        created yet, so status is always available.

        Args:
            name: Bridge identifier.

        Returns:
            Status dict from the bridge's ``status()`` method.
        """
        bridge = self.get(name)
        return bridge.status()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry: BridgeRegistry | None = None


def get_bridge_registry() -> BridgeRegistry:
    """Return (and lazily create) the global BridgeRegistry."""
    global _registry  # noqa: PLW0603
    if _registry is None:
        _registry = BridgeRegistry()
    return _registry


def reset_bridge_registry() -> None:
    """Force re-creation of the registry (useful after config changes)."""
    global _registry  # noqa: PLW0603
    _registry = None
