"""Bridge integrations — GitHub, Email, Calendar.

Public API re-exports for convenience::

    from bridge import BaseBridge, BridgeEvent, BridgeRegistry
"""

from bridge.base import BaseBridge, BridgeEvent
from bridge.calendar import CalendarBridge, CalendarBridgeConfig
from bridge.email import EmailBridge, EmailBridgeConfig
from bridge.github import GitHubBridge, GitHubBridgeConfig
from bridge.registry import BridgeRegistry, get_bridge_registry, reset_bridge_registry

__all__ = [
    "BaseBridge",
    "BridgeEvent",
    "BridgeRegistry",
    "CalendarBridge",
    "CalendarBridgeConfig",
    "EmailBridge",
    "EmailBridgeConfig",
    "GitHubBridge",
    "GitHubBridgeConfig",
    "get_bridge_registry",
    "reset_bridge_registry",
]
