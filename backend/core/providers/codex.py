"""Chat-only Codex provider backed by the local ``codex app-server``.

The bridge deliberately uses an isolated ``CODEX_HOME`` managed by Loom.  This
keeps the user's normal Codex plugins, MCP servers, hooks, and repository config
out of provider calls.  Codex owns the ChatGPT OAuth credentials in the OS
keyring; Loom never reads, copies, or returns those tokens.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import tempfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from core.config import settings
from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, CodexProviderConfig

_REQUEST_TIMEOUT_S = 15.0
_CHAT_TIMEOUT_S = 180.0
_LOGIN_TIMEOUT_S = 10 * 60.0
_SHUTDOWN_TIMEOUT_S = 3.0
_MAX_PROTOCOL_LINE_BYTES = 4 * 1024 * 1024

_CLIENT_INFO = {"name": "loom", "title": "Loom", "version": "1.0"}
_VERSION_RE = re.compile(r"\bloom/([^\s]+)")

# No provider, database, Loom API, cloud, or shell secrets are inherited.  The
# binary is resolved before spawning and tools are disabled, so a system-only
# PATH is sufficient for the app-server itself.
_ENV_PASSTHROUGH = ("HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE")

_APP_SERVER_ARGS = (
    "app-server",
    "--stdio",
    "-c",
    'cli_auth_credentials_store="keyring"',
    "-c",
    'history.persistence="none"',
    "-c",
    'web_search="disabled"',
    "-c",
    'shell_environment_policy.inherit="none"',
    "-c",
    "allow_login_shell=false",
    "-c",
    "check_for_update_on_startup=false",
    "--disable",
    "apps",
    "--disable",
    "goals",
    "--disable",
    "hooks",
    "--disable",
    "memories",
    "--disable",
    "multi_agent",
    "--disable",
    "remote_plugin",
    "--disable",
    "shell_snapshot",
    "--disable",
    "shell_tool",
)

_LOCKED_THREAD_CONFIG: dict[str, Any] = {
    # Permission profiles provide a narrower read boundary than the legacy
    # read-only sandbox: only minimal runtime files plus the empty temporary
    # workspace are readable, and network is denied for all model tools.
    "default_permissions": "loom-chat",
    "permissions": {
        "loom-chat": {
            "filesystem": {
                ":minimal": "read",
                ":workspace_roots": {".": "read"},
            },
            "network": {"enabled": False},
        }
    },
    "web_search": "disabled",
    "features": {
        "apps": False,
        "goals": False,
        "hooks": False,
        "memories": False,
        "multi_agent": False,
        "remote_plugin": False,
        "shell_snapshot": False,
        "shell_tool": False,
    },
    "shell_environment_policy": {"inherit": "none"},
}


class _CodexProtocolError(RuntimeError):
    """Raised when the local app-server returns invalid or failed protocol data."""


@dataclass(frozen=True, slots=True)
class CodexConnectionStatus:
    installed: bool
    connected: bool
    auth_mode: str | None = None
    plan_type: str | None = None
    version: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class CodexLoginStart:
    auth_url: str
    login_id: str


def _codex_home() -> Path:
    """Return Loom's isolated Codex state directory."""
    return settings.loom_home / "codex"


