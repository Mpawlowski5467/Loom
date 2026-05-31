"""Tests for user-defined custom Shuttle agents and runner dispatch."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.runner import AgentRunner
from agents.shuttle.custom import CustomAgent, CustomRunResult
from core.notes import parse_note


def _setup_vault(tmp_path: Path) -> Path:
    """Minimal vault that satisfies BaseAgent + the captures/ boundary."""
    root = tmp_path / "vault"
    root.mkdir()
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good.\n", encoding="utf-8")
    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)
    (root / ".loom" / "changelog").mkdir(parents=True, exist_ok=True)
    return root


def _record(**over) -> dict:
    base = {
        "id": "digest",
        "name": "Digest",
        "layer": "shuttle",
        "role": "summarizes the vault",
        "icon": "✦",
        "system_prompt": "You are Digest. Summarize the vault crisply.",
    }
    base.update(over)
    return base


class TestCustomAgent:
    @pytest.mark.asyncio
    async def test_run_without_llm_emits_a_capture(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = CustomAgent(root, _record(), chat_provider=None)

        result = await agent.run()

        assert isinstance(result, CustomRunResult)
        assert result.capture_path
        path = Path(result.capture_path)
        assert path.exists()
        # Lands in captures/ (Shuttle boundary), never in a note folder.
        assert path.parent.name == "captures"

    @pytest.mark.asyncio
    async def test_capture_carries_agent_identity(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = CustomAgent(root, _record(id="digest", name="Digest"), chat_provider=None)

        result = await agent.run()
        note = parse_note(Path(result.capture_path))

        assert note.type == "capture"
        assert note.author == "agent:digest"
        assert "custom-agent" in note.tags
        assert "digest" in note.tags

    @pytest.mark.asyncio
    async def test_run_with_llm_uses_the_system_prompt_and_output(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        provider = AsyncMock()
        provider.chat = AsyncMock(return_value="A crisp summary.")
        agent = CustomAgent(root, _record(), chat_provider=provider)

        result = await agent.run()

        # The agent's own system_prompt drives the call.
        _, kwargs = provider.chat.call_args
        assert "Digest" in kwargs["system"]
        # The model output lands in the capture body.
        assert "A crisp summary." in result.output
        assert "A crisp summary." in Path(result.capture_path).read_text()

    @pytest.mark.asyncio
    async def test_provider_failure_falls_back_to_context(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        from core.exceptions import ProviderError

        provider = AsyncMock()
        provider.chat = AsyncMock(side_effect=ProviderError("openai", "boom"))
        agent = CustomAgent(root, _record(), chat_provider=provider)

        result = await agent.run()
        # Run still yields a reviewable capture rather than throwing.
        assert result.capture_path
        assert Path(result.capture_path).exists()

    @pytest.mark.asyncio
    async def test_name_defaults_when_record_is_sparse(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = CustomAgent(root, {"id": "x"}, chat_provider=None)
        assert agent.name == "x"
        result = await agent.run()
        assert Path(result.capture_path).exists()


class TestRunnerDispatch:
    @pytest.mark.asyncio
    async def test_runner_dispatches_a_registered_custom_agent(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "agents.yaml").write_text(
            yaml.safe_dump({"agents": [_record(id="digest")]}), encoding="utf-8"
        )
        runner = AgentRunner(root)

        result = await runner.run_scheduled("digest")

        assert "error" not in result
        assert result["capture_path"]
        assert Path(result["capture_path"]).exists()

    @pytest.mark.asyncio
    async def test_unknown_agent_still_errors(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        runner = AgentRunner(root)
        result = await runner.run_scheduled("does-not-exist")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_no_agents_file_is_unknown(self, tmp_path: Path):
        root = _setup_vault(tmp_path)  # no agents.yaml written
        runner = AgentRunner(root)
        result = await runner.run_scheduled("digest")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_malformed_agents_yaml_is_handled(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "agents.yaml").write_text("{not: valid: yaml:", encoding="utf-8")
        runner = AgentRunner(root)
        result = await runner.run_scheduled("digest")
        assert "error" in result

    def test_lookup_finds_by_id(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        (root / "agents.yaml").write_text(
            yaml.safe_dump({"agents": [_record(id="a"), _record(id="b", name="B")]}),
            encoding="utf-8",
        )
        runner = AgentRunner(root)
        assert runner._lookup_custom_record("b")["name"] == "B"
        assert runner._lookup_custom_record("missing") is None
