"""Pydantic models for the Prompt Compiler pipeline."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ContextItem(BaseModel):
    """A single piece of context to include in a compiled prompt.

    Attributes:
        content: The text content of this context item.
        source: File path or identifier indicating where this came from.
        relevance: Relevance score from 0.0 to 1.0, set by the pruner.
        token_count: Cached token count, populated by the counter.
    """

    content: str
    source: str
    relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    token_count: int | None = None


class CompileStats(BaseModel):
    """Statistics from a compilation run.

    Attributes:
        items_provided: Number of context items originally passed in.
        items_pruned: Number of items removed during pruning.
        items_compressed: Number of items that were compressed.
        tokens_before: Total token count before pruning and compression.
        tokens_after: Final token count of the compiled prompt.
    """

    items_provided: int
    items_pruned: int
    items_compressed: int
    tokens_before: int
    tokens_after: int


class CompiledPrompt(BaseModel):
    """The final output of the Prompt Compiler pipeline.

    Attributes:
        system: The system message for the LLM.
        user: The user message for the LLM.
        token_count: Total token count of system + user combined.
        version: SHA-256 hash of the compiled output for tracking.
        stats: Compilation statistics.
    """

    system: str
    user: str
    token_count: int
    version: str
    stats: CompileStats


class CompressionConfig(BaseModel):
    """Compression settings from ``_compiler.yaml``.

    Attributes:
        enabled: Whether compression is active.
        threshold_tokens: Items above this token count get compressed.
        strategy: Compression strategy name (e.g. ``"summarize"``).
    """

    enabled: bool = True
    threshold_tokens: int = 2000
    strategy: str = "summarize"


class OutputFormatConfig(BaseModel):
    """Output format settings from ``_compiler.yaml``.

    Attributes:
        version_tag: Whether to include the version hash.
        include_metadata: Whether to include compile metadata.
    """

    version_tag: bool = True
    include_metadata: bool = True


class CompilerConfig(BaseModel):
    """Parsed representation of ``prompts/_compiler.yaml``.

    Attributes:
        token_budgets: Per-agent token budget mapping.
        compression: Compression settings sub-model.
        output_format: Output format settings sub-model.
    """

    token_budgets: dict[str, int] = Field(default_factory=dict)
    compression: CompressionConfig = Field(default_factory=CompressionConfig)
    output_format: OutputFormatConfig = Field(default_factory=OutputFormatConfig)
