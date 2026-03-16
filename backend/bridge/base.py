"""Base bridge interface and shared event model.

All external integrations (GitHub, Email, Calendar, etc.) implement the
BaseBridge abstract class. Bridge events are normalised into BridgeEvent
instances before being handed to the vault capture pipeline.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Shared event model
# ---------------------------------------------------------------------------


class BridgeEvent(BaseModel):
    """Normalised event produced by any bridge integration.

    Attributes:
        source: Bridge name that produced the event (e.g. ``"github"``).
        event_type: Provider-specific event kind (e.g. ``"issue"``, ``"email"``).
        title: Human-readable summary of the event.
        body: Full content / description.
        timestamp: When the event occurred in the source system.
        metadata: Arbitrary extra fields the bridge wants to preserve.
    """

    source: str
    event_type: str
    title: str
    body: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Abstract base bridge
# ---------------------------------------------------------------------------


class BaseBridge(ABC):
    """Unified interface for external integrations.

    Concrete bridges must implement every abstract method.  Methods that
    cannot be fulfilled yet should raise ``NotImplementedError`` with a
    descriptive message pointing the user to the relevant config key.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the canonical name of this bridge (e.g. ``"github"``)."""

    @abstractmethod
    async def connect(self) -> bool:
        """Establish a connection to the external service.

        Returns:
            ``True`` if the connection was established successfully.
        """

    @abstractmethod
    async def disconnect(self) -> None:
        """Tear down the connection and release resources."""

    @abstractmethod
    async def fetch_items(self, since: datetime | None = None) -> list[BridgeEvent]:
        """Fetch events from the external service.

        Args:
            since: Only return events newer than this timestamp.
                   ``None`` means fetch all available items.

        Returns:
            A list of normalised ``BridgeEvent`` instances.
        """

    @abstractmethod
    async def push_capture(self, title: str, body: str, tags: list[str]) -> str:
        """Push a capture note to the external service.

        Args:
            title: Note title.
            body: Note body (markdown).
            tags: Tags to attach.

        Returns:
            An identifier for the created resource in the external system.
        """

    @abstractmethod
    def status(self) -> dict[str, Any]:
        """Return connection status information.

        Returns:
            A dict with at least ``"connected"`` (bool) and ``"name"`` (str).
        """
