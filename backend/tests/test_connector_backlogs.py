"""Backlogs larger than one poll: Gmail (history + queue) and Outlook (paging).

Gmail used to re-list only the newest 100 inbox messages each poll, so any
backlog beyond that was never imported. Outlook read at most 20 pages of
events. These tests pin that nothing is dropped any more.
"""

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from bridge import gmail_service
from bridge.gmail import GmailError, GmailHistoryExpiredError, GmailNotFoundError
from bridge.gmail_service import sync_gmail
from bridge.outlook_cal import OutlookCalendarClient
from tests.test_google_connector import (
    _FakeGmailClient,
    _gmail_client,
    _google_vault,
    _item,
    _tokens,
)
from tests.test_outlook_calendar_bridge import _http as _outlook_http
from tests.test_outlook_calendar_bridge import _tokens as _outlook_tokens


def _mailbox(count: int) -> tuple[list[str], dict[str, object]]:
    """``count`` messages, listed newest first like Gmail does."""
    ids = [f"m{n:03d}" for n in reversed(range(count))]
    return ids, {message_id: _item(message_id, f"Mail {message_id}") for message_id in ids}


def _cursor(tmp_path) -> dict:
    return json.loads((tmp_path / "gmail-sync.json").read_text(encoding="utf-8"))["mailbox"]


class TestGmailBacklog:
    @pytest.mark.asyncio
    async def test_backlog_drains_oldest_first_across_polls(self, tmp_path, monkeypatch) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        monkeypatch.setattr(gmail_service, "_MAX_MESSAGES_PER_POLL", 10)
        ids, items = _mailbox(25)
        client = _FakeGmailClient(ids, items)

        polls = [await sync_gmail(vm=manager, client=client) for _ in range(3)]  # type: ignore[arg-type]

        assert [p["created"] for p in polls] == [10, 10, 5]
        assert [p["pending"] for p in polls] == [15, 5, 0]
        assert client.fetched[:3] == ["m000", "m001", "m002"]  # oldest first
        captures = manager.active_vault_dir() / "threads" / "captures"
        assert len(list(captures.glob("*.md"))) == 25

    @pytest.mark.asyncio
    async def test_new_mail_comes_from_history_not_a_relist(self, tmp_path, monkeypatch) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        ids, items = _mailbox(2)
        items["m-new"] = _item("m-new", "Arrived later")
        client = _FakeGmailClient(ids, items)
        await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]
        client.fetched.clear()
        client.history_batches.append(["m-new"])

        result = await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]

        assert client.fetched == ["m-new"]
        assert result["created"] == 1
        assert client.queries == ["in:inbox newer_than:7d"]  # listed once, at first sync

    @pytest.mark.asyncio
    async def test_expired_history_catches_up_from_the_last_sync(
        self, tmp_path, monkeypatch
    ) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        twenty_days_ago = (datetime.now(UTC) - timedelta(days=20)).isoformat()
        (tmp_path / "gmail-sync.json").write_text(
            json.dumps(
                {"mailbox": {"history_id": "h1", "pending": [], "synced_at": twenty_days_ago}}
            )
        )
        ids, items = _mailbox(3)
        client = _FakeGmailClient(ids, items)
        client.history_expired = True

        result = await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]

        # Longer than the 7-day look-back, so nothing received while away is
        # skipped: 20 days and a moment round up to 21, plus a day of margin.
        assert client.queries == ["in:inbox newer_than:22d"]
        assert result["created"] == 3

    @pytest.mark.asyncio
    async def test_deleted_message_is_dropped_not_retried(self, tmp_path, monkeypatch) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        client = _FakeGmailClient(
            ["kept", "gone"],
            {"gone": GmailNotFoundError("Message not found"), "kept": _item("kept", "Hi")},
        )

        result = await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]

        assert (result["created"], result["errors"], result["pending"]) == (1, 0, 0)

    @pytest.mark.asyncio
    async def test_outage_stops_the_poll_and_keeps_every_message(
        self, tmp_path, monkeypatch
    ) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        ids = [f"m{n}" for n in range(5)]
        client = _FakeGmailClient(ids, {i: GmailError("Gmail API error 503") for i in ids})

        result = await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]

        assert result["errors"] == 3  # stopped after three failures in a row
        assert result["pending"] == 5
        assert sorted(_cursor(tmp_path)["pending"]) == sorted(ids)

    @pytest.mark.asyncio
    async def test_failed_ingest_keeps_the_message_queued(self, tmp_path, monkeypatch) -> None:
        manager = _google_vault(tmp_path, monkeypatch)
        ids, items = _mailbox(3)
        client = _FakeGmailClient(ids, items)
        real_ingest = gmail_service.ingest_capture

        async def fail_on_second(*args, **kwargs):
            if kwargs["external_id"] == "gmail:m001":
                raise OSError("disk busy")
            return await real_ingest(*args, **kwargs)

        monkeypatch.setattr(gmail_service, "ingest_capture", fail_on_second)
        with pytest.raises(OSError):
            await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]

        assert _cursor(tmp_path)["pending"] == ["m001", "m002"]
        monkeypatch.setattr(gmail_service, "ingest_capture", real_ingest)
        retry = await sync_gmail(vm=manager, client=client)  # type: ignore[arg-type]
        assert (retry["created"], retry["pending"]) == (2, 0)


