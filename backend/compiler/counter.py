"""Token counting utilities for the Prompt Compiler.

Uses tiktoken for accurate counts on OpenAI-compatible models,
with a character-based fallback for unsupported models.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_APPROX_CHARS_PER_TOKEN = 4


def count_tokens(text: str, model: str = "gpt-4o") -> int:
    """Count the number of tokens in *text* for the given model.

    Args:
        text: The text to count tokens for.
        model: The model name used to select the tokenizer encoding.

    Returns:
        The number of tokens. Falls back to an approximate count
        (``len(text) // 4``) if tiktoken cannot encode for the model.
    """
    try:
        import tiktoken

        encoding = tiktoken.encoding_for_model(model)
        return len(encoding.encode(text))
    except Exception:  # noqa: BLE001
        logger.debug(
            "tiktoken unavailable or unsupported model '%s' — using approximate count",
            model,
        )
        return _approximate_token_count(text)


def _approximate_token_count(text: str) -> int:
    """Return an approximate token count based on character length.

    Args:
        text: The text to estimate tokens for.

    Returns:
        Approximate token count using chars / 4 heuristic, minimum 1
        for non-empty text.
    """
    if not text:
        return 0
    return max(1, len(text) // _APPROX_CHARS_PER_TOKEN)
