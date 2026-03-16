"""Chat API routes: send messages, load history, list sessions.

Supports two chat modes:
  - **Shuttle 1:1**: User talks to Researcher or Standup individually.
    Messages go to ``agents/<name>/chat/``.
  - **Loom Council**: User talks to all Loom-layer agents collectively.
    Messages go to ``agents/_council/chat/``. The council dispatches
    to the appropriate agent and returns a multi-agent response.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.vault import VaultManager, get_vault_manager

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


class SendMessageResponse(BaseModel):
    """Response after sending a message (includes the assistant reply)."""

    user_message: ChatMessageResponse
    assistant_message: ChatMessageResponse


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
async def send_message(
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
    reply_text = await _generate_reply(body.agent, body.message, chat, vm)

    # Save assistant response
    role = "assistant" if body.agent in SHUTTLE_AGENTS else "council"
    assistant_msg = chat.save_message(body.agent, role, reply_text)

    return SendMessageResponse(
        user_message=ChatMessageResponse(**user_msg.to_dict()),
        assistant_message=ChatMessageResponse(**assistant_msg.to_dict()),
    )


@router.get("/history")
def get_history(
    agent: str = Query(COUNCIL, description="Agent name or _council"),
    limit: int = Query(20, ge=1, le=100, description="Max messages"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ChatHistoryResponse:
    """Load recent chat history for an agent."""
    from agents.chat import get_chat_history

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

    chat = get_chat_history()
    if chat is None:
        raise HTTPException(status_code=503, detail="Chat system not initialized")

    sessions = chat.list_sessions(agent)
    return ChatSessionList(agent=agent, sessions=sessions)


# -- Response generation -------------------------------------------------------


async def _generate_reply(
    agent: str,
    message: str,
    chat,
    vm: VaultManager,
) -> str:
    """Generate an agent response to a user message.

    For shuttle agents, calls the agent's query/generate method.
    For council, uses the chat provider with vault context.
    """
    if agent == "researcher":
        return await _researcher_reply(message)
    if agent == "standup":
        return await _standup_reply()
    # Council (default)
    return await _council_reply(message, chat, vm)


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


async def _council_reply(
    message: str,
    chat,
    vm: VaultManager,
) -> str:
    """Handle a Loom Council message.

    The council uses the chat provider with recent conversation context
    and vault knowledge to respond. It represents all Loom-layer agents.
    """
    from core.providers import get_chat_provider

    try:
        provider = get_chat_provider()
    except Exception:  # noqa: BLE001
        return (
            "No chat provider configured. Add a provider to "
            "~/.loom/config.yaml to enable the Loom Council."
        )

    # Build conversation context from recent messages
    recent = chat.load_recent("_council", limit=10)
    messages = [m.to_llm_message() for m in recent]

    # Add the new user message
    messages.append({"role": "user", "content": message})

    system = (
        "You are the Loom Council — the collective voice of the Loom knowledge "
        "management system's agent team (Weaver, Spider, Archivist, Scribe, Sentinel). "
        "You help the user manage their vault of markdown notes.\n\n"
        "You can:\n"
        "- Answer questions about vault contents and organization\n"
        "- Suggest actions (creating notes, linking, archiving)\n"
        "- Explain what agents have been doing (check changelogs)\n"
        "- Help with vault strategy and knowledge management\n\n"
        "Use [[wikilinks]] when referencing notes. Be concise and helpful."
    )

    try:
        return await provider.chat(messages=messages, system=system)
    except Exception as exc:  # noqa: BLE001
        return f"Council response failed: {exc}"
