"""Context item compression for the Prompt Compiler.

When a context item exceeds a configurable token threshold, this module
uses the configured LLM provider to produce a shorter summary that
preserves key information: frontmatter fields, wikilinks, and core facts.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from compiler.counter import count_tokens

if TYPE_CHECKING:
    from compiler.models import ContextItem
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

_COMPRESSION_SYSTEM = (
    "You are a text compression assistant for a knowledge management system. "
    "Compress the following content while preserving:\n"
    "- All YAML frontmatter fields and their values\n"
    "- All [[wikilinks]] exactly as written\n"
    "- Key facts, decisions, and action items\n"
    "- Section headings structure\n\n"
    "Remove redundant prose, examples, and filler. "
    "Return only the compressed text, no explanations."
)


async def compress_item(
    item: ContextItem,
    provider: BaseProvider,
    threshold: int = 2000,
) -> ContextItem:
    """Compress a context item if it exceeds the token threshold.

    If the item's token count is at or below the threshold, it is returned
    unchanged. Otherwise, the LLM provider summarizes the content while
    preserving frontmatter, wikilinks, and key information.

    Args:
        item: The context item to potentially compress.
        provider: An LLM provider with a ``chat()`` method.
        threshold: Token count above which compression is triggered.

    Returns:
        A new ``ContextItem`` with compressed content and updated
        token count, or the original item if compression was not needed.
    """
    tokens = item.token_count or count_tokens(item.content)
    if tokens <= threshold:
        return item.model_copy(update={"token_count": tokens})

    logger.info(
        "Compressing context item '%s' (%d tokens > %d threshold)",
        item.source,
        tokens,
        threshold,
    )

    try:
        compressed_text = await provider.chat(
            messages=[{"role": "user", "content": item.content}],
            system=_COMPRESSION_SYSTEM,
        )
    except Exception:
        logger.warning(
            "Compression failed for '%s' — keeping original",
            item.source,
            exc_info=True,
        )
        return item.model_copy(update={"token_count": tokens})

    # Verify wikilinks are preserved; restore any that were lost
    compressed_text = _restore_wikilinks(item.content, compressed_text)

    new_tokens = count_tokens(compressed_text)
    return item.model_copy(
        update={
            "content": compressed_text,
            "token_count": new_tokens,
        }
    )


def _restore_wikilinks(original: str, compressed: str) -> str:
    """Append any wikilinks from *original* that are missing in *compressed*.

    Args:
        original: The original text containing wikilinks.
        compressed: The compressed text that may have lost some wikilinks.

    Returns:
        The compressed text, potentially with a trailing section listing
        any wikilinks that were dropped during compression.
    """
    original_links = set(_WIKILINK_RE.findall(original))
    compressed_links = set(_WIKILINK_RE.findall(compressed))
    missing = original_links - compressed_links

    if not missing:
        return compressed

    links_section = "\n\n## Related\n" + "\n".join(
        f"- [[{link}]]" for link in sorted(missing)
    )
    return compressed + links_section
