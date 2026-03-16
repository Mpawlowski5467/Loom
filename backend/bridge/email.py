"""Email bridge — stub implementation.

Provides the ``EmailBridge`` class and its typed configuration model.
All methods currently raise ``NotImplementedError``; wire up an IMAP
client once the integration is ready.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from bridge.base import BaseBridge, BridgeEvent

if TYPE_CHECKING:
    from datetime import datetime

_NOT_IMPLEMENTED_MSG = (
    "Email bridge not yet implemented — configure at bridges.email in config.yaml"
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class EmailBridgeConfig(BaseModel):
    """Configuration for the Email (IMAP) bridge.

    Attributes:
        imap_host: IMAP server hostname.
        imap_port: IMAP server port (default 993 for TLS).
        username: IMAP login username.
        password: IMAP login password.
        folder: Mailbox folder to watch (default ``"INBOX"``).
        poll_interval_minutes: How often to poll for new mail.
    """

    imap_host: str = ""
    imap_port: int = Field(default=993, ge=1, le=65535)
    username: str = ""
    password: str = ""
    folder: str = "INBOX"
    poll_interval_minutes: int = Field(default=10, ge=1)


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------


class EmailBridge(BaseBridge):
    """Email (IMAP) integration bridge (stub).

    All methods raise ``NotImplementedError`` until the real
    implementation is wired up.
    """

    def __init__(self, config: EmailBridgeConfig) -> None:
        self._config = config
        self._connected = False

    @property
    def name(self) -> str:
        """Return the canonical bridge name."""
        return "email"

    async def connect(self) -> bool:
        """Establish connection to the IMAP server."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def disconnect(self) -> None:
        """Tear down the IMAP connection."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def fetch_items(self, since: datetime | None = None) -> list[BridgeEvent]:
        """Fetch new emails from the configured folder."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def push_capture(self, title: str, body: str, tags: list[str]) -> str:
        """Push a capture note as a draft email."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def status(self) -> dict[str, Any]:
        """Return Email bridge connection status."""
        return {
            "name": self.name,
            "connected": self._connected,
            "imap_host": self._config.imap_host,
            "folder": self._config.folder,
            "poll_interval_minutes": self._config.poll_interval_minutes,
        }
