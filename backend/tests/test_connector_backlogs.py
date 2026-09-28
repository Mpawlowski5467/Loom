"""Backlogs larger than one poll: Outlook reads every page of a calendar.

Outlook read at most 20 pages of events, so events past the first 1,000 in
the sync window were silently dropped.
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from bridge.outlook_cal import OutlookCalendarClient
from tests.test_outlook_calendar_bridge import _http as _outlook_http
from tests.test_outlook_calendar_bridge import _tokens as _outlook_tokens


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
