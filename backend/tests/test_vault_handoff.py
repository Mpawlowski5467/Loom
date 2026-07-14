"""Coordination tests for active-vault scheduler and capture-worker handoffs."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

import core.vault_handoff as handoff_mod
from core.capture_jobs import CaptureJobsBusyError, CaptureJobService
from core.config import GlobalConfig, LoomSettings
from core.standup_scheduler import StandupSchedulerService
from core.vault import VaultManager
from core.vault_handoff import (
    VaultHandoffBusyError,
    active_vault_handoff,
    administrative_vault_handoff,
)


class _CaptureService:
    def __init__(self, error: Exception | None = None) -> None:
        self.enabled = False
        self.worker = None
        self.prepare_vault_switch = AsyncMock(side_effect=error)


@pytest.fixture(autouse=True)
def _fresh_handoff_lock(monkeypatch) -> None:
    """Keep the module lock local to each pytest event loop."""
    monkeypatch.setattr(handoff_mod, "_HANDOFF_LOCK", asyncio.Lock())


@pytest.mark.asyncio
async def test_handoff_resumes_scheduler_after_success(monkeypatch) -> None:
    scheduler = StandupSchedulerService()
    capture = _CaptureService()
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(handoff_mod, "get_capture_job_service", lambda: capture)

    async with active_vault_handoff():
        assert scheduler.paused is True

    assert scheduler.paused is False
    capture.prepare_vault_switch.assert_awaited_once()


@pytest.mark.asyncio
async def test_handoff_resumes_scheduler_after_body_failure(monkeypatch) -> None:
    scheduler = StandupSchedulerService()
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(
        handoff_mod,
        "get_capture_job_service",
        lambda: _CaptureService(),
    )

    with pytest.raises(RuntimeError, match="reload failed"):
        async with active_vault_handoff():
            assert scheduler.paused is True
            raise RuntimeError("reload failed")

    assert scheduler.paused is False


@pytest.mark.asyncio
async def test_capture_refusal_also_resumes_scheduler(monkeypatch) -> None:
    scheduler = StandupSchedulerService()
    capture = _CaptureService(CaptureJobsBusyError("capture running"))
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(handoff_mod, "get_capture_job_service", lambda: capture)

    with pytest.raises(VaultHandoffBusyError, match="capture running"):
        async with active_vault_handoff():
            pytest.fail("busy handoff must not enter its mutation body")

    assert scheduler.paused is False


@pytest.mark.asyncio
async def test_failed_body_reactivates_capture_service_for_still_active_vault(
    tmp_path,
    monkeypatch,
) -> None:
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    root = manager.init_vault("test")
    manager.set_active_vault("test")
    service = CaptureJobService()
    service.enable(root)
    scheduler = StandupSchedulerService()
    monkeypatch.setattr("core.vault.get_vault_manager", lambda: manager)
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(handoff_mod, "get_capture_job_service", lambda: service)

    try:
        with pytest.raises(RuntimeError, match="mutation failed"):
            async with active_vault_handoff():
                with pytest.raises(CaptureJobsBusyError, match="switching"):
                    async with service.operation_guard(root):
                        pass
                raise RuntimeError("mutation failed")

        # The aborted context reactivated the configured vault, so later
        # ingress/store operations are not permanently rejected as switching.
        async with service.operation_guard(root):
            pass
        assert service.worker is not None
        assert service.worker.vault_root == root.resolve()
        assert scheduler.paused is False
    finally:
        await service.aclose()


@pytest.mark.asyncio
async def test_failure_after_caller_activation_keeps_that_worker(
    tmp_path,
    monkeypatch,
) -> None:
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    root = manager.init_vault("test")
    manager.set_active_vault("test")
    policy = GlobalConfig.load(manager.config_path()).capture_processing
    service = CaptureJobService()
    service.enable(root)
    scheduler = StandupSchedulerService()
    monkeypatch.setattr("core.vault.get_vault_manager", lambda: manager)
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(handoff_mod, "get_capture_job_service", lambda: service)

    activated_worker = None
    try:
        with pytest.raises(RuntimeError, match="late failure"):
            async with active_vault_handoff():
                activated_worker = await service.activate(root, policy)
                raise RuntimeError("late failure")

        assert service.worker is activated_worker
        async with service.operation_guard(root):
            pass
    finally:
        await service.aclose()


@pytest.mark.asyncio
async def test_administrative_handoff_serializes_entire_mutation_body() -> None:
    first_entered = asyncio.Event()
    release_first = asyncio.Event()
    second_entered = asyncio.Event()

    async def first() -> None:
        async with administrative_vault_handoff(active=False):
            first_entered.set()
            await release_first.wait()

    async def second() -> None:
        await first_entered.wait()
        async with administrative_vault_handoff(active=False):
            second_entered.set()

    first_task = asyncio.create_task(first())
    await first_entered.wait()
    second_task = asyncio.create_task(second())
    await asyncio.sleep(0)
    assert second_entered.is_set() is False

    release_first.set()
    await asyncio.gather(first_task, second_task)
    assert second_entered.is_set() is True
