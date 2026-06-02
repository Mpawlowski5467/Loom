"""Tests for the chat API routes in api/routers/chat.py."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from agents.chat import ChatHistory
from tests.conftest import _seed_notes


def _init_chat(tmp_path: Path) -> ChatHistory:
    """Create a ChatHistory backed by a temp vault."""
    root = tmp_path / "vault"
    root.mkdir(parents=True, exist_ok=True)
    (root / "agents" / "_council" / "chat").mkdir(parents=True)
    (root / "agents" / "researcher" / "chat").mkdir(parents=True)
    (root / "agents" / "standup" / "chat").mkdir(parents=True)
    return ChatHistory(root)


# ---------------------------------------------------------------------------
# POST /api/chat/send — shuttle agent (researcher)
# ---------------------------------------------------------------------------


class TestSendMessageResearcher:
    def test_send_to_researcher(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """POST /api/chat/send with agent=researcher routes to researcher."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        mock_result = MagicMock()
        mock_result.answer = "Caching stores data for fast retrieval."

        mock_researcher = MagicMock()
        mock_researcher.query = AsyncMock(return_value=mock_result)

        with (
            patch("agents.chat.get_chat_history", return_value=chat),
            patch(
                "agents.shuttle.researcher.get_researcher",
                return_value=mock_researcher,
            ),
        ):
            resp = client.post(
                "/api/chat/send",
                json={"message": "What is caching?", "agent": "researcher"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["user_message"]["role"] == "user"
        assert data["user_message"]["content"] == "What is caching?"
        assert data["assistant_message"]["role"] == "assistant"
        assert data["assistant_message"]["content"] == "Caching stores data for fast retrieval."


# ---------------------------------------------------------------------------
# POST /api/chat/send — council
# ---------------------------------------------------------------------------


class TestSendMessageCouncil:
    def test_send_to_council(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """POST /api/chat/send with agent=_council routes to council."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        mock_provider = AsyncMock()
        mock_provider.chat = AsyncMock(return_value="Council response text.")

        with (
            patch("agents.chat.get_chat_history", return_value=chat),
            patch("core.providers.get_chat_provider", return_value=mock_provider),
        ):
            resp = client.post(
                "/api/chat/send",
                json={"message": "How is my vault?", "agent": "_council"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["user_message"]["role"] == "user"
        assert data["assistant_message"]["role"] == "council"
        assert data["assistant_message"]["content"] == "Council response text."

    def test_council_fans_out_to_all_loom_agents(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """Council should make 5 per-agent calls + 1 aggregator call (6 total).

        Each per-agent contribution should appear in agent_contributions
        and the aggregator's output should drive assistant_message.content.
        """
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        # Return a different response for each call so we can identify them.
        responses = iter(
            [
                "weaver says: create [[new-note]]",
                "spider says: link to [[existing]]",
                "archivist says: archive old stuff",
                "scribe says: today was active",
                "sentinel says: looks good",
                "council voice: synthesised reply",
            ]
        )

        async def fake_chat(messages, system=""):  # noqa: ARG001
            return next(responses)

        mock_provider = AsyncMock()
        mock_provider.chat = fake_chat

        with (
            patch("agents.chat.get_chat_history", return_value=chat),
            patch("core.providers.get_chat_provider", return_value=mock_provider),
        ):
            resp = client.post(
                "/api/chat/send",
                json={"message": "How is my vault?", "agent": "_council"},
            )

        assert resp.status_code == 200
        data = resp.json()

        # Synthesised voice is the *last* (6th) call.
        assert data["assistant_message"]["content"] == "council voice: synthesised reply"

        # Five per-agent contributions, one per Loom agent.
        contributions = data["agent_contributions"]
        assert len(contributions) == 5
        names = [c["agent"] for c in contributions]
        assert set(names) == {"weaver", "spider", "archivist", "scribe", "sentinel"}

        # Contributions match the order of the fan-out (defined by _COUNCIL_PERSONAS).
        by_agent = {c["agent"]: c["content"] for c in contributions}
        assert by_agent["weaver"] == "weaver says: create [[new-note]]"
        assert by_agent["spider"] == "spider says: link to [[existing]]"
        assert by_agent["archivist"] == "archivist says: archive old stuff"
        assert by_agent["scribe"] == "scribe says: today was active"
        assert by_agent["sentinel"] == "sentinel says: looks good"

    def test_council_contribution_error_does_not_break_aggregation(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """If one agent's call errors, the aggregator still runs and gets the rest."""
        from core.exceptions import ProviderError

        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        # Personas are dispatched in dict insertion order:
        # weaver, spider, archivist, scribe, sentinel.
        # Make Spider error; the rest succeed; the aggregator gets the 6th call.
        responses = [
            ("ok", "weaver content"),
            ("err", ProviderError("fake", "spider down")),
            ("ok", "archivist content"),
            ("ok", "scribe content"),
            ("ok", "sentinel content"),
            ("ok", "aggregated reply"),
        ]
        it = iter(responses)

        async def fake_chat(messages, system=""):  # noqa: ARG001
            kind, val = next(it)
            if kind == "err":
                raise val
            return val

        mock_provider = AsyncMock()
        mock_provider.chat = fake_chat

        with (
            patch("agents.chat.get_chat_history", return_value=chat),
            patch("core.providers.get_chat_provider", return_value=mock_provider),
        ):
            resp = client.post(
                "/api/chat/send",
                json={"message": "Status?", "agent": "_council"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["assistant_message"]["content"] == "aggregated reply"
        contributions = {c["agent"]: c for c in data["agent_contributions"]}
        # ProviderError formats as "[provider] message".
        assert "spider down" in contributions["spider"]["error"]
        assert contributions["spider"]["content"] == ""
        assert contributions["weaver"]["content"] == "weaver content"


# ---------------------------------------------------------------------------
# POST /api/chat/send — invalid agent
# ---------------------------------------------------------------------------


class TestSendMessageInvalidAgent:
    def test_invalid_agent_returns_400(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """POST /api/chat/send with unknown agent returns 400."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.post(
                "/api/chat/send",
                json={"message": "Hello", "agent": "nonexistent"},
            )

        assert resp.status_code == 400
        assert "Invalid chat target" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# POST /api/chat/send — chat not initialized
# ---------------------------------------------------------------------------


class TestSendMessageNotInitialized:
    def test_not_initialized_returns_503(
        self, client: TestClient, vault_manager, note_index
    ) -> None:
        """POST /api/chat/send when chat is None returns 503."""
        _seed_notes(vault_manager, note_index, [])

        with patch("agents.chat.get_chat_history", return_value=None):
            resp = client.post(
                "/api/chat/send",
                json={"message": "Hello", "agent": "_council"},
            )

        assert resp.status_code == 503
        assert "not initialized" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# GET /api/chat/history
# ---------------------------------------------------------------------------


class TestGetHistory:
    def test_get_history_default_agent(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/history returns messages for the default agent (_council)."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)
        chat.save_message(
            "_council", "user", "Hello council", timestamp="2026-03-15T10:00:00+00:00"
        )
        chat.save_message("_council", "council", "Hi there", timestamp="2026-03-15T10:00:05+00:00")

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/history")

        assert resp.status_code == 200
        data = resp.json()
        assert data["agent"] == "_council"
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][1]["role"] == "council"

    def test_get_history_specific_agent(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/history?agent=researcher returns researcher messages."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)
        chat.save_message("researcher", "user", "Question", timestamp="2026-03-15T10:00:00+00:00")

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/history?agent=researcher")

        assert resp.status_code == 200
        data = resp.json()
        assert data["agent"] == "researcher"
        assert len(data["messages"]) == 1

    def test_get_history_not_initialized_returns_503(
        self, client: TestClient, vault_manager, note_index
    ) -> None:
        """GET /api/chat/history when chat is None returns 503."""
        _seed_notes(vault_manager, note_index, [])

        with patch("agents.chat.get_chat_history", return_value=None):
            resp = client.get("/api/chat/history")

        assert resp.status_code == 503

    def test_get_history_empty(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/history with no messages returns empty list."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/history")

        assert resp.status_code == 200
        assert resp.json()["messages"] == []


# ---------------------------------------------------------------------------
# GET /api/chat/history/{date}
# ---------------------------------------------------------------------------


class TestGetHistoryByDate:
    def test_get_history_by_date(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/history/{date} returns messages for that date."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)
        # Manually write a chat file for a specific date
        chat_dir = chat._vault_root / "agents" / "_council" / "chat"
        (chat_dir / "2026-03-14.md").write_text(
            "# Chat — _council — 2026-03-14\n\n"
            "### user — 2026-03-14T10:00:00+00:00\n\nYesterday's question\n\n",
            encoding="utf-8",
        )

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/history/2026-03-14")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["messages"]) == 1
        assert data["messages"][0]["content"] == "Yesterday's question"

    def test_get_history_by_date_missing(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/history/{date} for nonexistent date returns empty."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/history/2020-01-01")

        assert resp.status_code == 200
        assert resp.json()["messages"] == []


# ---------------------------------------------------------------------------
# GET /api/chat/sessions
# ---------------------------------------------------------------------------


class TestListSessions:
    def test_list_sessions(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/sessions returns session dates."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)
        chat_dir = chat._vault_root / "agents" / "_council" / "chat"
        (chat_dir / "2026-03-13.md").write_text("# Chat\n\n", encoding="utf-8")
        (chat_dir / "2026-03-14.md").write_text("# Chat\n\n", encoding="utf-8")

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/sessions")

        assert resp.status_code == 200
        data = resp.json()
        assert data["agent"] == "_council"
        assert data["sessions"] == ["2026-03-13", "2026-03-14"]

    def test_list_sessions_empty(
        self, client: TestClient, vault_manager, note_index, tmp_path: Path
    ) -> None:
        """GET /api/chat/sessions with no sessions returns empty list."""
        _seed_notes(vault_manager, note_index, [])
        chat = _init_chat(tmp_path)

        with patch("agents.chat.get_chat_history", return_value=chat):
            resp = client.get("/api/chat/sessions")

        assert resp.status_code == 200
        assert resp.json()["sessions"] == []

    def test_list_sessions_not_initialized_returns_503(
        self, client: TestClient, vault_manager, note_index
    ) -> None:
        """GET /api/chat/sessions when chat is None returns 503."""
        _seed_notes(vault_manager, note_index, [])

        with patch("agents.chat.get_chat_history", return_value=None):
            resp = client.get("/api/chat/sessions")

        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# council_stream — SSE generator (api/routers/chat_stream.py)
# ---------------------------------------------------------------------------


class _FakeChat:
    """Minimal ChatHistory stand-in for driving council_stream directly."""

    def __init__(self) -> None:
        self.saved: list[tuple[str, str, str]] = []

    def load_recent(self, _agent: str, limit: int = 10):  # noqa: ARG002
        return []

    def save_message(self, agent: str, role: str, content: str) -> None:
        self.saved.append((agent, role, content))


def _parse_sse(frames: list[str]) -> list[tuple[str, str]]:
    """Parse raw SSE frame strings into (event, data) pairs."""
    parsed: list[tuple[str, str]] = []
    for frame in frames:
        event = ""
        data = ""
        for line in frame.splitlines():
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = line[len("data: ") :]
        parsed.append((event, data))
    return parsed


class TestCouncilStream:
    @pytest.mark.asyncio
    async def test_error_frame_on_midstream_failure(self) -> None:
        """A ProviderError mid-aggregator-stream emits an error frame and ends.

        The per-agent fan-out succeeds (so a `contributions` frame is emitted),
        but the aggregator's chat_stream yields one token then raises — the
        generator must surface `event: error` and terminate cleanly.
        """
        import json

        from api.routers.chat import _AGGREGATOR_SYSTEM, _COUNCIL_PERSONAS, _ask_agent
        from api.routers.chat_stream import council_stream
        from core.exceptions import ProviderError

        async def good_chat(messages, system=""):  # noqa: ARG001
            return "agent take"

        async def failing_stream(messages, system=""):  # noqa: ARG001
            yield "partial"
            raise ProviderError("fake", "stream died")

        provider = MagicMock()
        provider.chat = good_chat
        provider.chat_stream = failing_stream

        chat = _FakeChat()
        frames: list[str] = []
        with patch("core.providers.get_chat_provider", return_value=provider):
            async for frame in council_stream(
                "How is my vault?",
                chat,
                personas=_COUNCIL_PERSONAS,
                aggregator_system=_AGGREGATOR_SYSTEM,
                ask_agent=_ask_agent,
            ):
                frames.append(frame)

        events = _parse_sse(frames)
        names = [e for e, _ in events]

        # Contributions came first (fan-out succeeded), then a streamed token,
        # then the error frame; no `done` frame after the failure.
        assert "contributions" in names
        assert "token" in names
        assert names[-1] == "error"
        assert "done" not in names

        error_data = json.loads(next(d for e, d in events if e == "error"))
        assert "stream died" in error_data["message"]

        # One contributions frame, one per Loom persona inside it.
        contrib_data = json.loads(next(d for e, d in events if e == "contributions"))
        assert len(contrib_data["agent_contributions"]) == len(_COUNCIL_PERSONAS)

    @pytest.mark.asyncio
    async def test_provider_unavailable_emits_error_first(self) -> None:
        """If the chat provider can't be built, the first frame is an error."""
        from api.routers.chat import _AGGREGATOR_SYSTEM, _COUNCIL_PERSONAS, _ask_agent
        from api.routers.chat_stream import council_stream
        from core.exceptions import ProviderConfigError

        def _raise() -> None:
            raise ProviderConfigError("no provider configured")

        chat = _FakeChat()
        frames: list[str] = []
        with patch("core.providers.get_chat_provider", side_effect=_raise):
            async for frame in council_stream(
                "hi",
                chat,
                personas=_COUNCIL_PERSONAS,
                aggregator_system=_AGGREGATOR_SYSTEM,
                ask_agent=_ask_agent,
            ):
                frames.append(frame)

        events = _parse_sse(frames)
        assert len(events) == 1
        assert events[0][0] == "error"

    @pytest.mark.asyncio
    async def test_happy_path_streams_tokens_then_done(self) -> None:
        """A clean run emits contributions, token(s), then a done frame."""
        import json

        from api.routers.chat import _AGGREGATOR_SYSTEM, _COUNCIL_PERSONAS, _ask_agent
        from api.routers.chat_stream import council_stream

        async def good_chat(messages, system=""):  # noqa: ARG001
            return "agent take"

        async def good_stream(messages, system=""):  # noqa: ARG001
            for tok in ("Hello", " ", "world"):
                yield tok

        provider = MagicMock()
        provider.chat = good_chat
        provider.chat_stream = good_stream

        chat = _FakeChat()
        frames: list[str] = []
        with patch("core.providers.get_chat_provider", return_value=provider):
            async for frame in council_stream(
                "status?",
                chat,
                personas=_COUNCIL_PERSONAS,
                aggregator_system=_AGGREGATOR_SYSTEM,
                ask_agent=_ask_agent,
            ):
                frames.append(frame)

        events = _parse_sse(frames)
        names = [e for e, _ in events]
        assert names[0] == "contributions"
        assert "token" in names
        assert names[-1] == "done"

        done_data = json.loads(next(d for e, d in events if e == "done"))
        assert done_data["assistant_text"] == "Hello world"
        # The aggregated reply was persisted to the council history.
        assert chat.saved and chat.saved[-1][1] == "council"
