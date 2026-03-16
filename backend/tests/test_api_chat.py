"""Tests for the chat API routes in api/routers/chat.py."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

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
        chat.save_message("_council", "user", "Hello council", timestamp="2026-03-15T10:00:00+00:00")
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
