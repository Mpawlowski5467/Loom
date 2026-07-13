"""Codex app-server provider and auth bridge tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import CodexProviderConfig
from core.providers.codex import (
    CodexProvider,
    _CodexAppServerSession,
    codex_connection_status,
    start_codex_login,
)


class _FakeWriter:
    def __init__(self) -> None:
        self.writes: list[bytes] = []
        self.closed = False

    def write(self, value: bytes) -> None:
        self.writes.append(value)

    async def drain(self) -> None:
        return None

    def is_closing(self) -> bool:
        return self.closed

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        return None


class _FakeProcess:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.stdin = _FakeWriter()
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        for message in messages:
            self.stdout.feed_data(json.dumps(message).encode() + b"\n")
        self.stdout.feed_eof()
        self.stderr.feed_eof()
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode or 0


def _chat_messages(*, connected: bool = True) -> list[dict[str, Any]]:
    account: dict[str, Any] | None = (
        {"type": "chatgpt", "planType": "plus", "email": None} if connected else None
    )
    return [
        {"id": 1, "result": {"userAgent": "loom/0.142.4 (test)"}},
        {"id": 2, "result": {"account": account, "requiresOpenaiAuth": True}},
        {"id": 3, "result": {"thread": {"id": "thread-1"}}},
        {"id": 4, "result": {"turn": {"id": "turn-1"}}},
        {
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "hello",
            },
        },
        {
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {"id": "item-1", "type": "agentMessage", "text": "hello world"},
            },
        },
        {
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "turn": {"id": "turn-1", "status": "completed", "items": []},
            },
        },
    ]


@pytest.mark.asyncio
async def test_chat_uses_locked_down_protocol_and_secret_free_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    process = _FakeProcess(_chat_messages())
    create = AsyncMock(return_value=process)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr("core.providers.codex._codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr("core.providers.codex._codex_home", lambda: tmp_path / "codex-home")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-leak")
    monkeypatch.setenv("CODEX_ACCESS_TOKEN", "must-not-leak")
    monkeypatch.setenv("LOOM_DATABASE_URL", "must-not-leak")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-leak")

    provider = CodexProvider(CodexProviderConfig(chat_model="default"))
    result = await provider.chat(
        [{"role": "user", "content": "Say hello"}],
        system="Return one short sentence.",
    )

    assert result == "hello world"
    assert process.terminated is True
    args = create.await_args.args
    assert args[:3] == ("/usr/bin/codex", "app-server", "--stdio")
    assert "shell_tool" in args

    child_env = create.await_args.kwargs["env"]
    assert child_env["CODEX_HOME"] == str(tmp_path / "codex-home")
    assert child_env["PATH"]
    for secret_name in (
        "OPENAI_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "LOOM_DATABASE_URL",
        "ANTHROPIC_API_KEY",
    ):
        assert secret_name not in child_env

    sent = [json.loads(payload) for payload in process.stdin.writes]
    thread_start = next(message for message in sent if message.get("method") == "thread/start")
    params = thread_start["params"]
    assert params["ephemeral"] is True
    assert params["approvalPolicy"] == "never"
    assert params["developerInstructions"] == "Return one short sentence."
    assert "model" not in params  # "default" delegates selection to Codex.
    assert Path(params["cwd"]).name.startswith("loom-codex-")
    policy = params["config"]
    assert policy["default_permissions"] == "loom-chat"
    assert policy["permissions"]["loom-chat"]["filesystem"] == {
        ":minimal": "read",
        ":workspace_roots": {".": "read"},
    }
    assert policy["permissions"]["loom-chat"]["network"]["enabled"] is False
    assert policy["features"]["shell_tool"] is False
    assert policy["features"]["apps"] is False
    assert policy["web_search"] == "disabled"


@pytest.mark.asyncio
async def test_chat_fails_clearly_when_loom_codex_home_is_not_connected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    process = _FakeProcess(_chat_messages(connected=False)[:2])
    monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    monkeypatch.setattr("core.providers.codex._codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr("core.providers.codex._codex_home", lambda: tmp_path / "codex-home")
    provider = CodexProvider(CodexProviderConfig())

    with pytest.raises(ProviderConfigError, match="not connected to ChatGPT"):
        await provider.chat([{"role": "user", "content": "hello"}])

    assert process.terminated is True


def test_provider_fails_clearly_when_cli_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.providers.codex._codex_binary", lambda: None)
    with pytest.raises(ProviderConfigError, match="not installed"):
        CodexProvider(CodexProviderConfig())


@pytest.mark.asyncio
async def test_codex_embeddings_are_explicitly_unsupported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("core.providers.codex._codex_binary", lambda: "/usr/bin/codex")
    provider = CodexProvider(CodexProviderConfig())
    with pytest.raises(ProviderError, match="chat-only"):
        await provider.embed("hello")


@pytest.mark.asyncio
async def test_status_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    session = AsyncMock(spec=_CodexAppServerSession)
    session.user_agent = "loom/0.142.4 (test)"
    session.request.return_value = {
        "account": {"type": "chatgpt", "planType": "plus", "email": "private@example.com"},
        "requiresOpenaiAuth": True,
    }
    session.close = AsyncMock()
    monkeypatch.setattr("core.providers.codex._codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr(
        "core.providers.codex._CodexAppServerSession.start",
        AsyncMock(return_value=session),
    )

    status = await codex_connection_status()

    assert status.installed is True
    assert status.connected is True
    assert status.auth_mode == "chatgpt"
    assert status.plan_type == "plus"
    assert status.version == "0.142.4"
    assert "email" not in status.__slots__
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_login_start_keeps_app_server_alive_for_browser_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import core.providers.codex as codex_mod

    blocker = asyncio.Event()
    session = AsyncMock(spec=_CodexAppServerSession)
    session.request.return_value = {
        "type": "chatgpt",
        "authUrl": "https://auth.openai.com/authorize?opaque=yes",
        "loginId": "login-1",
    }

    async def wait_for_callback(*, timeout: float) -> dict[str, Any]:  # noqa: ARG001
        await blocker.wait()
        return {}

    session.next_notification.side_effect = wait_for_callback
    session.close = AsyncMock()
    monkeypatch.setattr(
        "core.providers.codex._CodexAppServerSession.start",
        AsyncMock(return_value=session),
    )

    result = await start_codex_login()

    assert result.auth_url.startswith("https://auth.openai.com/")
    assert result.login_id == "login-1"
    await asyncio.sleep(0)
    assert codex_mod._login_session is session
    assert codex_mod._login_task is not None
    assert not codex_mod._login_task.done()
    session.close.assert_not_awaited()

    codex_mod._login_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await codex_mod._login_task
    session.close.assert_awaited_once()
