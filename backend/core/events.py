"""In-process pub/sub hub for pushing vault-change events to SSE subscribers.

The file watcher detects vault changes off the event loop (a watchdog thread
plus a debounce timer thread); the SSE endpoint serves subscribers on the loop.
This hub bridges the two: publishers on a worker thread call
:meth:`EventHub.publish_threadsafe`, which hops onto the loop via
``call_soon_threadsafe`` before fanning out to each subscriber's queue. All
subscriber-set mutation and queue writes therefore happen on the loop thread, so
no lock is needed.

Events are intentionally payload-free signals ("something changed, re-fetch").
Subscribers re-pull the affected resource (notes/graph) rather than trusting a
diff in the event, which keeps the protocol trivial and self-healing.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# Bounded so a stalled subscriber can't grow memory without limit. A dropped
# event is harmless: the client re-fetches the whole resource on the next event
# (or the periodic reconcile), so it converges regardless.
_QUEUE_MAXSIZE = 64

VAULT_CHANGED = "vault-changed"


class EventHub:
    """Fan-out of vault-change signals to connected SSE subscribers."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        """Register a new subscriber queue (call on the event loop)."""
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        """Drop a subscriber queue (call on the event loop)."""
        self._subscribers.discard(queue)

    def subscriber_count(self) -> int:
        """Number of currently-connected subscribers."""
        return len(self._subscribers)

    def publish(self, event: str) -> None:
        """Fan ``event`` out to every subscriber (call on the event loop)."""
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Slow consumer — drop; it re-syncs on the next delivered event.
                logger.debug("Dropping event for full subscriber queue")

    def publish_threadsafe(self, loop: asyncio.AbstractEventLoop | None, event: str) -> None:
        """Publish from a non-loop thread (e.g. the file watcher).

        No-op when no usable loop is available, so a watcher running before the
        server's loop is ready never raises.
        """
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self.publish, event)


_hub = EventHub()


def get_event_hub() -> EventHub:
    """Return the process-wide event hub."""
    return _hub
