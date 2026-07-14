"""In-process pub/sub hub for pushing typed refresh signals to SSE clients.

The file watcher detects vault changes off the event loop (a watchdog thread
plus a debounce timer thread); the SSE endpoint serves subscribers on the loop.
This hub bridges the two: publishers on a worker thread call
:meth:`EventHub.publish_threadsafe`, which hops onto the loop via
``call_soon_threadsafe`` before fanning out to each subscriber's queue. All
subscriber-set mutation and queue writes therefore happen on the loop thread, so
no lock is needed.

Events are intentionally payload-free signals ("something changed, re-fetch").
Their names identify the smallest resource domain a client must refresh. A
``vault-changed`` signal is reserved for broad filesystem/graph changes; job
row transitions use ``capture-job-changed`` and no longer force a full vault
reload.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Final, Literal, TypeAlias

logger = logging.getLogger(__name__)

# Bounded so a stalled subscriber can't grow memory without limit. A dropped
# event is harmless: the client re-fetches the whole resource on the next event
# (or the periodic reconcile), so it converges regardless.
_QUEUE_MAXSIZE = 64

VAULT_CHANGED: Final = "vault-changed"
CAPTURE_CHANGED: Final = "capture-changed"
CAPTURE_JOB_CHANGED: Final = "capture-job-changed"
NOTE_CHANGED: Final = "note-changed"
STANDUP_SCHEDULE_CHANGED: Final = "standup-schedule-changed"

CoreEvent: TypeAlias = Literal[
    "vault-changed",
    "capture-changed",
    "capture-job-changed",
    "note-changed",
    "standup-schedule-changed",
]

__all__ = [
    "CAPTURE_CHANGED",
    "CAPTURE_JOB_CHANGED",
    "NOTE_CHANGED",
    "STANDUP_SCHEDULE_CHANGED",
    "VAULT_CHANGED",
    "CoreEvent",
    "EventHub",
    "get_event_hub",
    "publish_capture_change",
    "publish_capture_job_change",
    "publish_note_change",
    "publish_vault_change",
]


class EventHub:
    """Fan-out of payload-free refresh signals to connected subscribers."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[CoreEvent]] = set()

    def subscribe(self) -> asyncio.Queue[CoreEvent]:
        """Register a new subscriber queue (call on the event loop)."""
        queue: asyncio.Queue[CoreEvent] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[CoreEvent]) -> None:
        """Drop a subscriber queue (call on the event loop)."""
        self._subscribers.discard(queue)

    def subscriber_count(self) -> int:
        """Number of currently-connected subscribers."""
        return len(self._subscribers)

    def publish(self, event: CoreEvent) -> None:
        """Fan ``event`` out to every subscriber (call on the event loop)."""
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Slow consumer — drop; it re-syncs on the next delivered event.
                logger.debug("Dropping event for full subscriber queue")

    def publish_threadsafe(self, loop: asyncio.AbstractEventLoop | None, event: CoreEvent) -> None:
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


def publish_vault_change() -> None:
    """Signal a broad filesystem/graph change requiring a full refresh."""
    _hub.publish(VAULT_CHANGED)


def publish_capture_change() -> None:
    """Signal that Inbox capture files or metadata changed."""
    _hub.publish(CAPTURE_CHANGED)


def publish_capture_job_change() -> None:
    """Signal that durable capture-job state changed."""
    _hub.publish(CAPTURE_JOB_CHANGED)


def publish_note_change() -> None:
    """Signal that one or more filed notes changed."""
    _hub.publish(NOTE_CHANGED)
