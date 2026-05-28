"""Server-Sent Events plumbing for the Loom Council streaming endpoint.

Lives next to ``chat.py`` to keep that file under the 300-line guideline.
The actual route handler still registers on the chat router; this module
just hosts the async generator that produces the SSE frames.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from core.exceptions import ProviderConfigError, ProviderError
from core.traces import clear_caller, get_trace_store, set_caller

logger = logging.getLogger(__name__)


def sse(event: str, data: dict | str) -> str:
    """Format a single Server-Sent Event frame."""
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n"


async def council_stream(
    message: str,
    chat,
    *,
    personas: dict[str, str],
    aggregator_system: str,
    ask_agent,
) -> AsyncIterator[str]:
    """Yield SSE frames for a council turn.

    Wire format:
      event: contributions  data: {agent_contributions: [...]}
      event: token          data: "<chunk>" (one per aggregator token batch)
      event: done           data: {assistant_text, trace_id, agent_contributions: [...]}
      event: error          data: {message}

    Per-agent contributions are computed up front (buffered fan-out) and
    emitted in one event so the UI can paint sub-bubbles immediately; the
    aggregator's voice is streamed token-by-token so the user sees text
    appearing instead of dead air.
    """
    from core.providers import get_chat_provider

    try:
        provider = get_chat_provider()
    except (ProviderConfigError, ProviderError) as exc:
        yield sse("error", {"message": str(exc)})
        return

    recent = chat.load_recent("_council", limit=10)
    history = [m.to_llm_message() for m in recent]

    try:
        contributions = await asyncio.gather(
            *[
                ask_agent(provider, name, persona, history, message)
                for name, persona in personas.items()
            ]
        )
    except Exception as exc:
        yield sse("error", {"message": f"Fan-out failed: {exc}"})
        return

    yield sse(
        "contributions",
        {"agent_contributions": [c.model_dump() for c in contributions]},
    )

    # Build the aggregator prompt from the contributions and stream its reply.
    parts: list[str] = [f"User asked:\n{message}\n\nThe agents said:\n"]
    for c in contributions:
        if c.error:
            parts.append(f"- **{c.agent}**: (errored: {c.error})")
        elif c.content.strip():
            parts.append(f"- **{c.agent}**: {c.content.strip()}")
        else:
            parts.append(f"- **{c.agent}**: (silent — nothing to add)")
    aggregator_input = "\n".join(parts)
    messages = [*history, {"role": "user", "content": aggregator_input}]

    assistant_chunks: list[str] = []
    try:
        set_caller("council")
        async for chunk in provider.chat_stream(
            messages=messages, system=aggregator_system
        ):
            assistant_chunks.append(chunk)
            yield sse("token", chunk)
    except (ProviderError, ProviderConfigError) as exc:
        yield sse("error", {"message": f"Aggregator failed: {exc}"})
        return
    finally:
        clear_caller()

    assistant_text = "".join(assistant_chunks)
    chat.save_message("_council", "council", assistant_text)
    # The aggregator's trace is whichever was recorded last (TracedProvider
    # writes it at stream close).
    recent_traces = get_trace_store().list(limit=1)
    trace_id = recent_traces[0].id if recent_traces else ""

    yield sse(
        "done",
        {
            "assistant_text": assistant_text,
            "trace_id": trace_id,
            "agent_contributions": [c.model_dump() for c in contributions],
        },
    )
