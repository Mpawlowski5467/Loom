"""PromptCompiler: the main pipeline that assembles, prunes, compresses,
and token-budgets agent prompts before sending them to an LLM.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING

import yaml

from compiler.compressor import compress_item
from compiler.counter import count_tokens
from compiler.models import (
    CompiledPrompt,
    CompilerConfig,
    CompileStats,
    ContextItem,
)
from compiler.pruner import prune_and_rank
from compiler.templates import load_template

if TYPE_CHECKING:
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

DEFAULT_TOKEN_BUDGET = 4000
DEFAULT_PRUNE_THRESHOLD = 0.1


class PromptCompiler:
    """Centralized prompt compilation pipeline for all Loom agents.

    The pipeline runs five stages in order:

    1. **Template** -- load and render the agent's prompt template.
    2. **Prune & Rank** -- score context items by relevance, drop low-scoring ones.
    3. **Compress** -- summarize items that exceed the token threshold.
    4. **Budget** -- truncate context to fit the agent's token budget.
    5. **Version** -- hash the final output for tracking.

    Args:
        vault_root: Root directory of the active vault.
        provider: An LLM provider for compression (``chat()``).
    """

    def __init__(self, vault_root: Path, provider: BaseProvider) -> None:
        self._vault_root = vault_root
        self._provider = provider
        self._config = self._load_config()

    async def compile(
        self,
        agent_name: str,
        template_name: str,
        variables: dict[str, str],
        context_items: list[ContextItem],
    ) -> CompiledPrompt:
        """Run the full compilation pipeline and return the compiled prompt.

        Args:
            agent_name: The agent requesting the prompt (e.g. ``"weaver"``).
            template_name: Template filename without extension.
            variables: Substitution variables for the template.
            context_items: Contextual items to include in the prompt.

        Returns:
            A ``CompiledPrompt`` containing the system message, user message,
            total token count, version hash, and compilation statistics.
        """
        items_provided = len(context_items)
        tokens_before = sum(ci.token_count or count_tokens(ci.content) for ci in context_items)

        # 1. Load and render the template
        system_prompt = load_template(self._vault_root, agent_name, template_name, variables)

        # 2. Prune and rank context items
        ranked = prune_and_rank(context_items, system_prompt, threshold=DEFAULT_PRUNE_THRESHOLD)
        items_pruned = items_provided - len(ranked)

        # 3. Compress long items (if compression is enabled)
        compressed_items, items_compressed = await self._compress_items(ranked)

        # 4. Count tokens and truncate to budget
        budget = self._get_budget(agent_name)
        system_tokens = count_tokens(system_prompt)
        remaining_budget = max(0, budget - system_tokens)
        truncated = self._truncate_to_budget(compressed_items, remaining_budget)

        # 5. Assemble the user message from surviving context items
        user_prompt = self._assemble_user_prompt(truncated)
        total_tokens = count_tokens(system_prompt) + count_tokens(user_prompt)

        # 6. Version tag
        version = self._compute_version(system_prompt, user_prompt)

        stats = CompileStats(
            items_provided=items_provided,
            items_pruned=items_pruned,
            items_compressed=items_compressed,
            tokens_before=tokens_before,
            tokens_after=total_tokens,
        )

        logger.info(
            "Compiled prompt for %s/%s: %d items -> %d kept, %d compressed, %d tokens -> %d tokens",
            agent_name,
            template_name,
            items_provided,
            len(truncated),
            items_compressed,
            tokens_before,
            total_tokens,
        )

        return CompiledPrompt(
            system=system_prompt,
            user=user_prompt,
            token_count=total_tokens,
            version=version,
            stats=stats,
        )

    def _load_config(self) -> CompilerConfig:
        """Load the compiler configuration from ``prompts/_compiler.yaml``.

        Returns:
            Parsed ``CompilerConfig``. Falls back to defaults if the
            config file is missing or unparseable.
        """
        config_path = self._vault_root / "prompts" / "_compiler.yaml"
        if not config_path.exists():
            logger.warning("Compiler config not found at %s — using defaults", config_path)
            return CompilerConfig()

        try:
            data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
            return CompilerConfig.model_validate(data)
        except Exception:
            logger.warning(
                "Failed to parse compiler config at %s — using defaults",
                config_path,
                exc_info=True,
            )
            return CompilerConfig()

    def _get_budget(self, agent_name: str) -> int:
        """Return the token budget for an agent.

        Args:
            agent_name: The agent name to look up.

        Returns:
            Token budget from config, or ``DEFAULT_TOKEN_BUDGET`` if not set.
        """
        return self._config.token_budgets.get(agent_name, DEFAULT_TOKEN_BUDGET)

    async def _compress_items(self, items: list[ContextItem]) -> tuple[list[ContextItem], int]:
        """Compress items that exceed the threshold.

        Args:
            items: Pre-ranked context items.

        Returns:
            Tuple of (processed items, number that were compressed).
        """
        if not self._config.compression.enabled:
            return items, 0

        threshold = self._config.compression.threshold_tokens
        result: list[ContextItem] = []
        compressed_count = 0

        for item in items:
            processed = await compress_item(item, self._provider, threshold=threshold)
            if processed.content != item.content:
                compressed_count += 1
            result.append(processed)

        return result, compressed_count

    def _truncate_to_budget(self, items: list[ContextItem], budget: int) -> list[ContextItem]:
        """Keep items in order until the token budget is exhausted.

        Args:
            items: Ranked context items with token counts.
            budget: Maximum tokens to allocate to context.

        Returns:
            The prefix of items that fits within the budget.
        """
        kept: list[ContextItem] = []
        used = 0

        for item in items:
            tokens = item.token_count or count_tokens(item.content)
            if used + tokens > budget:
                break
            kept.append(item)
            used += tokens

        return kept

    def _assemble_user_prompt(self, items: list[ContextItem]) -> str:
        """Concatenate context items into a single user prompt string.

        Each item is formatted with a source header for traceability.

        Args:
            items: The context items to include.

        Returns:
            A formatted string with all context items.
        """
        if not items:
            return ""

        sections = [f"### Context: {item.source}\n\n{item.content}" for item in items]
        return "\n\n---\n\n".join(sections)

    def _compute_version(self, system: str, user: str) -> str:
        """Compute a SHA-256 hash of the compiled prompt for version tracking.

        Args:
            system: The system prompt text.
            user: The user prompt text.

        Returns:
            A hex-encoded SHA-256 hash string.
        """
        combined = f"{system}\n---\n{user}"
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()
