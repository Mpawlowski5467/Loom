"""BaseAgent: abstract base class for all Loom and Shuttle agents.

Provides the execute_with_chain method that enforces the read-before-write
chain, handles trust-level logic, logs actions, and manages memory.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

import yaml

from agents.chain import ReadChain, ReadChainResult
from agents.changelog import log_action
from agents.memory import summarize_memory
from core.exceptions import ReadChainError
from core.note_index import get_note_index
from core.notes import now_iso

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

DEFAULT_MEMORY_THRESHOLD = 20


class AgentConfig:
    """Parsed agent configuration from config.yaml."""

    def __init__(
        self,
        name: str,
        enabled: bool = True,
        trust_level: str = "standard",
        memory_threshold: int = DEFAULT_MEMORY_THRESHOLD,
    ) -> None:
        self.name = name
        self.enabled = enabled
        self.trust_level = trust_level
        self.memory_threshold = memory_threshold

    @classmethod
    def load(cls, config_path: Path) -> AgentConfig:
        """Load agent config from a YAML file."""
        if not config_path.exists():
            return cls(name="unknown")
        text = config_path.read_text(encoding="utf-8")
        data = yaml.safe_load(text) or {}
        return cls(
            name=data.get("name", "unknown"),
            enabled=data.get("enabled", True),
            trust_level=data.get("trust_level", "standard"),
            memory_threshold=data.get("memory_threshold", DEFAULT_MEMORY_THRESHOLD),
        )


class AgentState:
    """Mutable agent state persisted in state.json."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._data = self._load()

    @property
    def action_count(self) -> int:
        return int(self._data.get("action_count", 0))

    @action_count.setter
    def action_count(self, value: int) -> None:
        self._data["action_count"] = value

    @property
    def last_action(self) -> str | None:
        return self._data.get("last_action")

    @last_action.setter
    def last_action(self, value: str | None) -> None:
        self._data["last_action"] = value

    @property
    def actions_since_summary(self) -> int:
        return int(self._data.get("actions_since_summary", 0))

    @actions_since_summary.setter
    def actions_since_summary(self, value: int) -> None:
        self._data["actions_since_summary"] = value

    def save(self) -> None:
        """Persist state to disk."""
        self._path.write_text(json.dumps(self._data, indent=2) + "\n", encoding="utf-8")

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"action_count": 0, "last_action": None}
        try:
            data: dict[str, Any] = json.loads(self._path.read_text(encoding="utf-8"))
            return data
        except (json.JSONDecodeError, OSError):
            return {"action_count": 0, "last_action": None}


