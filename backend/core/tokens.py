"""Token counting and truncation helpers for agent prompts.

Agent prompts historically truncated by character count, which is a poor proxy
for context-window cost — a dense note can be 3000 characters but 10k+ tokens.
These helpers count and truncate by *tokens* using ``tiktoken`` (cl100k_base,
the GPT-4/4o family encoding), with a graceful character-based fallback when
the encoding can't be loaded (e.g. offline, no network to fetch the BPE files).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import tiktoken

logger = logging.getLogger(__name__)

# Rough chars-per-token ratio for the fallback path. English prose averages
# ~4 characters per token; this keeps the fallback conservative (slightly
# over-truncating) rather than blowing the budget.
_CHARS_PER_TOKEN = 4

_ENCODING_NAME = "cl100k_base"

# Lazily-cached encoding. ``False`` is the "tried and failed" sentinel so we
# don't re-attempt a load that already raised; ``None`` means "not tried yet".
_encoding: tiktoken.Encoding | None | bool = None


def _get_encoding() -> tiktoken.Encoding | None:
    """Return a cached cl100k_base encoding, or None if it can't be loaded.

    The first failure is cached so repeated calls don't keep paying the cost
    of a doomed import/load.
    """
    global _encoding
    if _encoding is False:
        return None
    if _encoding is not None:
        return _encoding  # type: ignore[return-value]
    try:
        import tiktoken

        _encoding = tiktoken.get_encoding(_ENCODING_NAME)
        return _encoding
    except Exception:  # noqa: BLE001 — any import/load failure falls back to chars
        logger.warning(
            "tiktoken encoding %s unavailable; falling back to char estimate",
            _ENCODING_NAME,
            exc_info=True,
        )
        _encoding = False
        return None


def count_tokens(text: str) -> int:
    """Return the number of tokens in *text*.

    Uses ``tiktoken`` when available, else estimates as ``len(text) // 4``.

    Args:
        text: The text to measure.

    Returns:
        Token count (non-negative).
    """
    if not text:
        return 0
    encoding = _get_encoding()
    if encoding is None:
        return len(text) // _CHARS_PER_TOKEN
    return len(encoding.encode(text))


def truncate_to_tokens(text: str, max_tokens: int, *, model: str | None = None) -> str:
    """Truncate *text* to at most *max_tokens* tokens.

    Truncates on a token boundary (decoding the first ``max_tokens`` tokens)
    when ``tiktoken`` is available; otherwise slices at ``max_tokens * 4``
    characters. Returns *text* unchanged when it already fits.

    Args:
        text: The text to truncate.
        max_tokens: Maximum number of tokens to keep (values <= 0 yield "").
        model: Reserved for future per-model encodings; currently ignored
            (cl100k_base covers the GPT-4/4o family Loom targets).

    Returns:
        The truncated text.
    """
    del model  # reserved; cl100k_base is used for all models today
    if max_tokens <= 0:
        return ""
    if not text:
        return text

    encoding = _get_encoding()
    if encoding is None:
        max_chars = max_tokens * _CHARS_PER_TOKEN
        return text if len(text) <= max_chars else text[:max_chars]

    tokens = encoding.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return encoding.decode(tokens[:max_tokens])
