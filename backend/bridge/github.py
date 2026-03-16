"""GitHub bridge — stub implementation.

Provides the ``GitHubBridge`` class and its typed configuration model.
All methods currently raise ``NotImplementedError``; wire up the real
GitHub API client once the integration is ready.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from bridge.base import BaseBridge, BridgeEvent

if TYPE_CHECKING:
    from datetime import datetime

_NOT_IMPLEMENTED_MSG = (
    "GitHub bridge not yet implemented — configure at bridges.github in config.yaml"
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class GitHubBridgeConfig(BaseModel):
    """Configuration for the GitHub bridge.

    Attributes:
        token: Personal access token (PAT) or fine-grained token.
        repo: Target repository in ``owner/repo`` format.
        poll_interval_minutes: How often to poll for new events.
    """

    token: str = ""
    repo: str = ""
    poll_interval_minutes: int = Field(default=15, ge=1)


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------


class GitHubBridge(BaseBridge):
    """GitHub integration bridge (stub).

    All methods raise ``NotImplementedError`` until the real
    implementation is wired up.
    """

    def __init__(self, config: GitHubBridgeConfig) -> None:
        self._config = config
        self._connected = False

    @property
    def name(self) -> str:
        """Return the canonical bridge name."""
        return "github"

    async def connect(self) -> bool:
        """Establish connection to GitHub API."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def disconnect(self) -> None:
        """Tear down the GitHub connection."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def fetch_items(self, since: datetime | None = None) -> list[BridgeEvent]:
        """Fetch GitHub events (issues, PRs, etc.)."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    async def push_capture(self, title: str, body: str, tags: list[str]) -> str:
        """Push a capture note as a GitHub issue or comment."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def status(self) -> dict[str, Any]:
        """Return GitHub bridge connection status."""
        return {
            "name": self.name,
            "connected": self._connected,
            "repo": self._config.repo,
            "poll_interval_minutes": self._config.poll_interval_minutes,
        }