class BaseAgent(ABC):
    """Abstract base class for all Loom agents.

    Subclasses must implement ``name`` and ``role``.
    The ``execute_with_chain`` method enforces the read-before-write
    contract and handles logging/memory automatically.
    """

    def __init__(
        self,
        vault_root: Path,
        chat_provider: BaseProvider | None = None,
    ) -> None:
        self._vault_root = vault_root
        self._chat_provider = chat_provider
        self._agent_dir = vault_root / "agents" / self.name
        self._config = AgentConfig.load(self._agent_dir / "config.yaml")
        self._state = AgentState(self._agent_dir / "state.json")
        self._chain = ReadChain(vault_root, note_index=get_note_index())
        self._memory_cadence = self._load_memory_cadence()

    @property
    @abstractmethod
    def name(self) -> str:
        """Agent identifier (e.g. ``'weaver'``)."""

    @property
    @abstractmethod
    def role(self) -> str:
        """Short description of the agent's role."""

    @property
    def trust_level(self) -> str:
        """Trust level from config: ``'standard'`` or ``'trusted'``."""
        return self._config.trust_level

    @property
    def config(self) -> AgentConfig:
        return self._config

    @property
    def state(self) -> AgentState:
        return self._state

    async def execute_with_chain(
        self,
        target_path: Path,
        action_fn: Callable[[ReadChainResult], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        """Run the read chain, then execute the action if the chain passes.

        Args:
            target_path: File or folder the agent will act on.
            action_fn: Async callable that receives the chain result and
                returns a dict with at least ``action`` and ``details`` keys.

        Returns:
            The action result dict, or an error dict if blocked.

        Raises:
            ReadChainError: If the chain fails for an untrusted agent.
        """
        # Guard: agents cannot modify prime.md
        if self._is_prime_path(target_path):
            logger.error("Agent %s attempted to modify prime.md — BLOCKED", self.name)
            log_action(
                self._vault_root,
                self.name,
                "blocked",
                str(target_path),
                details="Attempted to modify prime.md (immutable)",
                chain_status="fail",
            )
            raise ReadChainError(self.name, ["prime.md is immutable to agents"])

        # Run the read chain
        chain_result = self._chain.execute(self.name, target_path)

        if not chain_result.success:
            failed_names = [s.name for s in chain_result.failed_required]

            if self.trust_level == "trusted":
                # Trusted agents get a warning but proceed
                logger.warning(
                    "Agent %s (trusted): chain failed on [%s] — proceeding with warning",
                    self.name,
                    ", ".join(failed_names),
                )
                chain_status = "warn"
            else:
                # Untrusted agents are hard-blocked
                logger.error(
                    "Agent %s: chain failed on [%s] — BLOCKED",
                    self.name,
                    ", ".join(failed_names),
                )
                log_action(
                    self._vault_root,
                    self.name,
                    "blocked",
                    str(target_path),
                    details=f"Read chain failed: {', '.join(failed_names)}",
                    chain_status="fail",
                )
                raise ReadChainError(self.name, failed_names)
        else:
            chain_status = "pass"

        # Execute the action
        try:
            action_result = await action_fn(chain_result)
        except Exception as exc:
            logger.error("Agent %s action failed: %s", self.name, exc, exc_info=True)
            log_action(
                self._vault_root,
                self.name,
                "error",
                str(target_path),
                details=f"Action failed: {exc}",
                chain_status=chain_status,
            )
            raise

        # Log the action
        action_name = action_result.get("action", "unknown")
        details = action_result.get("details", "")
        log_action(
            self._vault_root,
            self.name,
            action_name,
            str(target_path),
            details=details,
            chain_status=chain_status,
        )

        # Update state
        self._state.action_count += 1
        self._state.actions_since_summary += 1
        self._state.last_action = now_iso()
        self._state.save()

        # Check memory threshold
        if (
            self._state.actions_since_summary >= self._memory_cadence
            and self._chat_provider is not None
        ):
            logger.info(
                "Agent %s hit memory threshold (%d actions since last summary) — summarizing",
                self.name,
                self._state.actions_since_summary,
            )
            try:
                await summarize_memory(self._vault_root, self.name, self._chat_provider)
                self._state.actions_since_summary = 0
                self._state.save()
            except Exception:
                logger.warning(
                    "Memory summarization failed for agent %s",
                    self.name,
                    exc_info=True,
                )

        return action_result

    def _load_memory_cadence(self) -> int:
        """Load memory summarization cadence from vault.yaml, falling back to config."""
        vault_yaml = self._vault_root / "vault.yaml"
        if vault_yaml.exists():
            try:
                data = yaml.safe_load(vault_yaml.read_text(encoding="utf-8")) or {}
                cadence = data.get("memory_summarize_cadence")
                if cadence is not None:
                    return int(cadence)
            except (OSError, yaml.YAMLError, ValueError, TypeError):
                pass
        return self._config.memory_threshold

    def _is_prime_path(self, target_path: Path) -> bool:
        """Check if the target is the immutable prime.md constitution."""
        try:
            resolved = target_path.resolve()
            prime = (self._vault_root / "rules" / "prime.md").resolve()
            return resolved == prime
        except (OSError, RuntimeError):
            return False