def _prepare_codex_home(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    with contextlib.suppress(OSError):
        path.chmod(0o700)


def _codex_binary() -> str | None:
    return shutil.which("codex")


def _subprocess_env(codex_home: Path) -> dict[str, str]:
    """Build a minimal, secret-free environment for the Codex subprocess."""
    env = {key: os.environ[key] for key in _ENV_PASSTHROUGH if os.environ.get(key)}
    env.update(
        {
            "CODEX_HOME": str(codex_home),
            "PATH": os.defpath,
            "NO_COLOR": "1",
        }
    )
    return env


class _CodexAppServerSession:
    """Small JSONL client for one isolated app-server subprocess."""

    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self._process = process
        self._next_id = 0
        self._notifications: deque[dict[str, Any]] = deque()
        self._stderr_task: asyncio.Task[None] | None = None
        self.user_agent = ""

    @classmethod
    async def start(cls) -> _CodexAppServerSession:
        binary = _codex_binary()
        if not binary:
            raise ProviderConfigError("Codex CLI is not installed or is not available on PATH.")

        home = _codex_home()
        _prepare_codex_home(home)
        try:
            process = await asyncio.create_subprocess_exec(
                binary,
                *_APP_SERVER_ARGS,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=_subprocess_env(home),
            )
        except OSError as exc:
            raise ProviderConfigError(f"Unable to start Codex CLI: {exc}") from exc

        session = cls(process)
        if process.stderr is not None:
            session._stderr_task = asyncio.create_task(session._discard_stderr())
        try:
            result = await session.request(
                "initialize",
                {"clientInfo": _CLIENT_INFO},
                timeout=_REQUEST_TIMEOUT_S,
            )
            session.user_agent = str(result.get("userAgent") or "")
            await session.notify("initialized", {})
            return session
        except BaseException:
            await session.close()
            raise

    async def _discard_stderr(self) -> None:
        """Drain diagnostics so the child cannot block; never surface secrets."""
        stderr = self._process.stderr
        if stderr is None:
            return
        while await stderr.readline():
            pass

    async def _send(self, message: dict[str, Any]) -> None:
        stdin = self._process.stdin
        if stdin is None or stdin.is_closing():
            raise _CodexProtocolError("Codex app-server input is closed.")
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        stdin.write(payload)
        await stdin.drain()

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"method": method, "params": params})

    async def request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float,
    ) -> dict[str, Any]:
        self._next_id += 1
        request_id = self._next_id
        await self._send({"method": method, "id": request_id, "params": params})

        async with asyncio.timeout(timeout):
            while True:
                message = await self._read_message()
                if message.get("id") != request_id:
                    if "method" in message:
                        self._notifications.append(message)
                    continue
                error = message.get("error")
                if isinstance(error, dict):
                    detail = str(error.get("message") or "unknown protocol error")
                    raise _CodexProtocolError(f"Codex app-server rejected {method}: {detail}")
                result = message.get("result")
                if not isinstance(result, dict):
                    raise _CodexProtocolError(
                        f"Codex app-server returned an invalid response for {method}."
                    )
                return result

    async def _read_message(self) -> dict[str, Any]:
        stdout = self._process.stdout
        if stdout is None:
            raise _CodexProtocolError("Codex app-server output is unavailable.")
        line = await stdout.readline()
        if not line:
            raise _CodexProtocolError("Codex app-server exited unexpectedly.")
        if len(line) > _MAX_PROTOCOL_LINE_BYTES:
            raise _CodexProtocolError("Codex app-server response exceeded the safety limit.")
        try:
            value = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise _CodexProtocolError("Codex app-server returned malformed JSON.") from exc
        if not isinstance(value, dict):
            raise _CodexProtocolError("Codex app-server returned a non-object message.")
        return value

    async def next_notification(self, *, timeout: float) -> dict[str, Any]:
        if self._notifications:
            return self._notifications.popleft()
        async with asyncio.timeout(timeout):
            while True:
                message = await self._read_message()
                if "method" in message:
                    return message

    async def close(self) -> None:
        stdin = self._process.stdin
        if stdin is not None and not stdin.is_closing():
            stdin.close()
            wait_closed = getattr(stdin, "wait_closed", None)
            if wait_closed is not None:
                with contextlib.suppress(Exception):
                    await wait_closed()

        if self._process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=_SHUTDOWN_TIMEOUT_S)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self._process.kill()
                with contextlib.suppress(Exception):
                    await self._process.wait()

        if self._stderr_task is not None:
            self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stderr_task


def _model_value(configured: str) -> str | None:
    value = configured.strip()
    return None if not value or value == "default" else value


def _conversation_text(messages: list[dict[str, Any]]) -> str:
    if not messages:
        return "Respond to the request using only the supplied instructions."
    rendered: list[str] = []
    for message in messages:
        role = str(message.get("role") or "user").upper()
        content = message.get("content", "")
        rendered.append(f"{role}:\n{content if isinstance(content, str) else str(content)}")
    rendered.append("ASSISTANT:")
    return "\n\n".join(rendered)