class TestGmailHistoryClient:
    @pytest.mark.asyncio
    async def test_history_lists_new_inbox_mail_across_pages(self) -> None:
        pages = {
            "": {
                "history": [
                    {
                        "id": "11",
                        "messagesAdded": [{"message": {"id": "a", "labelIds": ["INBOX"]}}],
                    },
                    {"id": "12", "messagesAdded": [{"message": {"id": "s", "labelIds": ["SENT"]}}]},
                ],
                "nextPageToken": "p2",
            },
            "p2": {
                "history": [
                    {
                        "id": "13",
                        "messagesAdded": [{"message": {"id": "b", "labelIds": ["INBOX"]}}],
                    },
                    {
                        "id": "14",
                        "messagesAdded": [{"message": {"id": "a", "labelIds": ["INBOX"]}}],
                    },
                ],
                "historyId": "20",
            },
        }

        def handler(request: httpx.Request) -> httpx.Response:
            params = parse_qs(urlparse(str(request.url)).query)
            assert params["startHistoryId"] == ["10"]
            assert params["labelId"] == ["INBOX"]
            return httpx.Response(200, json=pages[params.get("pageToken", [""])[0]])

        ids, position = await _gmail_client(handler, tokens=_tokens()).list_history("10")

        assert ids == ["a", "b"]  # sent mail skipped, repeats collapsed
        assert position == "20"

    @pytest.mark.asyncio
    async def test_expired_history_is_a_distinct_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": {"code": 404}})

        with pytest.raises(GmailHistoryExpiredError):
            await _gmail_client(handler, tokens=_tokens()).list_history("10")


class TestOutlookPaging:
    @pytest.mark.asyncio
    async def test_reads_every_page_of_a_large_calendar(self) -> None:
        # 30 pages of 50 events: past the old 20-page (1,000 event) cut-off.
        start = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)

        def page(n: int) -> dict:
            events = [
                {
                    "id": f"evt-{n}-{i}",
                    "subject": f"Event {n}-{i}",
                    "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
                    "end": {
                        "dateTime": (start + timedelta(hours=1)).isoformat(),
                        "timeZone": "UTC",
                    },
                }
                for i in range(50)
            ]
            data: dict = {"value": events}
            if n < 29:
                data["@odata.nextLink"] = (
                    f"https://graph.microsoft.com/v1.0/me/calendarView?page={n + 1}"
                )
            return data

        def handler(request: httpx.Request) -> httpx.Response:
            n = int(request.url.params.get("page", "0"))
            return httpx.Response(200, json=page(n))

        client = OutlookCalendarClient(
            client_id="client-id",
            client_secret="client-secret",
            tokens=_outlook_tokens(),
            http=_outlook_http(handler),
        )
        events = await client.list_events(
            "primary",
            time_min=start - timedelta(days=7),
            time_max=start + timedelta(days=30),
        )

        assert len(events) == 1500
