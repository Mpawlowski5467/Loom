"""Tests for the Prompt Compiler pipeline."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest

from compiler.compiler import DEFAULT_TOKEN_BUDGET, PromptCompiler
from compiler.compressor import compress_item
from compiler.counter import _approximate_token_count, count_tokens
from compiler.models import ContextItem
from compiler.pruner import prune_and_rank, score_relevance
from compiler.templates import (
    TemplateNotFoundError,
    load_template,
    strip_frontmatter,
    substitute_variables,
)

if TYPE_CHECKING:
    from pathlib import Path

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def vault_root(tmp_path: Path) -> Path:
    """Create a minimal vault structure with prompts and compiler config."""
    root = tmp_path / "vault"
    root.mkdir()

    # Create _compiler.yaml
    prompts = root / "prompts"
    prompts.mkdir()
    (prompts / "_compiler.yaml").write_text(
        "token_budgets:\n"
        "  weaver: 4000\n"
        "  spider: 3000\n"
        "  tiny: 200\n"
        "\n"
        "compression:\n"
        "  enabled: true\n"
        "  threshold_tokens: 2000\n"
        "  strategy: summarize\n"
        "\n"
        "output_format:\n"
        "  version_tag: true\n"
        "  include_metadata: true\n"
    )

    # Create a weaver template
    weaver_prompts = prompts / "weaver"
    weaver_prompts.mkdir()
    (weaver_prompts / "create.md").write_text(
        "---\n"
        "name: create\n"
        "description: Create a new note\n"
        "---\n"
        "You are the Weaver agent. Create a new {{note_type}} note titled {{title}}.\n"
        "\n"
        "Use atomic notes and [[wikilinks]] for references.\n"
    )

    # Create a spider template (no frontmatter)
    spider_prompts = prompts / "spider"
    spider_prompts.mkdir()
    (spider_prompts / "link.md").write_text(
        "You are the Spider agent. Find links for the note about {{topic}}.\n"
    )

    # Create a tiny-budget agent template for truncation tests
    tiny_prompts = prompts / "tiny"
    tiny_prompts.mkdir()
    (tiny_prompts / "create.md").write_text("Short prompt for {{note_type}} titled {{title}}.\n")

    return root


@pytest.fixture()
def mock_provider() -> AsyncMock:
    """Return a mock LLM provider."""
    provider = AsyncMock()
    provider.chat = AsyncMock(return_value="Compressed summary of the content.")
    return provider


# ---------------------------------------------------------------------------
# Token Counting
# ---------------------------------------------------------------------------


class TestTokenCounting:
    """Tests for compiler.counter."""

    def test_count_tokens_returns_positive_for_nonempty(self) -> None:
        """Non-empty text produces a positive token count."""
        result = count_tokens("Hello, world!")
        assert result > 0

    def test_count_tokens_empty_string(self) -> None:
        """Empty string should return zero tokens."""
        assert count_tokens("") == 0

    def test_count_tokens_consistency(self) -> None:
        """Same input produces the same count."""
        text = "The quick brown fox jumps over the lazy dog."
        assert count_tokens(text) == count_tokens(text)

    def test_count_tokens_longer_text_more_tokens(self) -> None:
        """Longer text should produce more tokens."""
        short = "Hello"
        long_text = "Hello " * 100
        assert count_tokens(long_text) > count_tokens(short)

    def test_approximate_token_count_empty(self) -> None:
        """Approximate counter returns 0 for empty string."""
        assert _approximate_token_count("") == 0

    def test_approximate_token_count_short(self) -> None:
        """Approximate counter returns at least 1 for non-empty text."""
        assert _approximate_token_count("Hi") >= 1

    def test_approximate_token_count_ratio(self) -> None:
        """Approximate counter is roughly chars / 4."""
        text = "a" * 400
        result = _approximate_token_count(text)
        assert result == 100


# ---------------------------------------------------------------------------
# Template Loading
# ---------------------------------------------------------------------------


class TestTemplates:
    """Tests for compiler.templates."""

    def test_load_template_with_frontmatter(self, vault_root: Path) -> None:
        """Template with YAML frontmatter should strip it and substitute vars."""
        result = load_template(
            vault_root,
            "weaver",
            "create",
            {"note_type": "topic", "title": "Machine Learning"},
        )
        assert "---" not in result
        assert "topic" in result
        assert "Machine Learning" in result
        assert "Weaver agent" in result

    def test_load_template_without_frontmatter(self, vault_root: Path) -> None:
        """Template without frontmatter should still substitute vars."""
        result = load_template(
            vault_root,
            "spider",
            "link",
            {"topic": "distributed systems"},
        )
        assert "distributed systems" in result
        assert "Spider agent" in result

    def test_load_template_missing_raises(self, vault_root: Path) -> None:
        """Missing template file raises TemplateNotFoundError."""
        with pytest.raises(TemplateNotFoundError):
            load_template(vault_root, "weaver", "nonexistent", {})

    def test_substitute_variables_missing_key_preserved(self) -> None:
        """Placeholders without matching vars stay in the output."""
        result = substitute_variables("Hello {{name}}, welcome to {{place}}!", {"name": "Alice"})
        assert "Alice" in result
        assert "{{place}}" in result

    def test_strip_frontmatter_no_frontmatter(self) -> None:
        """Text without frontmatter is returned unchanged."""
        text = "Just some text"
        assert strip_frontmatter(text) == text

    def test_strip_frontmatter_with_frontmatter(self) -> None:
        """Frontmatter is stripped, body is preserved."""
        text = "---\ntitle: test\n---\nBody here"
        result = strip_frontmatter(text)
        assert "title" not in result
        assert "Body here" in result


# ---------------------------------------------------------------------------
# Pruning & Ranking
# ---------------------------------------------------------------------------


class TestPruner:
    """Tests for compiler.pruner."""

    def test_score_relevance_high_overlap(self) -> None:
        """Item with many shared words should score high."""
        item = ContextItem(
            content="Machine learning models neural networks deep learning",
            source="topics/ml.md",
        )
        query = "machine learning and neural networks"
        score = score_relevance(item, query)
        assert score > 0.5

    def test_score_relevance_no_overlap(self) -> None:
        """Item with no shared words should score zero."""
        item = ContextItem(
            content="cooking recipes pasta sauce ingredients",
            source="captures/recipe.md",
        )
        query = "quantum physics experiments"
        score = score_relevance(item, query)
        assert score == 0.0

    def test_score_relevance_empty_query(self) -> None:
        """Empty query returns 0.0."""
        item = ContextItem(content="anything", source="test.md")
        assert score_relevance(item, "") == 0.0

    def test_prune_removes_low_relevance(self) -> None:
        """Items below the threshold are removed."""
        items = [
            ContextItem(content="relevant topic machine learning", source="a.md"),
            ContextItem(content="completely unrelated cooking recipe", source="b.md"),
            ContextItem(content="machine learning deep neural", source="c.md"),
        ]
        query = "machine learning neural networks"
        result = prune_and_rank(items, query, threshold=0.1)

        sources = [item.source for item in result]
        assert "a.md" in sources
        assert "c.md" in sources
        # b.md should be pruned since "cooking recipe" has no overlap with the query
        assert "b.md" not in sources

    def test_prune_ranking_order(self) -> None:
        """Kept items are sorted by relevance descending."""
        items = [
            ContextItem(content="machine", source="low.md"),
            ContextItem(content="machine learning neural networks deep", source="high.md"),
            ContextItem(content="machine learning", source="mid.md"),
        ]
        query = "machine learning neural networks deep"
        result = prune_and_rank(items, query, threshold=0.0)

        assert len(result) >= 2
        # First item should have the highest relevance
        assert result[0].relevance >= result[-1].relevance

    def test_prune_sets_relevance_on_items(self) -> None:
        """Returned items have their relevance field populated."""
        items = [ContextItem(content="machine learning topic", source="a.md")]
        query = "machine learning"
        result = prune_and_rank(items, query, threshold=0.0)
        assert result[0].relevance > 0.0


# ---------------------------------------------------------------------------
# Compression
# ---------------------------------------------------------------------------


class TestCompressor:
    """Tests for compiler.compressor."""

    @pytest.mark.asyncio()
    async def test_compress_below_threshold_unchanged(self, mock_provider: AsyncMock) -> None:
        """Item below threshold is returned without calling the provider."""
        item = ContextItem(content="Short text", source="test.md", token_count=10)
        result = await compress_item(item, mock_provider, threshold=2000)

        assert result.content == "Short text"
        mock_provider.chat.assert_not_called()

    @pytest.mark.asyncio()
    async def test_compress_above_threshold_calls_provider(self, mock_provider: AsyncMock) -> None:
        """Item above threshold triggers provider compression."""
        long_content = "word " * 3000  # Well above 2000 tokens
        item = ContextItem(content=long_content, source="long.md")
        result = await compress_item(item, mock_provider, threshold=100)

        mock_provider.chat.assert_called_once()
        assert result.content == "Compressed summary of the content."
        assert result.token_count is not None
        assert result.token_count > 0

    @pytest.mark.asyncio()
    async def test_compress_preserves_wikilinks(self, mock_provider: AsyncMock) -> None:
        """Wikilinks from the original are restored if dropped by compression."""
        original = "Content about [[ProjectA]] and [[TopicB]] " + "padding " * 500
        mock_provider.chat = AsyncMock(return_value="Compressed content about [[ProjectA]].")
        item = ContextItem(content=original, source="test.md")
        result = await compress_item(item, mock_provider, threshold=100)

        # TopicB was dropped by the mock, so it should be restored
        assert "[[TopicB]]" in result.content
        assert "[[ProjectA]]" in result.content

    @pytest.mark.asyncio()
    async def test_compress_provider_failure_returns_original(
        self, mock_provider: AsyncMock
    ) -> None:
        """If the provider raises, the original item is returned."""
        mock_provider.chat = AsyncMock(side_effect=RuntimeError("API down"))
        long_content = "word " * 3000
        item = ContextItem(content=long_content, source="test.md")
        result = await compress_item(item, mock_provider, threshold=100)

        assert result.content == long_content


# ---------------------------------------------------------------------------
# Full Pipeline
# ---------------------------------------------------------------------------


class TestPromptCompiler:
    """Tests for the full PromptCompiler pipeline."""

    @pytest.mark.asyncio()
    async def test_compile_basic(self, vault_root: Path, mock_provider: AsyncMock) -> None:
        """Full pipeline produces a CompiledPrompt with expected fields."""
        compiler = PromptCompiler(vault_root, mock_provider)
        context = [
            ContextItem(
                content="Machine learning is a branch of AI.",
                source="topics/ml.md",
            ),
            ContextItem(
                content="Weaver creates new notes in the vault.",
                source="agents/weaver/memory.md",
            ),
        ]

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "topic", "title": "ML Overview"},
            context_items=context,
        )

        assert result.system
        assert "Weaver agent" in result.system
        assert "topic" in result.system
        assert "ML Overview" in result.system
        assert result.token_count > 0
        assert len(result.version) == 64  # SHA-256 hex
        assert result.stats.items_provided == 2
        assert result.stats.tokens_before > 0
        assert result.stats.tokens_after > 0

    @pytest.mark.asyncio()
    async def test_compile_prunes_irrelevant(
        self, vault_root: Path, mock_provider: AsyncMock
    ) -> None:
        """Irrelevant context items are pruned from the output."""
        compiler = PromptCompiler(vault_root, mock_provider)
        context = [
            ContextItem(
                content="Create new note weaver vault wikilinks atomic",
                source="relevant.md",
            ),
            ContextItem(
                content="basketball scores championship playoffs tournament",
                source="irrelevant.md",
            ),
        ]

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "topic", "title": "Notes"},
            context_items=context,
        )

        assert result.stats.items_pruned >= 1

    @pytest.mark.asyncio()
    async def test_compile_version_deterministic(
        self, vault_root: Path, mock_provider: AsyncMock
    ) -> None:
        """Same inputs produce the same version hash."""
        compiler = PromptCompiler(vault_root, mock_provider)
        context = [
            ContextItem(content="Some context here.", source="test.md"),
        ]
        variables = {"note_type": "topic", "title": "Test"}

        r1 = await compiler.compile("weaver", "create", variables, context)
        r2 = await compiler.compile("weaver", "create", variables, context)

        assert r1.version == r2.version

    @pytest.mark.asyncio()
    async def test_compile_truncates_to_budget(
        self, vault_root: Path, mock_provider: AsyncMock
    ) -> None:
        """Context exceeding the token budget is truncated."""
        compiler = PromptCompiler(vault_root, mock_provider)

        # "tiny" agent has a 200-token budget; generate context that
        # exceeds it. Create many items so at least some must be dropped.
        context = [
            ContextItem(
                content=f"spider link find agent topic note vault wikilinks item {i} " * 20,
                source=f"item_{i}.md",
            )
            for i in range(20)
        ]

        result = await compiler.compile(
            agent_name="tiny",
            template_name="create",
            variables={"note_type": "topic", "title": "Test"},
            context_items=context,
        )

        # The total token count should stay within a reasonable range of
        # the budget; it might not be exactly at the limit because the
        # system prompt itself consumes tokens from the budget.
        budget = 200
        # If no items fit, user prompt may be empty and total is just system
        assert result.token_count <= budget + count_tokens(result.system) + 50

    @pytest.mark.asyncio()
    async def test_compile_empty_context(self, vault_root: Path, mock_provider: AsyncMock) -> None:
        """Compiling with zero context items still produces a valid prompt."""
        compiler = PromptCompiler(vault_root, mock_provider)

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "daily", "title": "2026-03-15"},
            context_items=[],
        )

        assert result.system
        assert result.user == ""
        assert result.stats.items_provided == 0
        assert result.stats.items_pruned == 0

    @pytest.mark.asyncio()
    async def test_compile_missing_config_uses_defaults(
        self, tmp_path: Path, mock_provider: AsyncMock
    ) -> None:
        """Missing _compiler.yaml falls back to defaults without error."""
        root = tmp_path / "empty_vault"
        root.mkdir()
        prompts = root / "prompts" / "weaver"
        prompts.mkdir(parents=True)
        (prompts / "create.md").write_text("Simple prompt about {{topic}}.")

        compiler = PromptCompiler(root, mock_provider)

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"topic": "testing"},
            context_items=[],
        )

        assert result.system == "Simple prompt about testing."
        assert result.token_count > 0

    @pytest.mark.asyncio()
    async def test_compile_default_budget_for_unknown_agent(
        self, vault_root: Path, mock_provider: AsyncMock
    ) -> None:
        """Agent not in token_budgets config gets the default budget."""
        compiler = PromptCompiler(vault_root, mock_provider)
        assert compiler._get_budget("unknown_agent") == DEFAULT_TOKEN_BUDGET


# ---------------------------------------------------------------------------
# End-to-end pipeline with template + context
# ---------------------------------------------------------------------------


class TestCompilerEndToEnd:
    """Integration tests that exercise the full compile pipeline
    with on-disk templates and mock providers."""

    @pytest.fixture()
    def e2e_vault(self, tmp_path: Path) -> Path:
        """Create a vault with templates and compiler config for e2e tests."""
        root = tmp_path / "e2e_vault"
        root.mkdir()

        # prompts/_compiler.yaml
        prompts = root / "prompts"
        prompts.mkdir()
        (prompts / "_compiler.yaml").write_text(
            "token_budgets:\n"
            "  weaver: 4000\n"
            "  scribe: 2000\n"
            "\n"
            "compression:\n"
            "  enabled: true\n"
            "  threshold_tokens: 500\n"
            "  strategy: summarize\n"
            "\n"
            "output_format:\n"
            "  version_tag: true\n"
            "  include_metadata: true\n"
        )

        # weaver/create.md template
        weaver_dir = prompts / "weaver"
        weaver_dir.mkdir()
        (weaver_dir / "create.md").write_text(
            "---\n"
            "name: create\n"
            "description: Create a note from capture\n"
            "---\n"
            "You are the Weaver. Create a {{note_type}} note titled {{title}}.\n"
            "\n"
            "Use [[wikilinks]] for all references.\n"
        )

        # scribe/summarize.md template
        scribe_dir = prompts / "scribe"
        scribe_dir.mkdir()
        (scribe_dir / "summarize.md").write_text(
            "---\n"
            "name: summarize\n"
            "description: Summarize vault content\n"
            "---\n"
            "You are the Scribe. Summarize the following content about {{topic}}.\n"
            "\n"
            "Be concise. Preserve all [[wikilinks]].\n"
        )

        return root

    @pytest.mark.asyncio()
    async def test_full_pipeline_with_context(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """Template + multiple context items produces a structured CompiledPrompt."""
        compiler = PromptCompiler(e2e_vault, mock_provider)
        context = [
            ContextItem(
                content="Weaver creates new notes using atomic note methodology.",
                source="agents/weaver/memory.md",
            ),
            ContextItem(
                content="Projects should follow the milestone template in schemas/.",
                source="rules/schemas/project.md",
            ),
        ]

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "project", "title": "Alpha Launch"},
            context_items=context,
        )

        # System prompt from template
        assert "Weaver" in result.system
        assert "project" in result.system
        assert "Alpha Launch" in result.system

        # User prompt has context sections
        assert "agents/weaver/memory.md" in result.user
        assert result.token_count > 0
        assert result.stats.items_provided == 2
        assert result.stats.tokens_before > 0
        assert result.stats.tokens_after > 0

    @pytest.mark.asyncio()
    async def test_compression_triggered_for_large_items(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """Items above compression threshold trigger the provider."""
        compiler = PromptCompiler(e2e_vault, mock_provider)

        # threshold_tokens is 500 in the e2e config
        large_content = "wikilinks vault note topic weaver scribe " * 200
        context = [
            ContextItem(content=large_content, source="large-doc.md"),
            ContextItem(
                content="Short relevant context about wikilinks.",
                source="short.md",
            ),
        ]

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "topic", "title": "Test"},
            context_items=context,
        )

        # The large item should have been compressed (provider called)
        assert mock_provider.chat.called
        assert result.stats.items_compressed >= 1

    @pytest.mark.asyncio()
    async def test_different_agents_get_different_budgets(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """weaver has 4000 budget, scribe has 2000."""
        compiler = PromptCompiler(e2e_vault, mock_provider)

        assert compiler._get_budget("weaver") == 4000
        assert compiler._get_budget("scribe") == 2000
        assert compiler._get_budget("sentinel") == DEFAULT_TOKEN_BUDGET

    @pytest.mark.asyncio()
    async def test_user_prompt_has_context_headers(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """Each context item in the user prompt has a source header."""
        compiler = PromptCompiler(e2e_vault, mock_provider)
        context = [
            ContextItem(
                content="Content about note vault wikilinks creation",
                source="topics/creation.md",
            ),
            ContextItem(
                content="Content about note vault linking references",
                source="topics/linking.md",
            ),
        ]

        result = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "topic", "title": "Linking"},
            context_items=context,
        )

        assert "### Context: topics/creation.md" in result.user
        assert "### Context: topics/linking.md" in result.user

    @pytest.mark.asyncio()
    async def test_version_changes_with_different_variables(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """Different template variables produce different version hashes."""
        compiler = PromptCompiler(e2e_vault, mock_provider)

        r1 = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "topic", "title": "Alpha"},
            context_items=[],
        )
        r2 = await compiler.compile(
            agent_name="weaver",
            template_name="create",
            variables={"note_type": "project", "title": "Beta"},
            context_items=[],
        )

        assert r1.version != r2.version
        assert len(r1.version) == 64
        assert len(r2.version) == 64

    @pytest.mark.asyncio()
    async def test_scribe_template_compiles(
        self, e2e_vault: Path, mock_provider: AsyncMock
    ) -> None:
        """A different agent/template pair compiles correctly."""
        compiler = PromptCompiler(e2e_vault, mock_provider)

        result = await compiler.compile(
            agent_name="scribe",
            template_name="summarize",
            variables={"topic": "distributed systems"},
            context_items=[
                ContextItem(
                    content="CRDTs enable conflict-free replication in distributed databases.",
                    source="topics/crdts.md",
                ),
            ],
        )

        assert "Scribe" in result.system
        assert "distributed systems" in result.system
        assert "wikilinks" in result.system.lower()
        assert result.stats.items_provided == 1