async def _require_connected(session: _CodexAppServerSession) -> dict[str, Any]:
    result = await session.request("account/read", {"refreshToken": False}, timeout=10.0)
    account = result.get("account")
    if not isinstance(account, dict):
        raise ProviderConfigError(
            "Codex is not connected to ChatGPT. Connect it in Settings → Providers first."
        )
    return account


class CodexProvider(BaseProvider):
    """Text-only provider that delegates a turn to a locked-down Codex thread."""

    name = "codex"

    def __init__(self, cfg: CodexProviderConfig) -> None:
        if not _codex_binary():
            raise ProviderConfigError("Codex CLI is not installed or is not available on PATH.")
        self._chat_model = cfg.chat_model

    async def embed(self, text: str) -> list[float]:  # noqa: ARG002
        raise ProviderError(
            "codex",
            "Codex is chat-only and does not provide embeddings. "
            "Configure OpenAI or Ollama as the embedding provider.",
        )

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        session: _CodexAppServerSession | None = None
        try:
            async with asyncio.timeout(_CHAT_TIMEOUT_S):
                session = await _CodexAppServerSession.start()
                await _require_connected(session)
                with tempfile.TemporaryDirectory(prefix="loom-codex-") as temp_dir:
                    params: dict[str, Any] = {
                        "cwd": str(Path(temp_dir).resolve()),
                        "ephemeral": True,
                        "approvalPolicy": "never",
                        "developerInstructions": system or None,
                        "config": _LOCKED_THREAD_CONFIG,
                    }
                    model = _model_value(self._chat_model)
                    if model is not None:
                        params["model"] = model

                    thread_result = await session.request(
                        "thread/start", params, timeout=_REQUEST_TIMEOUT_S
                    )
                    thread = thread_result.get("thread")
                    thread_id = thread.get("id") if isinstance(thread, dict) else None
                    if not isinstance(thread_id, str) or not thread_id:
                        raise _CodexProtocolError("Codex did not return a thread id.")

                    turn_result = await session.request(
                        "turn/start",
                        {
                            "threadId": thread_id,
                            "input": [{"type": "text", "text": _conversation_text(messages)}],
                            "approvalPolicy": "never",
                        },
                        timeout=_REQUEST_TIMEOUT_S,
                    )
                    turn = turn_result.get("turn")
                    turn_id = turn.get("id") if isinstance(turn, dict) else None
                    if not isinstance(turn_id, str) or not turn_id:
                        raise _CodexProtocolError("Codex did not return a turn id.")
                    return await _collect_final_message(session, thread_id, turn_id)
        except ProviderConfigError:
            raise
        except TimeoutError as exc:
            raise ProviderError("codex", "Codex timed out before completing the response.") from exc
        except (OSError, _CodexProtocolError) as exc:
            raise ProviderError("codex", str(exc)) from exc
        finally:
            if session is not None:
                await session.close()


async def _collect_final_message(
    session: _CodexAppServerSession,
    thread_id: str,
    turn_id: str,
) -> str:
    final_text = ""
    deltas: list[str] = []
    while True:
        message = await session.next_notification(timeout=_CHAT_TIMEOUT_S)
        params = message.get("params")
        if not isinstance(params, dict):
            continue
        if params.get("threadId") != thread_id or params.get("turnId") != turn_id:
            continue

        method = message.get("method")
        if method == "item/agentMessage/delta":
            delta = params.get("delta")
            if isinstance(delta, str):
                deltas.append(delta)
            continue
        if method == "item/completed":
            item = params.get("item")
            if isinstance(item, dict) and item.get("type") == "agentMessage":
                text = item.get("text")
                if isinstance(text, str):
                    final_text = text
            continue
        if method != "turn/completed":
            continue

        turn = params.get("turn")
        if not isinstance(turn, dict):
            raise _CodexProtocolError("Codex returned an invalid completed turn.")
        status = turn.get("status")
        if status != "completed":
            error = turn.get("error")
            detail = error.get("message") if isinstance(error, dict) else status
            raise _CodexProtocolError(f"Codex turn did not complete: {detail or 'unknown error'}")
        for item in turn.get("items") or []:
            if isinstance(item, dict) and item.get("type") == "agentMessage":
                text = item.get("text")
                if isinstance(text, str):
                    final_text = text
        answer = final_text or "".join(deltas)
        if not answer:
            raise _CodexProtocolError("Codex completed without an assistant message.")
        return answer


