"""Bridge integration API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from bridge.registry import get_bridge_registry

router = APIRouter(prefix="/api", tags=["bridges"])


# -- Response models -----------------------------------------------------------


class BridgeStatusResponse(BaseModel):
    """Status of a single bridge integration."""

    name: str
    connected: bool
    details: dict[str, Any]


class BridgeListResponse(BaseModel):
    """List of all available bridges with their statuses."""

    bridges: list[BridgeStatusResponse]


# -- Endpoints -----------------------------------------------------------------


@router.get("/bridges")
def list_bridges() -> BridgeListResponse:
    """List available bridges and their connection status."""
    registry = get_bridge_registry()
    statuses: list[BridgeStatusResponse] = []

    for name in registry.list_bridges():
        raw_status = registry.get_status(name)
        connected = raw_status.pop("connected", False)
        raw_status.pop("name", None)
        statuses.append(
            BridgeStatusResponse(
                name=name,
                connected=connected,
                details=raw_status,
            )
        )

    return BridgeListResponse(bridges=statuses)
