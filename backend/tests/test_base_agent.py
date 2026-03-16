"""Tests for agents/base.py — BaseAgent with execute_with_chain."""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.base import AgentConfig, AgentState, BaseAgent
from agents.chain import ReadChainResult
from core.exceptions import ReadChainError
from core.notes import build_frontmatter


def _setup_vault(tmp_path: Path, trust_level: str = "standard") -> Path:
    """Create a vault with structure needed for agent tests."""
    root = tmp_path / "vault"
    root.mkdir()

    # vault.yaml
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")

    # rules/prime.md
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good.\n", encoding="utf-8")

    # agents/testbot/
    agent_dir = root / "agents" / "testbot"
    agent_dir.mkdir(parents=True)
    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "name": "testbot",
                "enabled": True,
                "trust_level": trust_level,
                "memory_threshold": 3,  # Low threshold for testing
            }
        ),
        encoding="utf-8",
    )
    (agent_dir / "memory.md").write_text("# Memory\n\nEmpty.\n", encoding="utf-8")
    (agent_dir / "state.json").write_text(
        json.dumps({"action_count": 0, "last_action": None}), encoding="utf-8"
    )
    (agent_dir / "logs").mkdir()

    # .loom/changelog/testbot/
    (root / ".loom" / "changelog" / "testbot").mkdir(parents=True)

    # threads/
    topics = root / "threads" / "topics"
    topics.mkdir(parents=True)
    meta = {
        "id": "thr_test00",
        "title": "Test Note",
        "type": "topic",
        "tags": [],
        "status": "active",
    }
    (topics / "test-note.md").write_text(
        build_frontmatter(meta) + "\nTest content.\n", encoding="utf-8"
    )

    return root


class _StubAgent(BaseAgent):
    """Concrete stub agent for testing BaseAgent."""

    @property
    def name(self) -> str:
        return "testbot"

    @property
    def role(self) -> str:
        return "test agent"


