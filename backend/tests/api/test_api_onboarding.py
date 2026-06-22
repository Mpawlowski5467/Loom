"""Tests for the onboarding router (api/routers/onboarding.py).

Covers the first-run gate: GET /status reflects completion; POST /complete
persists provider + flips the gate; unknown provider → 400; POST /reset clears
the gate. Config is round-tripped through a temp home so load/save are real.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient


@pytest.fixture(autouse=True)
def _temp_config_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point the global config at a temp home so /complete can save it."""
    import core.config as config_mod

    monkeypatch.setattr(config_mod.settings, "loom_home", tmp_path / ".loom")
    yield


class TestOnboardingStatus:
    def test_status_starts_incomplete(self, client: TestClient) -> None:
        resp = client.get("/api/onboarding/status")
        assert resp.status_code == 200
        assert resp.json()["completed"] is False


class TestOnboardingComplete:
    def test_complete_sets_providers_and_gate(self, client: TestClient) -> None:
        """A valid provider becomes default/chat/embed and the gate flips true."""
        payload = {
            "theme": "paper",
            "vault_name": "default",
            "providers": [
                {
                    "name": "openai",
                    "api_key": "sk-test",
                    "chat_model": "gpt-4o",
                    "embed_model": "text-embedding-3-small",
                }
            ],
            "steps_done": ["welcome", "vault", "theme", "provider"],
        }
        resp = client.post("/api/onboarding/complete", json=payload)

        assert resp.status_code == 200
        data = resp.json()
        assert data["onboarding"]["completed"] is True
        # Public config exposes default_provider; chat/embed picks are persisted
        # internally (not in the redacted public view).
        assert data["default_provider"] == "openai"
        assert "openai" in data["providers"]

        # Gate is now reflected by /status too.
        status = client.get("/api/onboarding/status").json()
        assert status["completed"] is True

    def test_complete_with_unknown_provider_returns_400(self, client: TestClient) -> None:
        payload = {
            "vault_name": "default",
            "providers": [{"name": "bogus", "api_key": "x"}],
        }
        resp = client.post("/api/onboarding/complete", json=payload)
        assert resp.status_code == 400
        # HTTPException uses FastAPI's default {"detail": ...} envelope.
        assert "Unknown provider" in resp.json()["detail"]

    def test_complete_with_seed_demo_populates_vault(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``seed_demo`` overlays the demo template's notes onto a new vault."""
        import core.config as config_mod

        # Point the seeder at a hermetic synthetic template.
        demo = tmp_path / "demo-template"
        (demo / "threads" / "topics").mkdir(parents=True)
        (demo / "threads" / "topics" / "seed.md").write_text(
            "---\nid: thr_seed01\ntitle: Seed\ntype: topic\n---\n\nHi.\n"
        )
        monkeypatch.setattr(config_mod.settings, "demo_vault_dir", demo)

        payload = {
            "theme": "paper",
            "vault_name": "demo",
            "seed_demo": True,
            "steps_done": ["welcome", "vault", "theme", "provider"],
        }
        resp = client.post("/api/onboarding/complete", json=payload)
        assert resp.status_code == 200
        assert resp.json()["active_vault"] == "demo"

        vault_root = config_mod.settings.vaults_dir / "demo"
        # Demo note seeded + full scaffold created.
        assert (vault_root / "threads" / "topics" / "seed.md").is_file()
        assert (vault_root / "agents" / "weaver" / "config.yaml").is_file()

        # The in-memory note index was rebuilt for the active vault, so the
        # seeded note is immediately visible (not an empty graph until restart).
        from core.note_index import get_note_index

        assert get_note_index().get_by_id("thr_seed01") is not None

    def test_complete_legacy_single_provider_shape(self, client: TestClient) -> None:
        """The legacy single ``provider`` field is accepted as a one-element list."""
        payload = {
            "vault_name": "default",
            "provider": {"name": "ollama", "host": "http://localhost:11434"},
        }
        resp = client.post("/api/onboarding/complete", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["onboarding"]["completed"] is True
        assert data["default_provider"] == "ollama"


class TestOnboardingReset:
    def test_reset_flips_completed_false(self, client: TestClient) -> None:
        # First complete, then reset.
        client.post(
            "/api/onboarding/complete",
            json={
                "vault_name": "default",
                "providers": [{"name": "openai", "api_key": "sk", "chat_model": "gpt-4o"}],
            },
        )
        assert client.get("/api/onboarding/status").json()["completed"] is True

        resp = client.post("/api/onboarding/reset")
        assert resp.status_code == 200
        assert resp.json()["onboarding"]["completed"] is False
        assert client.get("/api/onboarding/status").json()["completed"] is False
