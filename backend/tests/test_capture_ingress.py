"""Focused coverage for the shared HTTP/Shuttle capture ingress."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from agents.shuttle.custom import CustomAgent
from agents.shuttle.researcher import Researcher
from agents.shuttle.standup import Standup
from core.capture_ingress import CaptureIngressError, ingest_capture
from core.capture_jobs import capture_job_store
from core.config import CaptureProcessingConfig, GlobalConfig
from core.events import CAPTURE_CHANGED, CAPTURE_JOB_CHANGED, get_event_hub
from core.note_index import NoteIndex
from core.notes import parse_note
from tests.conftest import _seed_notes


@pytest.fixture()
def ingress_api_vault(vault_manager, note_index) -> Path:
    return _seed_notes(vault_manager, note_index, [])


def _producer_vault(tmp_path: Path) -> Path:
    """Build a canonical vault path so agents resolve its persisted policy."""
    loom_home = tmp_path / "loom-home"
    root = loom_home / "vaults" / "test"
    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)
    (root / ".loom").mkdir(parents=True, exist_ok=True)
    GlobalConfig(
        active_vault="test",
        capture_processing=CaptureProcessingConfig(mode="all"),
    ).save(loom_home / "config.yaml")
    return root


@pytest.mark.asyncio
async def test_external_key_is_idempotent_at_the_service_boundary(tmp_path: Path) -> None:
    root = _producer_vault(tmp_path)
    policy = CaptureProcessingConfig(mode="manual")
    index = NoteIndex()

    first = await ingest_capture(
        root,
        title="Mail message",
        body="original",
        source="bridge:gmail",
        external_id="message-42",
        policy=policy,
        index=index,
    )
    retry = await ingest_capture(
        root,
        title="Changed retry",
        body="replacement",
        source="bridge:gmail",
        external_id="message-42",
        policy=policy,
        index=index,
    )

    assert first.created is True
    assert retry.created is False
    assert retry.deduplicated is True
    assert retry.capture.id == first.capture.id
    assert retry.capture.body == "original"
    assert index.get_path_by_id(first.capture.id) == first.capture_path
    assert len(list((root / "threads" / "captures").glob("*.md"))) == 1


@pytest.mark.asyncio
async def test_ingress_applies_policy_and_enqueues_immediately(tmp_path: Path) -> None:
    root = _producer_vault(tmp_path)
    hub = get_event_hub()
    events = hub.subscribe()
    try:
        manual = await ingest_capture(
            root,
            title="Manual thought",
            source="manual",
            policy=CaptureProcessingConfig(mode="manual"),
        )
        assert events.get_nowait() == CAPTURE_CHANGED
        assert events.empty()

        automatic = await ingest_capture(
            root,
            title="Agent result",
            source="agent:researcher",
            policy=CaptureProcessingConfig(mode="all", max_retries=3),
        )
        assert events.get_nowait() == CAPTURE_CHANGED
        assert events.get_nowait() == CAPTURE_JOB_CHANGED
        assert events.empty()
    finally:
        hub.unsubscribe(events)

    assert manual.job is None
    assert automatic.job is not None
    assert automatic.job.status == "queued"
    assert automatic.job.max_attempts == 4
    stored = capture_job_store(root).get_by_capture(automatic.capture.id)
    assert stored is not None
    assert stored.id == automatic.job.id


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["   ", "bridge:gmail\nforged-source"])
async def test_ingress_rejects_malformed_sources_before_writing(
    tmp_path: Path, source: str
) -> None:
    root = _producer_vault(tmp_path)

    with pytest.raises(CaptureIngressError, match="source"):
        await ingest_capture(root, title="Bad source", source=source)

    assert list((root / "threads" / "captures").glob("*.md")) == []


def test_http_gateway_maps_malformed_source_to_client_error(
    client: TestClient, ingress_api_vault: Path
) -> None:
    response = client.post(
        "/api/captures",
        json={"title": "Forged", "source": "bridge:gmail\nagent:trusted"},
    )

    assert response.status_code == 400
    assert "source" in response.json()["detail"]
    assert list((ingress_api_vault / "threads" / "captures").glob("*.md")) == []


@pytest.mark.asyncio
async def test_researcher_capture_uses_ingress_job_policy(tmp_path: Path) -> None:
    root = _producer_vault(tmp_path)
    agent = Researcher(root, chat_provider=None)

    capture_id, path = await agent._save_capture(
        "What changed?",
        "The Inbox is durable.",
        [{"title": "Inbox", "heading": "Jobs", "path": "topics/inbox.md"}],
    )

    note = parse_note(path)
    job = capture_job_store(root).get_by_capture(capture_id)
    assert path.name == f"research-{capture_id}.md"
    assert note.author == note.source == "agent:researcher"
    assert note.links == ["inbox"]
    assert job is not None
    assert job.status == "queued"


@pytest.mark.asyncio
async def test_standup_capture_uses_ingress_and_dedupes_the_date(tmp_path: Path) -> None:
    root = _producer_vault(tmp_path)
    agent = Standup(root, chat_provider=None)

    first_id, first_path = await agent._save_capture("2026-07-14", "First recap")
    retry_id, retry_path = await agent._save_capture("2026-07-14", "Replacement recap")

    job = capture_job_store(root).get_by_capture(first_id)
    assert first_id == retry_id
    assert first_path == retry_path
    assert first_path.name == "standup-2026-07-14.md"
    assert parse_note(first_path).body == "First recap"
    assert job is not None
    assert job.status == "queued"


@pytest.mark.asyncio
async def test_custom_agent_capture_uses_ingress_job_policy(tmp_path: Path) -> None:
    root = _producer_vault(tmp_path)
    agent = CustomAgent(
        root,
        {
            "id": "digest",
            "name": "Digest",
            "role": "summarizes",
            "system_prompt": "Summarize the vault.",
        },
        chat_provider=None,
    )

    capture_id, path = await agent._save_capture("A useful digest.")

    note = parse_note(path)
    job = capture_job_store(root).get_by_capture(capture_id)
    assert path.name == f"digest-{capture_id}.md"
    assert note.author == note.source == "agent:digest"
    assert "custom-agent" in note.tags
    assert job is not None
    assert job.status == "queued"
