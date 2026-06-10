"""Tests for the in-process vault-change event hub."""

import asyncio

import pytest

from core.events import VAULT_CHANGED, EventHub, get_event_hub


@pytest.mark.asyncio
async def test_publish_fans_out_to_all_subscribers() -> None:
    hub = EventHub()
    q1 = hub.subscribe()
    q2 = hub.subscribe()

    hub.publish(VAULT_CHANGED)

    assert await asyncio.wait_for(q1.get(), 1) == VAULT_CHANGED
    assert await asyncio.wait_for(q2.get(), 1) == VAULT_CHANGED
    assert hub.subscriber_count() == 2


@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery() -> None:
    hub = EventHub()
    q = hub.subscribe()
    hub.unsubscribe(q)

    hub.publish(VAULT_CHANGED)

    assert q.empty()
    assert hub.subscriber_count() == 0


@pytest.mark.asyncio
async def test_publish_threadsafe_is_noop_without_a_loop() -> None:
    hub = EventHub()
    q = hub.subscribe()

    # A watcher firing before the server loop is ready must not raise.
    hub.publish_threadsafe(None, VAULT_CHANGED)

    assert q.empty()


@pytest.mark.asyncio
async def test_publish_threadsafe_schedules_on_the_loop() -> None:
    hub = EventHub()
    q = hub.subscribe()
    loop = asyncio.get_running_loop()

    hub.publish_threadsafe(loop, VAULT_CHANGED)

    assert await asyncio.wait_for(q.get(), 1) == VAULT_CHANGED


@pytest.mark.asyncio
async def test_full_subscriber_queue_drops_without_raising() -> None:
    hub = EventHub()
    q = hub.subscribe()

    # Publishing far past the bounded queue size must not raise; excess events
    # are dropped (the client re-syncs on the next delivered event).
    for _ in range(500):
        hub.publish(VAULT_CHANGED)

    assert 0 < q.qsize() <= 64


def test_get_event_hub_returns_the_singleton() -> None:
    assert get_event_hub() is get_event_hub()
