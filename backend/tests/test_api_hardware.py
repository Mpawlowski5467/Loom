"""Tests for api/routers/hardware.py — /api/hardware endpoints."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any
from unittest.mock import patch

import pytest
import yaml

from core.config import GlobalConfig, ProviderConfig
from core.exceptions import ProviderError
from core.hardware import HardwareProfile

if TYPE_CHECKING:
    from pathlib import Path

    from starlette.testclient import TestClient

_PROFILE = HardwareProfile(
    scanned_at="2026-07-05T00:00:00+00:00",
    os="macOS 15 arm64",
    cpu_model="Apple M2",
    cpu_cores=8,
    ram_gb=16.0,
    gpu_name="Apple M2",
    vram_gb=None,
    unified_memory=True,
    notes=[],
)

_OLLAMA_TAGS = [
    {
        "name": "llama3.1:8b",
        "size": 4_700_000_000,
        "details": {"parameter_size": "8.0B"},
    },
    {
        "name": "nomic-embed-text:latest",
        "size": 274_000_000,
        "details": {"parameter_size": "137M"},
    },
]


def _setup_config(tmp_path: Path, cfg: GlobalConfig | None = None) -> Path:
    cfg_path = tmp_path / ".loom" / "config.yaml"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    (cfg or GlobalConfig(active_vault="default")).save(cfg_path)
    return cfg_path


class TestGetHardware:
    def test_returns_fresh_scan_and_null_saved(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/hardware")

        assert resp.status_code == 200
        data = resp.json()
        assert data["profile"]["cpu_model"] == "Apple M2"
        assert data["profile"]["unified_memory"] is True
        assert data["saved"] is None

    def test_returns_saved_profile_when_present(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg = GlobalConfig(active_vault="default", hardware=_PROFILE)
        cfg_path = _setup_config(tmp_path, cfg)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/hardware")

        assert resp.json()["saved"]["ram_gb"] == 16.0


class TestSaveHardware:
    def test_save_without_body_persists_fresh_scan(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post("/api/hardware/save")

        assert resp.status_code == 200
        assert resp.json()["saved"]["cpu_model"] == "Apple M2"
        saved = yaml.safe_load(cfg_path.read_text())
        assert saved["hardware"]["cpu_model"] == "Apple M2"
        assert saved["hardware"]["ram_gb"] == 16.0

    def test_save_with_explicit_profile(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)
        custom = _PROFILE.model_copy(update={"cpu_model": "Custom Box", "ram_gb": 64.0})
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post("/api/hardware/save", json={"profile": custom.model_dump()})

        assert resp.json()["saved"]["cpu_model"] == "Custom Box"
        loaded = GlobalConfig.load(cfg_path)
        assert loaded.hardware is not None
        assert loaded.hardware.ram_gb == 64.0


class TestRecommendations:
    def test_merges_installed_and_curated(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(
            tmp_path,
            GlobalConfig(
                active_vault="default",
                providers={"ollama": ProviderConfig(host="http://localhost:11434")},
            ),
        )
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            return _OLLAMA_TAGS

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/hardware/recommendations")

        assert resp.status_code == 200
        data = resp.json()
        assert data["profile"]["ram_gb"] == 16.0
        by_name = {m["name"]: m for m in data["models"]}

        installed = by_name["llama3.1:8b"]
        assert installed["installed"] is True
        assert installed["size_bytes"] == 4_700_000_000
        assert installed["est_ram_gb"] == 7.5
        assert installed["rating"] == "good"  # 7.5 <= 0.5 * 16

        # Curated models fill the gaps, deduped against installed ones
        # (nomic-embed-text:latest suppresses the curated nomic-embed-text).
        assert "qwen2.5:7b" in by_name
        assert by_name["qwen2.5:7b"]["installed"] is False
        assert "nomic-embed-text" not in by_name
        assert "nomic-embed-text:latest" in by_name

        for m in data["models"]:
            assert m["rating"] in {"good", "okay", "heavy"}

    def test_marks_best_chat_and_embed(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            return _OLLAMA_TAGS

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/hardware/recommendations").json()

        chat_recs = [m for m in data["models"] if m["recommended_for"] == ["chat"]]
        embed_recs = [m for m in data["models"] if m["recommended_for"] == ["embed"]]
        assert len(chat_recs) == 1
        assert len(embed_recs) == 1
        assert chat_recs[0]["rating"] == "good"
        assert embed_recs[0]["rating"] == "good"
        # Installed models win the recommendation tiebreak.
        assert chat_recs[0]["name"] == "llama3.1:8b"
        assert embed_recs[0]["name"] == "nomic-embed-text:latest"

    def test_ollama_down_still_returns_curated(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            raise ConnectionError("refused")

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/hardware/recommendations").json()

        assert data["models"]
        assert all(m["installed"] is False for m in data["models"])

    def test_saved_profile_preferred_over_fresh_scan(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        saved = _PROFILE.model_copy(update={"ram_gb": 128.0, "cpu_model": "Saved Box"})
        cfg_path = _setup_config(tmp_path, GlobalConfig(hardware=saved))
        monkeypatch.setattr("api.routers.hardware.scan_hardware", lambda: _PROFILE)

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            return []

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/hardware/recommendations").json()

        assert data["profile"]["cpu_model"] == "Saved Box"

    def test_recommends_role_specific_installed_models_for_builtins(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        roomy = _PROFILE.model_copy(update={"ram_gb": 48.0, "cpu_model": "Apple M5 Pro"})
        cfg_path = _setup_config(tmp_path, GlobalConfig(hardware=roomy))

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            return [
                {
                    "name": "devstral:latest",
                    "size": 14_000_000_000,
                    "details": {"parameter_size": "24B"},
                },
                {
                    "name": "gpt-oss:20b",
                    "size": 13_000_000_000,
                    "details": {"parameter_size": "20B"},
                },
                {
                    "name": "mistral-small3.1:latest",
                    "size": 14_000_000_000,
                    "details": {"parameter_size": "24B"},
                },
                _OLLAMA_TAGS[1],
            ]

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/hardware/recommendations").json()

        by_id = {agent["agent_id"]: agent for agent in data["agents"]}
        assert set(by_id) == {
            "weaver",
            "spider",
            "archivist",
            "scribe",
            "sentinel",
            "researcher",
            "standup",
        }
        assert by_id["weaver"]["model"] == "devstral:latest"
        assert by_id["spider"]["model"] == "devstral:latest"
        assert by_id["sentinel"]["model"] == "gpt-oss:20b"
        assert by_id["scribe"]["model"] == "mistral-small3.1:latest"
        assert by_id["researcher"]["model"] == "mistral-small3.1:latest"
        assert by_id["standup"]["model"] == "mistral-small3.1:latest"
        assert by_id["archivist"]["model"] is None
        assert by_id["archivist"]["installed"] is False
        assert "no model required" in by_id["archivist"]["reason"].lower()

        for recommendation in by_id.values():
            assert recommendation["provider"] == "ollama"
            assert recommendation["source"] == "catalog"
            assert recommendation["confidence"] == "provisional"
        assert by_id["weaver"]["rating"] == "good"
        assert by_id["weaver"]["installed"] is True
        assert len(by_id["weaver"]["alternatives"]) <= 2

    def test_okay_models_are_manual_alternatives_not_primary_recommendations(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path, GlobalConfig(hardware=_PROFILE))

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            return [
                {
                    "name": "qwen2.5:14b",
                    "size": 9_000_000_000,
                    "details": {"parameter_size": "14.8B"},
                }
            ]

        monkeypatch.setattr("api.routers.hardware.fetch_ollama_tags", fake_tags)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/hardware/recommendations").json()

        by_id = {agent["agent_id"]: agent for agent in data["agents"]}
        sentinel = by_id["sentinel"]
        assert sentinel["model"] is None
        assert sentinel["rating"] is None
        assert sentinel["installed"] is False
        assert sentinel["alternatives"] == ["qwen2.5:14b"]
        assert "manual opt-in" in sentinel["reason"]


class _StubProvider:
    def __init__(
        self,
        response: str = "ready",
        error: Exception | None = None,
        delay_s: float = 0.0,
    ) -> None:
        self._response = response
        self._error = error
        self._delay_s = delay_s
        self.closed = False
        self.calls: list[list[dict[str, Any]]] = []

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:  # noqa: ARG002
        self.calls.append(messages)
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._error is not None:
            raise self._error
        return self._response

    async def close(self) -> None:
        self.closed = True


class TestBenchmark:
    def _patch(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cfg_path: Path,
        stub: _StubProvider,
    ) -> None:
        captured: list[Any] = []

        def fake_build(p: Any) -> _StubProvider:
            captured.append(p)
            return stub

        monkeypatch.setattr("api.routers.hardware.build_provider_from_input", fake_build)
        self.captured = captured

    def test_ok_path(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(
            tmp_path,
            GlobalConfig(providers={"ollama": ProviderConfig(host="http://localhost:11434")}),
        )
        stub = _StubProvider(response="ready")
        self._patch(monkeypatch, cfg_path, stub)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post(
                "/api/hardware/benchmark",
                json={"provider": "ollama", "model": "qwen2.5:7b"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["chars"] == len("ready")
        assert data["chars_per_sec"] > 0
        assert data["error"] is None
        assert stub.closed is True
        # The requested model is threaded into the unregistered provider.
        assert self.captured[0].chat_model == "qwen2.5:7b"
        assert "ready" in stub.calls[0][0]["content"]

    def test_provider_error_inline(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        stub = _StubProvider(error=ProviderError("ollama", "model not found"))
        self._patch(monkeypatch, cfg_path, stub)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post(
                "/api/hardware/benchmark",
                json={"provider": "ollama", "model": "missing"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "model not found" in data["error"]
        assert stub.closed is True

    def test_timeout_path(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)
        stub = _StubProvider(delay_s=0.2)
        self._patch(monkeypatch, cfg_path, stub)
        monkeypatch.setattr("api.routers.hardware._BENCHMARK_TIMEOUT_S", 0.01)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post(
                "/api/hardware/benchmark",
                json={"provider": "ollama", "model": "slow"},
            )

        data = resp.json()
        assert data["ok"] is False
        assert "Timed out" in data["error"]
        assert stub.closed is True

    def test_unknown_provider_404(self, client: TestClient, tmp_path: Path) -> None:
        cfg_path = _setup_config(tmp_path)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post("/api/hardware/benchmark", json={"provider": "nope", "model": "x"})
        assert resp.status_code == 404

    def test_unbuildable_provider_inline_error(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)  # openai has no key configured
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with patch("api.routers.hardware.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.post(
                "/api/hardware/benchmark", json={"provider": "openai", "model": "gpt-4o"}
            )

        data = resp.json()
        assert resp.status_code == 200
        assert data["ok"] is False
        assert data["error"]
