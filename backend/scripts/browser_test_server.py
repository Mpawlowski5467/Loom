#!/usr/bin/env python3
"""Serve a deterministic, provider-free backend for real browser smoke tests.

The server uses a throwaway ``LOOM_HOME`` and a small in-process provider
fixture. Browser tests therefore exercise the real FastAPI routes, filesystem,
watcher, and React app without reading a user's vault or making paid calls.
"""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, cast


class FixtureProvider:
    """Deterministic chat/embed provider used only by the browser harness."""

    name = "browser-fixture"

    async def embed(self, text: str) -> list[float]:  # noqa: ARG002
        return [0.0] * 8

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:  # noqa: ARG002
        content = "\n".join(str(message.get("content", "")) for message in messages)
        if "BROWSER_PROVIDER_FAILURE" in content:
            from core.exceptions import ProviderError

            raise ProviderError("browser-fixture", "intentional fixture failure")
        if "Ignore structural concerns" in content:
            return "status: passed\nreasons:\n- Browser fixture validation passed"
        if "Classify" in content:
            return (
                "type: topic\nfolder: topics\ntitle: Browser fixture capture\n"
                "tags: browser, fixture"
            )
        return (
            "## Summary\n\nA deterministic browser fixture note.\n\n"
            "## Details\n\nThe real backend handled this capture.\n\n"
            "## References\n\n- [[Browser fixture capture]]\n"
        )


class FixtureRegistry:
    """Minimal registry surface consumed during app startup and processing."""

    def __init__(self) -> None:
        self.provider = FixtureProvider()

    def get_chat_provider(self) -> FixtureProvider:
        return self.provider

    def get_chat_provider_for(self, agent_id: str, **kwargs: Any) -> FixtureProvider:  # noqa: ARG002
        return self.provider

    def get_embed_provider(self) -> FixtureProvider:
        from core.exceptions import ProviderConfigError

        raise ProviderConfigError("browser fixture has no embedding service")

    async def close(self) -> None:
        return None


def _prepare_home(home: Path) -> None:
    """Create a completed, empty vault under the temporary test home."""
    from core.config import GlobalConfig, LoomSettings, OnboardingState
    from core.vault import VaultManager

    settings = LoomSettings(loom_home=home, cors_origins=["http://127.0.0.1:4176"])
    manager = VaultManager(settings)
    manager.init_vault("browser")
    config = GlobalConfig.load(settings.config_path)
    config.active_vault = "browser"
    config.onboarding = OnboardingState(
        completed=True,
        completed_at=datetime.fromisoformat("2026-09-05T00:00:00+00:00"),
        steps_done=["welcome", "vault", "theme", "provider"],
    )
    config.save(settings.config_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    raw_home = Path(tempfile.mkdtemp(prefix="loom-browser-")).resolve()
    os.environ["LOOM_HOME"] = str(raw_home)
    # Keep both the documented and Pydantic-derived names isolated so a local
    # shell export cannot redirect this fixture into a personal vault.
    os.environ["LOOM_LOOM_HOME"] = str(raw_home)
    os.environ["LOOM_CORS_ORIGINS"] = '["http://127.0.0.1:4176"]'
    try:
        _prepare_home(raw_home)

        from core import providers
        from core.providers import registry as registry_module
        from core.providers.registry import ProviderRegistry

        fixture_registry = cast(ProviderRegistry, FixtureRegistry())
        registry_module.get_registry = lambda: fixture_registry
        providers.get_registry = lambda: fixture_registry

        import uvicorn

        from api.main import app

        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    finally:
        shutil.rmtree(raw_home, ignore_errors=True)


if __name__ == "__main__":
    main()
