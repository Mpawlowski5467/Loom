"""Shared coordination boundary for changing the process-wide active vault."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from core.capture_jobs import (
    CaptureJobsBusyError,
    CaptureJobService,
    get_capture_job_service,
)
from core.standup_scheduler import StandupScheduleBusyError, get_standup_scheduler

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class VaultHandoffBusyError(RuntimeError):
    """Raised when active-vault work makes a handoff unsafe."""


logger = logging.getLogger(__name__)

# Serialize the complete administrative transaction, not just service pause.
# A single FastAPI process has one event loop for these mutations; keeping the
# lock module-global also coordinates all routers that can move/rebind vaults.
_HANDOFF_LOCK = asyncio.Lock()


@asynccontextmanager
async def active_vault_handoff() -> AsyncIterator[None]:
    """Serialize a handoff that changes or mutates the active vault."""
    async with administrative_vault_handoff(active=True):
        yield


@asynccontextmanager
async def administrative_vault_handoff(*, active: bool) -> AsyncIterator[None]:
    """Serialize a vault mutation, pausing active services only when needed.

    The scheduler is paused first so it cannot begin a Standup while the
    capture worker is draining. If either service is already executing active
    vault work, the handoff is refused before callers mutate config or paths.
    Scheduler resume lives in this context's teardown so success, rollback,
    cancellation, and unexpected failures cannot leave scheduled runs paused.
    """
    async with _HANDOFF_LOCK:
        if not active:
            yield
            return

        scheduler = get_standup_scheduler()
        try:
            await scheduler.prepare_vault_switch()
        except StandupScheduleBusyError as exc:
            # The service currently clears its own pause before this exception;
            # resume again defensively so that remains true if its internals change.
            scheduler.resume()
            raise VaultHandoffBusyError(str(exc)) from exc
        except BaseException:
            scheduler.resume()
            raise

        capture_service: CaptureJobService | None = None
        capture_prepared = False
        body_completed = False
        try:
            capture_service = get_capture_job_service()
            try:
                await capture_service.prepare_vault_switch()
                capture_prepared = True
            except CaptureJobsBusyError as exc:
                raise VaultHandoffBusyError(str(exc)) from exc
            yield
            body_completed = True
        finally:
            try:
                if capture_service is not None and capture_prepared and not body_completed:
                    await _abort_capture_handoff(capture_service)
            finally:
                scheduler.resume()


async def _abort_capture_handoff(service: CaptureJobService) -> None:
    """Best-effort rebind after a caller exits before completing activation."""
    if not service.enabled:
        return

    try:
        # Resolve state at teardown rather than remembering the old root:
        # callers may already have switched successfully before a later step
        # raised, or may have rolled config back. In either case the persisted
        # active vault is the authority. A matching worker proves caller
        # activation already succeeded, so leave it untouched.
        from core.config import GlobalConfig
        from core.vault import get_vault_manager

        vm = get_vault_manager()
        vault_root = vm.active_vault_dir().resolve()
        worker = service.worker
        if worker is not None and worker.vault_root == vault_root:
            return
        if not vault_root.is_dir() or not (vault_root / "vault.yaml").is_file():
            logger.error(
                "Cannot reactivate capture jobs after aborted vault handoff: %s is not a vault",
                vault_root,
            )
            return
        config = GlobalConfig.load(vm.config_path())
        await service.activate(vault_root, config.capture_processing)
    except Exception:
        # Never hide the handoff's original failure. The service stays fail
        # closed, and the log preserves the repair error for diagnostics.
        logger.exception("Failed to reactivate capture jobs after aborted vault handoff")
