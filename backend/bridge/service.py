"""Calendar Bridge orchestration into the shared capture ingress."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, TypedDict

from bridge.calendar import events_for_date
from core.capture_ingress import ingest_capture
from core.config import GlobalConfig

if TYPE_CHECKING:
    from core.vault import VaultManager


class CalendarSyncConflictError(RuntimeError):
    """Raised when the active vault changes during a calendar synchronization."""


class CalendarSyncResult(TypedDict):
    date: str
    event_count: int
    created: int
    deduplicated: int
    capture_ids: list[str]


async def sync_calendar_date(
    target_date: date,
    *,
    vm: VaultManager | None = None,
) -> CalendarSyncResult:
    """Create one idempotent Inbox capture per occurrence on ``target_date``."""
    if vm is None:
        from core.vault import get_vault_manager

        vm = get_vault_manager()
    vault_root = vm.active_vault_dir().resolve()
    if not vault_root.exists() or not (vault_root / "vault.yaml").exists():
        raise CalendarSyncConflictError("No active vault is available for calendar sync")
    config = GlobalConfig.load(vm.config_path())
    feed_url = config.calendar.feed_url
    if not feed_url:
        from bridge.calendar import CalendarFeedError

        raise CalendarFeedError("Connect a calendar feed first")
    events = await events_for_date(
        feed_url,
        target_date,
        config.standup_schedule.timezone,
        calendar_name=config.calendar.name,
    )
    created = 0
    deduplicated = 0
    capture_ids: list[str] = []
    for event in events:
        if vm.active_vault_dir().resolve() != vault_root:
            raise CalendarSyncConflictError("The active vault changed; retry calendar sync")
        result = await ingest_capture(
            vault_root,
            title=event.title,
            body=event.to_capture_markdown(),
            source="bridge:calendar",
            tags=("calendar", "meeting"),
            external_id=event.external_id,
            provenance={
                "calendar": event.calendar_name,
                "event_uid": event.uid,
                "start": event.start.isoformat(),
                "end": event.end.isoformat(),
                "all_day": event.all_day,
                "location": event.location,
                "event_url": event.url,
            },
        )
        created += int(result.created)
        deduplicated += int(result.deduplicated)
        capture_ids.append(result.capture.id)
    if vm.active_vault_dir().resolve() != vault_root:
        raise CalendarSyncConflictError("The active vault changed; retry calendar sync")
    return {
        "date": target_date.isoformat(),
        "event_count": len(events),
        "created": created,
        "deduplicated": deduplicated,
        "capture_ids": capture_ids,
    }