class TestAgentConfig:
    def test_load_config(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        config = AgentConfig.load(root / "agents" / "testbot" / "config.yaml")
        assert config.name == "testbot"
        assert config.enabled is True
        assert config.trust_level == "standard"
        assert config.memory_threshold == 3

    def test_missing_config_defaults(self, tmp_path: Path):
        config = AgentConfig.load(tmp_path / "nonexistent.yaml")
        assert config.name == "unknown"
        assert config.trust_level == "standard"

    def test_trust_level_from_config(self, tmp_path: Path):
        root = _setup_vault(tmp_path, trust_level="trusted")
        config = AgentConfig.load(root / "agents" / "testbot" / "config.yaml")
        assert config.trust_level == "trusted"


class TestAgentState:
    def test_load_state(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        state = AgentState(root / "agents" / "testbot" / "state.json")
        assert state.action_count == 0
        assert state.last_action is None

    def test_save_state(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        state_path = root / "agents" / "testbot" / "state.json"
        state = AgentState(state_path)
        state.action_count = 5
        state.last_action = "2026-03-15T00:00:00+00:00"
        state.save()

        reloaded = AgentState(state_path)
        assert reloaded.action_count == 5
        assert reloaded.last_action == "2026-03-15T00:00:00+00:00"


class TestBaseAgent:
    @pytest.mark.asyncio
    async def test_execute_with_chain_success(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)
        target = root / "threads" / "topics" / "test-note.md"

        async def action(chain_result: ReadChainResult) -> dict:
            assert chain_result.success
            return {"action": "created", "details": "Test action"}

        result = await agent.execute_with_chain(target, action)
        assert result["action"] == "created"
        assert agent.state.action_count == 1
        assert agent.state.last_action is not None

    @pytest.mark.asyncio
    async def test_untrusted_blocked_on_chain_failure(self, tmp_path: Path):
        root = _setup_vault(tmp_path, trust_level="standard")
        # Remove prime.md to cause chain failure
        (root / "rules" / "prime.md").unlink()

        agent = _StubAgent(root)
        target = root / "threads" / "topics"

        async def action(chain_result: ReadChainResult) -> dict:
            return {"action": "created", "details": "Should not reach here"}

        with pytest.raises(ReadChainError) as exc_info:
            await agent.execute_with_chain(target, action)

        assert "prime.md" in exc_info.value.failed_steps
        # Action count should NOT increment on block
        assert agent.state.action_count == 0

    @pytest.mark.asyncio
    async def test_trusted_warns_on_chain_failure(self, tmp_path: Path):
        root = _setup_vault(tmp_path, trust_level="trusted")
        # Remove prime.md
        (root / "rules" / "prime.md").unlink()

        agent = _StubAgent(root)
        target = root / "threads" / "topics"

        action_called = False

        async def action(chain_result: ReadChainResult) -> dict:
            nonlocal action_called
            action_called = True
            assert not chain_result.success  # Chain failed, but we still proceed
            return {"action": "created", "details": "Trusted agent proceeded"}

        result = await agent.execute_with_chain(target, action)
        assert action_called
        assert result["action"] == "created"
        assert agent.state.action_count == 1

    @pytest.mark.asyncio
    async def test_actions_logged_to_changelog(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)
        target = root / "threads" / "topics" / "test-note.md"

        async def action(chain_result: ReadChainResult) -> dict:
            return {"action": "linked", "details": "Added wikilink"}

        await agent.execute_with_chain(target, action)

        # Check changelog
        changelog_dir = root / ".loom" / "changelog" / "testbot"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Action:** linked" in content
        assert "**Chain:** pass" in content

        # Check agent logs
        logs_dir = root / "agents" / "testbot" / "logs"
        files = list(logs_dir.glob("*.md"))
        assert len(files) == 1

    @pytest.mark.asyncio
    async def test_blocked_action_logged(self, tmp_path: Path):
        root = _setup_vault(tmp_path, trust_level="standard")
        (root / "rules" / "prime.md").unlink()

        agent = _StubAgent(root)
        target = root / "threads" / "topics"

        async def action(chain_result: ReadChainResult) -> dict:
            return {"action": "created", "details": "unreachable"}

        with pytest.raises(ReadChainError):
            await agent.execute_with_chain(target, action)

        # Blocked action should be logged with chain_status="fail"
        changelog_dir = root / ".loom" / "changelog" / "testbot"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Action:** blocked" in content
        assert "**Chain:** fail" in content

    @pytest.mark.asyncio
    async def test_memory_summarization_at_threshold(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="## Patterns\n\nDoes test things.\n")

        agent = _StubAgent(root, chat_provider=chat_mock)
        target = root / "threads" / "topics" / "test-note.md"

        # memory_threshold is 3, so after 3 actions, memory should be summarized
        for i in range(3):

            async def action(chain_result: ReadChainResult, idx=i) -> dict:
                return {"action": "created", "details": f"Action {idx}"}

            await agent.execute_with_chain(target, action)

        assert agent.state.action_count == 3
        # Chat provider should have been called for summarization
        assert chat_mock.chat.called

        # memory.md should be updated
        memory = (root / "agents" / "testbot" / "memory.md").read_text(encoding="utf-8")
        assert "Last summarized" in memory
        assert "Patterns" in memory

    @pytest.mark.asyncio
    async def test_no_summarization_without_chat_provider(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)  # No chat_provider
        target = root / "threads" / "topics" / "test-note.md"

        for i in range(3):

            async def action(chain_result: ReadChainResult, idx=i) -> dict:
                return {"action": "created", "details": f"Action {idx}"}

            await agent.execute_with_chain(target, action)

        # Memory should NOT be updated (no chat provider)
        memory = (root / "agents" / "testbot" / "memory.md").read_text(encoding="utf-8")
        assert "Last summarized" not in memory

    @pytest.mark.asyncio
    async def test_state_persists_across_actions(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)
        target = root / "threads" / "topics" / "test-note.md"

        async def action(chain_result: ReadChainResult) -> dict:
            return {"action": "edited", "details": "Updated content"}

        await agent.execute_with_chain(target, action)
        await agent.execute_with_chain(target, action)

        # Reload state from disk
        reloaded = json.loads(
            (root / "agents" / "testbot" / "state.json").read_text(encoding="utf-8")
        )
        assert reloaded["action_count"] == 2
        assert reloaded["last_action"] is not None

    @pytest.mark.asyncio
    async def test_prime_md_immutability(self, tmp_path: Path):
        """Agents cannot target prime.md for modification."""
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)
        target = root / "rules" / "prime.md"

        async def action(chain_result: ReadChainResult) -> dict:
            return {"action": "edited", "details": "Should not reach here"}

        with pytest.raises(ReadChainError) as exc_info:
            await agent.execute_with_chain(target, action)

        assert "immutable" in str(exc_info.value).lower() or "prime" in str(exc_info.value).lower()
        # Action count should NOT increment
        assert agent.state.action_count == 0

    @pytest.mark.asyncio
    async def test_action_fn_error_logged(self, tmp_path: Path):
        """If action_fn raises, the error is logged and re-raised."""
        root = _setup_vault(tmp_path)
        agent = _StubAgent(root)
        target = root / "threads" / "topics" / "test-note.md"

        async def failing_action(chain_result: ReadChainResult) -> dict:
            raise ValueError("Something went wrong")

        with pytest.raises(ValueError, match="Something went wrong"):
            await agent.execute_with_chain(target, failing_action)

        # Error should be logged in changelog
        changelog_dir = root / ".loom" / "changelog" / "testbot"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Action:** error" in content
