"""Chat API routes: send messages, load history, list sessions.

Supports two chat modes:
  - **Shuttle 1:1**: User talks to Researcher or Standup individually.
    Messages go to ``agents/<name>/chat/``.
  - **Loom Council**: User talks to all Loom-layer agents collectively.
    Messages go to ``agents/_council/chat/``. The council dispatches
    to the appropriate agent and returns a multi-agent response.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.routers.chat_stream import council_stream, fan_out_agents
from core.exceptions import ProviderConfigError, ProviderError
from core.rate_limit import WRITE_LIMIT, limiter
from core.traces import clear_caller, set_caller
from core.vault import VaultManager, VaultPathError, get_vault_manager

if TYPE_CHECKING:
    from agents.chat import ChatHistory
    from core.providers.base import BaseProvider

router = APIRouter(prefix="/api/chat", tags=["chat"])

SHUTTLE_AGENTS = {"researcher", "standup"}
COUNCIL = "_council"
ALLOWED_TARGETS = SHUTTLE_AGENTS | {COUNCIL}


# -- Request / Response models ------------------------------------------------


class SendMessageRequest(BaseModel):
    """Request body for sending a chat message."""

    message: str
    agent: str = COUNCIL  # "researcher", "standup", or "_council"


class ChatMessageResponse(BaseModel):
    """A single chat message."""

    role: str
    content: str
    timestamp: str
    agent: str


class AgentContribution(BaseModel):
    """One Loom-agent's view in a multi-agent council reply.

    The council fans out a user message to every Loom agent in parallel, then
    an aggregator distils the responses into ``assistant_message``. The raw
    per-agent contributions live here so the UI can render each in its own
    bubble alongside the synthesised voice.
    """

    agent: str  # "weaver", "spider", "archivist", "scribe", "sentinel"
    content: str
    trace_id: str = ""
    error: str = ""


class SendMessageResponse(BaseModel):
    """Response after sending a message (includes the assistant reply).

    For shuttle agents, ``assistant_message`` is the agent's reply and
    ``agent_contributions`` is empty.

    For the council, ``assistant_message`` is the aggregator's synthesised
    voice; ``agent_contributions`` carries each Loom agent's individual
    response so the UI can show the full multi-bubble thread.
    """

    user_message: ChatMessageResponse
    assistant_message: ChatMessageResponse
    trace_id: str = ""
    agent_contributions: list[AgentContribution] = []


class ChatHistoryResponse(BaseModel):
    """List of chat messages."""

    agent: str
    messages: list[ChatMessageResponse]


class ChatSessionList(BaseModel):
    """Available chat session dates."""

    agent: str
    sessions: list[str]


# -- Endpoints ----------------------------------------------------------------


@router.post("/send")
@limiter.limit(WRITE_LIMIT)
async def send_message(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: SendMessageRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> SendMessageResponse:
    """Send a message and receive an agent response.

    For shuttle agents, routes to the specific agent.
    For ``_council``, dispatches to Loom-layer agents collectively.
    """
    from agents.chat import get_chat_history

    if body.agent not in ALLOWED_TARGETS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid chat target '{body.agent}'. Must be one of: {', '.join(sorted(ALLOWED_TARGETS))}",
        )

    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    # Save user message
    user_msg = chat.save_message(body.agent, "user", body.message)

    # Generate response
    reply = await _generate_reply(body.agent, body.message, chat, vm)

    # Save assistant response
    role = "assistant" if body.agent in SHUTTLE_AGENTS else "council"
    assistant_msg = chat.save_message(body.agent, role, reply.text)

    # Resolve the "raw call" trace. For the council, the aggregator call is
    # tagged ``council`` — filter by it so a concurrent request's trace can't
    # be mis-attributed here. Shuttle agents don't set a caller, so fall back
    # to the most recent trace for them.
    from core.traces import get_trace_store

    caller = None if body.agent in SHUTTLE_AGENTS else "council"
    recent = get_trace_store().list(limit=1, caller=caller)
    trace_id = recent[0].id if recent else ""

    return SendMessageResponse(
        user_message=ChatMessageResponse(**user_msg.to_dict()),
        assistant_message=ChatMessageResponse(**assistant_msg.to_dict()),
        trace_id=trace_id,
        agent_contributions=reply.contributions,
    )


@router.get("/history")
def get_history(
    agent: str = Query(COUNCIL, description="Agent name or _council"),
    limit: int = Query(20, ge=1, le=100, description="Max messages"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ChatHistoryResponse:
    """Load recent chat history for an agent."""
    from agents.chat import get_chat_history

    if agent not in ALLOWED_TARGETS:
        raise HTTPException(status_code=400, detail=f"Invalid agent: {agent!r}")

    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    messages = chat.load_recent(agent, limit=limit)
    return ChatHistoryResponse(
        agent=agent,
        messages=[ChatMessageResponse(**m.to_dict()) for m in messages],
    )


@router.get("/history/{date_str}")
def get_history_by_date(
    date_str: str,
    agent: str = Query(COUNCIL, description="Agent name or _council"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ChatHistoryResponse:
    """Load chat history for a specific date."""
    from agents.chat import get_chat_history

    if agent not in ALLOWED_TARGETS:
        raise HTTPException(status_code=400, detail=f"Invalid agent: {agent!r}")

    try:
        vm.validate_date(date_str)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    messages = chat.load_day(agent, date_str)
    return ChatHistoryResponse(
        agent=agent,
        messages=[ChatMessageResponse(**m.to_dict()) for m in messages],
    )


@router.get("/sessions")
def list_sessions(
    agent: str = Query(COUNCIL, description="Agent name or _council"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ChatSessionList:
    """List available chat session dates for an agent."""
    from agents.chat import get_chat_history

    if agent not in ALLOWED_TARGETS:
        raise HTTPException(status_code=400, detail=f"Invalid agent: {agent!r}")

    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    sessions = chat.list_sessions(agent)
    return ChatSessionList(agent=agent, sessions=sessions)


# -- Response generation -------------------------------------------------------


class _Reply(BaseModel):
    """Internal structured reply: synthesised text + per-agent contributions."""

    text: str
    contributions: list[AgentContribution] = []


# Persona prompts for each Loom-layer agent. Kept short and concrete so the
# fan-out cost stays predictable; the aggregator does the heavy lifting of
# synthesising a single voice.
_COUNCIL_PERSONAS: dict[str, str] = {
    "weaver": (
        "You are Weaver, the note-creator. You see the vault through the lens of "
        "what notes exist and what new notes the user's message implies. Answer "
        "from that perspective in 1-3 sentences. Use [[wikilinks]] when naming "
        "notes. Be specific and concrete."
    ),
    "spider": (
        "You are Spider, the linker. You see the vault through the lens of "
        "connections between notes. Answer the user's message in 1-3 sentences "
        "focused on what notes should link to what, what's isolated, or what "
        "backlinks matter. Use [[wikilinks]]."
    ),
    "archivist": (
        "You are Archivist, the organiser. You see the vault as a structure of "
        "folders, age, and lifecycle. Answer in 1-3 sentences about what should "
        "be archived, what's stale, or how folders are doing. Use [[wikilinks]]."
    ),
    "scribe": (
        "You are Scribe, the summariser. You see the vault as activity over time "
        "and folder indexes. Answer in 1-3 sentences about what the recent "
        "rhythm shows or what summary view would help. Use [[wikilinks]]."
    ),
    "sentinel": (
        "You are Sentinel, the reviewer. You see the vault through prime.md's "
        "principles. Answer in 1-3 sentences about any rule-fit, schema, or "
        "principle concerns the message raises. Be sparing — silence is fine "
        "if nothing is amiss. Use [[wikilinks]]."
    ),
}

_AGGREGATOR_SYSTEM = (
    "You are the Loom Council voice. The user asked a question; the five Loom "
    "agents (Weaver, Spider, Archivist, Scribe, Sentinel) each gave their "
    "take. Synthesise a single helpful reply: 2-4 sentences, no "
    "agent-by-agent breakdown (the UI shows that separately). Pull out "
    "consensus where they agree, flag tension where they don't, and end with "
    "the most useful next step. Use [[wikilinks]] when referencing notes."
)


async def _generate_reply(
    agent: str,
    message: str,
    chat: ChatHistory,
    vm: VaultManager,  # noqa: ARG001 — reserved for future vault-aware routing
) -> _Reply:
    """Generate an agent response to a user message.

    Shuttle agents return a simple text reply with no contributions.
    The council fans out to all Loom agents in parallel, then aggregates.
    """
    if agent == "researcher":
        return _Reply(text=await _researcher_reply(message))
    if agent == "standup":
        return _Reply(text=await _standup_reply())
    return await _council_reply(message, chat)


async def _researcher_reply(message: str) -> str:
    """Route message to Researcher agent."""
    from agents.shuttle.researcher import get_researcher

    researcher = get_researcher()
    if researcher is None:
        return "Researcher agent is not available. Please configure a chat provider."

    result = await researcher.query(message)
    return result.answer


async def _standup_reply() -> str:
    """Route message to Standup agent (always generates today's recap)."""
    from agents.shuttle.standup import get_standup

    standup = get_standup()
    if standup is None:
        return "Standup agent is not available. Please configure a chat provider."

    result = await standup.generate()
    if not result.recap:
        return "No activity recorded today."
    return result.recap


@router.post("/send/stream")
@limiter.limit(WRITE_LIMIT)
async def send_message_stream(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: SendMessageRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008, ARG001
) -> StreamingResponse:
    """Server-Sent Events variant of ``/send`` for the Loom Council.

    Only the council target is supported — shuttle agents continue to use
    the buffered ``/send`` endpoint until there's a UX win in streaming them.
    """
    from agents.chat import get_chat_history

    if body.agent != COUNCIL:
        raise HTTPException(
            status_code=400,
            detail="Streaming is only available for the council target",
        )
    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    chat.save_message(body.agent, "user", body.message)
    return StreamingResponse(
        council_stream(
            body.message,
            chat,
            personas=_COUNCIL_PERSONAS,
            aggregator_system=_AGGREGATOR_SYSTEM,
            ask_agent=_ask_agent,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _council_reply(message: str, chat: ChatHistory) -> _Reply:
    """Loom Council reply: parallel fan-out across all 5 Loom agents, then aggregate.

    Each agent answers from its own perspective. A final aggregator call
    distils the five answers into a single council voice; the per-agent
    contributions are returned alongside so the UI can render them.
    """
    from core.providers import get_chat_provider

    try:
        provider = get_chat_provider()
    except (ProviderConfigError, ProviderError):
        return _Reply(
            text=(
                "No chat provider configured. Add a provider to "
                "~/.loom/config.yaml to enable the Loom Council."
            )
        )

    recent = chat.load_recent("_council", limit=10)
    history = [m.to_llm_message() for m in recent]

    # Fan out in parallel. Each agent call carries the prior conversation +
    # the new user turn so each persona has the same context. Caller tag is
    # per-agent so the trace store + activity pulse attribute correctly.
    contributions = await fan_out_agents(_ask_agent, provider, _COUNCIL_PERSONAS, history, message)

    # Aggregate. The aggregator sees the five raw contributions plus the
    # original user turn and produces the single council voice. If a
    # contribution errored, it's still included so the aggregator can
    # mention the gap.
    aggregated = await _aggregate(provider, message, contributions, history)

    return _Reply(text=aggregated, contributions=contributions)


async def _ask_agent(
    provider: BaseProvider,
    agent: str,
    persona: str,
    history: list[dict[str, Any]],
    message: str,
) -> AgentContribution:
    """Call the chat provider in one agent's voice. Errors are captured, not raised."""
    from core.traces import get_trace_store

    caller = f"council:{agent}"
    messages = [*history, {"role": "user", "content": message}]
    try:
        set_caller(caller)
        text = await provider.chat(messages=messages, system=persona)
        # Filter by this agent's own caller label: the council fans out
        # concurrently, so the globally-most-recent trace may belong to a
        # sibling agent. The caller filter pins it to *this* agent's call.
        recent = get_trace_store().list(limit=1, caller=caller)
        trace_id = recent[0].id if recent else ""
        return AgentContribution(agent=agent, content=text, trace_id=trace_id)
    except (ProviderError, ProviderConfigError) as exc:
        return AgentContribution(agent=agent, content="", error=str(exc))
    finally:
        clear_caller()


async def _aggregate(
    provider: BaseProvider,
    user_message: str,
    contributions: list[AgentContribution],
    history: list[dict[str, Any]],
) -> str:
    """Synthesise the five agent contributions into a single council voice."""
    # Format contributions for the aggregator's user turn.
    parts: list[str] = [f"User asked:\n{user_message}\n\nThe agents said:\n"]
    for c in contributions:
        if c.error:
            parts.append(f"- **{c.agent}**: (errored: {c.error})")
        elif c.content.strip():
            parts.append(f"- **{c.agent}**: {c.content.strip()}")
        else:
            parts.append(f"- **{c.agent}**: (silent — nothing to add)")
    aggregator_input = "\n".join(parts)

    messages = [*history, {"role": "user", "content": aggregator_input}]

    try:
        set_caller("council")
        return await provider.chat(messages=messages, system=_AGGREGATOR_SYSTEM)
    except (ProviderError, ProviderConfigError) as exc:
        return f"Council aggregation failed: {exc}"
    finally:
        clear_caller()
