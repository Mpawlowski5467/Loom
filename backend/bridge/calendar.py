"""Calendar bridge — stub implementation.

Provides the ``CalendarBridge`` class and its typed configuration model.
All methods currently raise ``NotImplementedError``; wire up a CalDAV
client once the integration is ready.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from bridge.base import BaseBridge, BridgeEvent

if TYPE_CHECKING:
    from datetime import datetime

_NOT_IMPLEMENTED_MSG = (
    "Calendar bridge not yet implemented — configure at bridges.calendar in config.yaml"
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class CalendarBridgeConfig(BaseModel):
    """Configuration for the Calendar (CalDAV) bridge.

    Attributes:
        caldav_url: CalDAV server URL.
        username: CalDAV login username.
        password: CalDAV login password.
        calendar_name: Name of the calendar to sync.
    """

    caldav_url: str = ""
    username: str = ""
    password: str = ""
    calendar_name: str = ""


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------


class CalendarBridge(BaseBridge):
    """Calendar (CalDAV) integration bridge (stub).

    All methods raise ``NotImplementedError`` until the real
    implementation is wired up.
    """

    def __init__(self, config: CalendarBridgeConfig) -> None:
        self._config = config
        self._connected = False

    @property
    def name(self) -> str:
        """Return the canonical bridge name."""
        return "calendar"

    async def connect(self) -> bool:
        """Establish connection to the CalDAV server."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def disconnect(self) -> None:
        """Tear down the CalDAV connection."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def fetch_items(self, since: datetime | None = None) -> list[BridgeEvent]:
        """Fetch calendar events from the configured calendar."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def push_capture(self, title: str, body: str, tags: list[str]) -> str:
        """Push a capture note as a calendar event."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def status(self) -> dict[str, Any]:
        """Return Calendar bridge connection status."""
        return {
            "name": self.name,
            "connected": self._connected,
            "caldav_url": self._config.caldav_url,
            "calendar_name": self._config.calendar_name,
        }