async def codex_connection_status() -> CodexConnectionStatus:
    """Read redacted Codex auth state through app-server."""
    if not _codex_binary():
        return CodexConnectionStatus(
            installed=False,
            connected=False,
            error="Codex CLI is not installed or is not available on PATH.",
        )

    session: _CodexAppServerSession | None = None
    try:
        session = await _CodexAppServerSession.start()
        result = await session.request(
            "account/read", {"refreshToken": False}, timeout=_REQUEST_TIMEOUT_S
        )
        account = result.get("account")
        version_match = _VERSION_RE.search(session.user_agent)
        version = version_match.group(1) if version_match else None
        if not isinstance(account, dict):
            return CodexConnectionStatus(
                installed=True,
                connected=False,
                version=version,
            )
        return CodexConnectionStatus(
            installed=True,
            connected=True,
            auth_mode=str(account.get("type") or "unknown"),
            plan_type=(str(account["planType"]) if account.get("planType") else None),
            version=version,
        )
    except (OSError, TimeoutError, _CodexProtocolError, ProviderConfigError) as exc:
        return CodexConnectionStatus(
            installed=True,
            connected=False,
            error=str(exc),
        )
    finally:
        if session is not None:
            await session.close()


_login_lock = asyncio.Lock()
_login_session: _CodexAppServerSession | None = None
_login_task: asyncio.Task[None] | None = None


async def start_codex_login() -> CodexLoginStart:
    """Start ChatGPT browser login and retain app-server for its callback."""
    global _login_session, _login_task

    async with _login_lock:
        old_session = _login_session
        old_task = _login_task
        _login_session = None
        _login_task = None

    if old_task is not None:
        old_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await old_task
    elif old_session is not None:
        await old_session.close()

    session = await _CodexAppServerSession.start()
    try:
        result = await session.request(
            "account/login/start",
            {"type": "chatgpt"},
            timeout=_REQUEST_TIMEOUT_S,
        )
        auth_url = result.get("authUrl")
        login_id = result.get("loginId")
        parsed = urlparse(auth_url) if isinstance(auth_url, str) else None
        if (
            not isinstance(auth_url, str)
            or not isinstance(login_id, str)
            or not login_id
            or parsed is None
            or parsed.scheme != "https"
            or not parsed.netloc
        ):
            raise _CodexProtocolError("Codex returned an invalid login URL.")

        async with _login_lock:
            _login_session = session
            _login_task = asyncio.create_task(_watch_login(session, login_id))
        return CodexLoginStart(auth_url=auth_url, login_id=login_id)
    except ProviderConfigError:
        await session.close()
        raise
    except (OSError, TimeoutError, _CodexProtocolError) as exc:
        await session.close()
        raise ProviderError("codex", f"Unable to start ChatGPT sign-in: {exc}") from exc
    except BaseException:
        await session.close()
        raise


async def _watch_login(session: _CodexAppServerSession, login_id: str) -> None:
    """Keep the callback listener alive until login completes or expires."""
    global _login_session, _login_task
    try:
        async with asyncio.timeout(_LOGIN_TIMEOUT_S):
            while True:
                message = await session.next_notification(timeout=_LOGIN_TIMEOUT_S)
                if message.get("method") != "account/login/completed":
                    continue
                params = message.get("params")
                if not isinstance(params, dict):
                    continue
                returned_id = params.get("loginId")
                if returned_id is None or returned_id == login_id:
                    return
    except (TimeoutError, OSError, _CodexProtocolError):
        return
    finally:
        await session.close()
        async with _login_lock:
            if _login_session is session:
                _login_session = None
                _login_task = None
