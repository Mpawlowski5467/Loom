"""Coverage for the GitHub Bridge: adapter mapping, sync orchestration,
cursor advancement, per-repo error isolation, the background poller, config
validation, and the /api/automations/github endpoints."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from starlette.testclient import TestClient

from bridge.github import GitHubClient, GitHubError, GitHubItem, fetch_repo_activity
from bridge.github_service import (
    GitHubSyncConflictError,
    GitHubSyncService,
    sync_github,
)
from core.config import (
    CaptureProcessingConfig,
    GitHubBridgeConfig,
    GlobalConfig,
    LoomSettings,
)
from core.notes import parse_note
from core.vault import VaultManager


def _make_client(handler) -> GitHubClient:
    transport = httpx.MockTransport(handler)
    return GitHubClient(
        token="secret-token",
        client=httpx.AsyncClient(
            base_url="https://api.github.com",
            transport=transport,
            headers={"Authorization": "Bearer secret-token"},
        ),
    )


_COMMIT_PAGE = json.dumps(
    [
        {
            "sha": "abc123def456",
            "commit": {
                "message": "feat: add the thing\n\nlonger body here",
                "author": {"name": "Ada"},
                "committer": {"date": "2026-07-18T10:00:00Z"},
            },
            "author": {"login": "ada-dev"},
            "html_url": "https://github.com/o/r/commit/abc123def456",
        }
    ]
).encode()

_ISSUE_PAGE = json.dumps(
    [
        {
            "number": 42,
            "title": "It broke",
            "body": "steps to reproduce",
            "state": "open",
            "updated_at": "2026-07-18T11:00:00Z",
            "html_url": "https://github.com/o/r/issues/42",
            "user": {"login": "reporter"},
            "labels": [{"name": "bug"}],
        },
        {
            "number": 43,
            "title": "Fix it",
            "body": "",
            "state": "closed",
            "updated_at": "2026-07-18T12:00:00Z",
            "html_url": "https://github.com/o/r/pull/43",
            "user": {"login": "fixer"},
            "labels": [],
            "pull_request": {"url": "https://api.github.com/repos/o/r/pulls/43"},
        },
    ]
).encode()


class TestGitHubAdapter:
    @pytest.mark.asyncio
    async def test_commits_map_to_items(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/repos/o/r/commits"
            assert request.url.params["since"] == "2026-07-17T00:00:00Z"
            assert request.headers["authorization"] == "Bearer secret-token"
            return httpx.Response(200, content=_COMMIT_PAGE)

        client = _make_client(handler)
        items = await client.fetch_commits("o/r", "2026-07-17T00:00:00Z")
        assert len(items) == 1
        item = items[0]
        assert item.kind == "commit"
        assert item.external_id == "github:o/r:commit:abc123def456"
        assert item.title == "feat: add the thing"
        assert item.body == "longer body here"
        assert item.author == "ada-dev"
        assert item.occurred_at == "2026-07-18T10:00:00Z"
        markdown = item.to_capture_markdown()
        assert "## Commit `abc123de` on o/r" in markdown
        assert "longer body here" in markdown

    @pytest.mark.asyncio
    async def test_issues_feed_splits_issues_and_prs(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=_ISSUE_PAGE)

        client = _make_client(handler)
        items = await client.fetch_issues_and_prs("o/r", "2026-07-17T00:00:00Z")
        assert [i.kind for i in items] == ["issue", "pr"]
        assert items[0].external_id == "github:o/r:issue:42"
        assert items[0].labels == ["bug"]
        assert items[1].external_id == "github:o/r:pr:43"
        assert items[1].state == "closed"
        assert "## Pull request o/r#43 — closed" in items[1].to_capture_markdown()

    @pytest.mark.asyncio
    async def test_error_mapping(self) -> None:
        cases = {
            401: "rejected",
            404: "Not found",
            500: "error 500",
        }
        for status, needle in cases.items():

            def handler(request: httpx.Request) -> httpx.Response:
                return httpx.Response(status, text="nope")

            client = _make_client(handler)
            with pytest.raises(GitHubError, match=needle):
                await client.fetch_commits("o/r", "2026-07-17T00:00:00Z")

    @pytest.mark.asyncio
    async def test_rate_limit_403_maps_clearly(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                403,
                text="API rate limit exceeded",
                headers={"x-ratelimit-remaining": "0"},
            )

        client = _make_client(handler)
        with pytest.raises(GitHubError, match="rate limit"):
            await client.fetch_commits("o/r", "2026-07-17T00:00:00Z")

    @pytest.mark.asyncio
    async def test_include_flags_filter_feed(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/commits"):
                return httpx.Response(200, content=_COMMIT_PAGE)
            return httpx.Response(200, content=_ISSUE_PAGE)

        client = _make_client(handler)
        kinds = [
            item.kind
            async for item in fetch_repo_activity(
                client,
                "o/r",
                commits_since="2026-07-17T00:00:00Z",
                issues_since="2026-07-17T00:00:00Z",
                include_commits=True,
                include_issues=False,
                include_pull_requests=True,
            )
        ]
        assert kinds == ["commit", "pr"]


class TestGitHubConfig:
    def test_repo_validation_normalizes_and_dedupes(self) -> None:
        cfg = GitHubBridgeConfig(repos=[" Owner/Repo.git ", "owner/Repo", "other/one"])
        assert cfg.repos == ["Owner/Repo", "other/one"]

    def test_repo_validation_rejects_bad_shapes(self) -> None:
        for bad in ["noslash", "a/b/c", "a//b", "a b/c", "../x"]:
            with pytest.raises(ValueError):
                GitHubBridgeConfig(repos=[bad])

    def test_token_blank_normalizes_to_none(self) -> None:
        assert GitHubBridgeConfig(token="  ").token is None

    def test_token_encrypted_at_rest(self, tmp_path: Path) -> None:
        cfg = GlobalConfig()
        cfg.github = GitHubBridgeConfig(enabled=True, token="ghp_secret", repos=["o/r"])
        path = tmp_path / "config.yaml"
        cfg.save(path)
        on_disk = path.read_text(encoding="utf-8")
        assert "ghp_secret" not in on_disk
        assert "enc:v1:" in on_disk
        loaded = GlobalConfig.load(path)
        assert loaded.github.token == "ghp_secret"
        public = loaded.github.to_public()
        assert public.token_set is True
        assert not hasattr(public, "token")


def _github_vault(tmp_path: Path, monkeypatch) -> VaultManager:
    """Real vault + config with the bridge enabled; cursors patched to tmp."""
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.github = GitHubBridgeConfig(
        enabled=True,
        token="ghp_x",
        repos=["o/r"],
        lookback_hours=48,
        interval_minutes=5,
    )
    config.capture_processing = CaptureProcessingConfig(
        mode="trusted",
        trusted_sources=["bridge:github"],
    )
    config.save(manager.config_path())
    monkeypatch.setattr(
        "bridge.github_service._cursor_path", lambda: tmp_path / "github-sync.json"
    )
    return manager


class _FakeClient:
    """Stand-in for GitHubClient yielding canned items via fetch_repo_activity."""

    def __init__(self, items: list[GitHubItem]) -> None:
        self.items = items

    async def fetch_commits(self, repo: str, since_iso: str) -> list[GitHubItem]:
        return [i for i in self.items if i.kind == "commit"]

    async def fetch_issues_and_prs(self, repo: str, since_iso: str) -> list[GitHubItem]:
        return [i for i in self.items if i.kind != "commit"]

    async def aclose(self) -> None:
        return None


def _item(kind: str, ext: str, title: str, occurred: str) -> GitHubItem:
    return GitHubItem(
        kind=kind,  # type: ignore[arg-type]
        repo="o/r",
        external_id=ext,
        title=title,
        body="body",
        url="https://example.test",
        author="ada",
        occurred_at=occurred,
    )


class TestGitHubSyncService:
    @pytest.mark.asyncio
    async def test_sync_ingests_and_is_idempotent(self, tmp_path, monkeypatch) -> None:
        manager = _github_vault(tmp_path, monkeypatch)
        items = [
            _item("commit", "github:o/r:commit:aaa111", "feat: one", "2026-07-18T10:00:00Z"),
            _item("issue", "github:o/r:issue:7", "Bug report", "2026-07-18T11:00:00Z"),
            _item("pr", "github:o/r:pr:9", "Fix", "2026-07-18T12:00:00Z"),
        ]
        fake = _FakeClient(items)

        first = await sync_github(vm=manager, client=fake)  # type: ignore[arg-type]
        assert first["created"] == 3
        assert first["deduplicated"] == 0
        assert first["errors"] == 0

        captures_dir = manager.active_vault_dir() / "threads" / "captures"
        files = sorted(p.name for p in captures_dir.glob("*.md"))
        assert len(files) == 3
        note = parse_note(captures_dir / files[0])
        assert note.source == "bridge:github"

        second = await sync_github(vm=manager, client=fake)  # type: ignore[arg-type]
        assert second["created"] == 0
        assert second["deduplicated"] == 3
        assert len(list(captures_dir.glob("*.md"))) == 3

    @pytest.mark.asyncio
    async def test_cursor_advances_and_persists(self, tmp_path, monkeypatch) -> None:
        manager = _github_vault(tmp_path, monkeypatch)
        # Item timestamps must sit inside the lookback window measured from
        # real now, or the cursor correctly stays at the window start.
        commit_ts = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        issue_ts = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        items = [
            _item("commit", "github:o/r:commit:aaa111", "feat: one", commit_ts),
            _item("issue", "github:o/r:issue:7", "Bug", issue_ts),
        ]
        await sync_github(vm=manager, client=_FakeClient(items))  # type: ignore[arg-type]

        cursors = json.loads((tmp_path / "github-sync.json").read_text(encoding="utf-8"))
        assert cursors["repos"]["o/r"]["commits"] == commit_ts
        assert cursors["repos"]["o/r"]["issues"] == issue_ts

    @pytest.mark.asyncio
    async def test_repo_error_is_isolated(self, tmp_path, monkeypatch) -> None:
        manager = _github_vault(tmp_path, monkeypatch)
        config = GlobalConfig.load(manager.config_path())
        config.github.repos = ["bad/repo", "o/r"]
        config.save(manager.config_path())

        class _FlakyClient(_FakeClient):
            async def fetch_commits(self, repo: str, since_iso: str) -> list[GitHubItem]:
                if repo == "bad/repo":
                    raise GitHubError("Not found or not accessible: /repos/bad/repo/commits")
                return []

            async def fetch_issues_and_prs(self, repo: str, since_iso: str):
                return []

        result = await sync_github(vm=manager, client=_FlakyClient([]))  # type: ignore[arg-type]
        assert result["errors"] == 1
        assert result["repos"][0]["repo"] == "bad/repo"
        assert "Not found" in result["repos"][0]["error"]
        assert result["repos"][1]["error"] == ""

    @pytest.mark.asyncio
    async def test_no_repos_raises(self, tmp_path, monkeypatch) -> None:
        manager = _github_vault(tmp_path, monkeypatch)
        config = GlobalConfig.load(manager.config_path())
        config.github.repos = []
        config.save(manager.config_path())
        with pytest.raises(GitHubError, match="repository"):
            await sync_github(vm=manager, client=_FakeClient([]))  # type: ignore[arg-type]


class TestGitHubPoller:
    @pytest.mark.asyncio
    async def test_tick_runs_sync_when_enabled(self, tmp_path, monkeypatch) -> None:
        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "2026-07-19T00:00:00Z", "created": 2, "errors": 0}

        cfg = GlobalConfig()
        cfg.github = GitHubBridgeConfig(enabled=True, repos=["o/r"], interval_minutes=5)
        monkeypatch.setattr(GlobalConfig, "load", classmethod(lambda cls, path: cfg))
        monkeypatch.setattr("bridge.github_service.sync_github", _fake_sync)

        service = GitHubSyncService()
        await service.start()
        try:
            for _ in range(50):
                if calls:
                    break
                await asyncio.sleep(0.02)
            assert calls == ["tick"]
            status = service.status()
            assert status["last_run"] == "2026-07-19T00:00:00Z"
            assert status["last_created"] == 2
            assert status["last_error"] == ""
        finally:
            await service.aclose()

    @pytest.mark.asyncio
    async def test_tick_skips_when_disabled(self, tmp_path, monkeypatch) -> None:
        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "", "created": 0, "errors": 0}

        monkeypatch.setattr(
            GlobalConfig, "load", classmethod(lambda cls, path: GlobalConfig())
        )
        monkeypatch.setattr("bridge.github_service.sync_github", _fake_sync)

        service = GitHubSyncService()
        await service.start()
        try:
            await asyncio.sleep(0.15)
            assert calls == []
        finally:
            await service.aclose()


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


def _init(vault_manager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager.active_vault_dir()


class TestGitHubApi:
    def test_get_defaults_are_redacted(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.get("/api/automations/github")
        assert response.status_code == 200
        body = response.json()
        assert body["github"]["enabled"] is False
        assert body["github"]["token_set"] is False
        assert "token" not in body["github"]
        assert body["status"]["running"] in (True, False)

    def test_patch_persists_and_encrypts(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.patch(
            "/api/automations/github",
            json={
                "enabled": True,
                "token": "ghp_secret",
                "repos": ["Owner/Repo.git"],
                "interval_minutes": 30,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["github"]["enabled"] is True
        assert body["github"]["token_set"] is True
        assert body["github"]["repos"] == ["Owner/Repo"]
        assert body["github"]["interval_minutes"] == 30
        persisted = vault_manager.config_path().read_text(encoding="utf-8")
        assert "ghp_secret" not in persisted
        loaded = GlobalConfig.load(vault_manager.config_path())
        assert loaded.github.token == "ghp_secret"

    def test_patch_rejects_enabled_without_repos(
        self, client: TestClient, vault_manager
    ) -> None:
        _init(vault_manager)
        response = client.patch("/api/automations/github", json={"enabled": True})
        assert response.status_code == 422

    def test_patch_rejects_bad_repo(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.patch("/api/automations/github", json={"repos": ["not-a-repo"]})
        assert response.status_code == 422
        assert "owner/name" in response.json()["detail"]

    def test_test_endpoint_reports_per_repo(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        client.patch(
            "/api/automations/github",
            json={"token": "ghp_x", "repos": ["o/r", "bad/repo"]},
        )

        async def _validate(repo: str) -> dict:
            if repo == "bad/repo":
                raise GitHubError("Not found or not accessible: /repos/bad/repo")
            return {
                "repo": "o/r",
                "private": False,
                "description": "demo",
                "default_branch": "main",
                "pushed_at": "2026-07-18T00:00:00Z",
            }

        with patch("bridge.github.GitHubClient.validate_repo", side_effect=_validate):
            response = client.post("/api/automations/github/test")
        assert response.status_code == 200
        repos = response.json()["repos"]
        assert repos[0]["ok"] is True
        assert repos[0]["default_branch"] == "main"
        assert repos[1]["ok"] is False
        assert "Not found" in repos[1]["error"]

    def test_sync_endpoint_returns_result(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        client.patch("/api/automations/github", json={"repos": ["o/r"]})
        payload = {
            "synced_at": "2026-07-19T00:00:00Z",
            "repos": [{"repo": "o/r", "fetched": 1, "created": 1, "deduplicated": 0, "error": ""}],
            "created": 1,
            "deduplicated": 0,
            "errors": 0,
        }
        with patch("api.routers.github_bridge.sync_github", return_value=payload):
            response = client.post("/api/automations/github/sync")
        assert response.status_code == 200
        assert response.json()["created"] == 1

    def test_sync_conflict_maps_to_409(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        client.patch("/api/automations/github", json={"repos": ["o/r"]})

        async def _boom(**kwargs):
            raise GitHubSyncConflictError("The active vault changed; retry GitHub sync")

        with patch("api.routers.github_bridge.sync_github", side_effect=_boom):
            response = client.post("/api/automations/github/sync")
        assert response.status_code == 409
