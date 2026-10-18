"""/api/history: list, diff, revert; the Board feed links activity to commits."""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from agents.changelog import log_action
from core.history import VaultHistory, commit_group, start_history, stop_history
from core.history.git import git_available
from core.vault import VaultManager
from core.vault_io import write_note
from tests.core.conftest import note_meta, set_history_config

pytestmark = pytest.mark.skipif(not git_available(), reason="git is not installed")


@pytest.fixture()
def root(vault_manager: VaultManager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager._settings.vaults_dir / "test"


@pytest.fixture()
def history(root: Path) -> Iterator[VaultHistory]:
    recorder = start_history(root)
    assert recorder is not None
    recorder.flush()
    yield recorder
    stop_history()


def _agent_write(
    history: VaultHistory, root: Path, rel: str, body: str, *, log: bool = False
) -> str:
    async def run() -> None:
        async with commit_group():
            if log:
                log_action(root, "weaver", "created", str(root / "threads" / rel))
            write_note(root, root / "threads" / rel, note_meta(rel, rel), body)

    asyncio.run(run())
    history.flush()
    return history.repo.log(limit=1)[0].sha


def test_status_list_and_filters(client: TestClient, history: VaultHistory, root: Path) -> None:
    assert client.get("/api/history/status").json()["enabled"] is True
    sha = _agent_write(history, root, "topics/a.md", "alpha\n")
    entries = client.get("/api/history", params={"path": "threads/topics/a.md"}).json()
    assert [e["sha"] for e in entries] == [sha]
    assert entries[0]["agents"] == ["weaver"]
    assert entries[0]["action"] == "created"
    assert entries[0]["revertible"] is True
    assert len(client.get("/api/history", params={"agent": "weaver"}).json()) == 1
    assert client.get("/api/history", params={"agent": "spider"}).json() == []


def test_diff_returns_file_versions_and_patch(
    client: TestClient, history: VaultHistory, root: Path
) -> None:
    sha = _agent_write(history, root, "topics/a.md", "alpha\n")
    body = client.get(f"/api/history/{sha[:10]}/diff").json()
    assert body["sha"] == sha
    diff = body["file_diffs"][0]
    assert diff["path"] == "threads/topics/a.md" and diff["status"] == "added"
    assert diff["before"] is None and "alpha" in diff["after"]
    assert "+alpha" in body["patch"]


def test_revert_endpoint_and_repeat_conflict(
    client: TestClient, history: VaultHistory, root: Path
) -> None:
    sha = _agent_write(history, root, "topics/a.md", "alpha\n")
    response = client.post(f"/api/history/{sha}/revert")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reverted"] == sha and body["sha"]
    assert not (root / "threads/topics/a.md").exists()
    again = client.post(f"/api/history/{sha}/revert")
    assert again.status_code == 409
    assert again.json()["detail"]["message"]


@pytest.mark.parametrize(
    ("url", "status"),
    [
        ("/api/history/not-a-sha/diff", 400),
        ("/api/history/deadbeef/diff", 404),
        ("/api/history?agent=bad%20name", 400),
        ("/api/history?path=../etc/passwd", 400),
    ],
)
def test_invalid_requests(client: TestClient, history: VaultHistory, url: str, status: int) -> None:
    assert client.get(url).status_code == status


def test_disabled_history_reports_why(client: TestClient, root: Path) -> None:
    set_history_config(root, enabled=False)
    status = client.get("/api/history/status").json()
    assert status["enabled"] is False and "turned off" in status["reason"]
    assert client.get("/api/history").status_code == 503


def test_changelog_feed_links_entries_to_their_commit(
    client: TestClient, history: VaultHistory, root: Path
) -> None:
    sha = _agent_write(history, root, "topics/a.md", "alpha\n", log=True)
    events = client.get("/api/changelog/feed").json()
    linked = [e for e in events if e["agent"] == "weaver"]
    assert linked and linked[0]["commit"] == sha
