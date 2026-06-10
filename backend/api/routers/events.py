"""Server-Sent Events stream for live vault-change notifications.

The frontend opens one ``GET /api/events/stream`` and re-fetches notes/graph
when a ``vault-changed`` event arrives — replacing the previous "load once per
vault, never refresh" behavior where an agent's edits never reached an open UI
without a manual reload.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from core.events import get_event_hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])

# How long to block on the queue before emitting a heartbeat comment. Keeps
# proxies/browsers from treating an idle connection as dead.
_HEARTBEAT_SECONDS = 15.0


@router.get("/stream")
async def event_stream(request: Request) -> StreamingResponse:
    """Stream vault-change events to the client as Server-Sent Events."""
    hub = get_event_hub()
    queue = hub.subscribe()

    async def generator() -> AsyncIterator[str]:
        try:
            # Tell the client the channel is open before any real event.
            yield "event: hello\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except TimeoutError:
                    # Idle — keep the connection warm with an SSE comment.
                    yield ": keepalive\n\n"
                    continue
                yield f"event: {event}\ndata: {{}}\n\n"
        finally:
            hub.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering of the stream
        },
    )
