from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock

from agents.chain import ReadChain
from agents.shuttle.custom import CustomAgent
from agents.shuttle.researcher import Researcher
from agents.shuttle.standup import Standup
from core.config import AutomationPolicyConfig, GlobalConfig
from core.note_index import get_note_index
from core.notes import now_iso


def _vault(tmp_path: Path) -> Path:
    home = tmp_path / "loom"
    root = home / "vaults" / "private"
    for folder in ("captures", "private", "topics"):
        (root / "threads" / folder).mkdir(parents=True)
    (root / "rules").mkdir()
    (root / "rules" / "prime.md").write_text("rules")
    GlobalConfig(
        active_vault="private",
        automation_policy=AutomationPolicyConfig(excluded_cloud_folders=["private"]),
    ).save(home / "config.yaml")
    stamp = now_iso()
    for folder, note_id, title, body in [
        ("private", "sec", "Secret", "UNIQUE_PRIVATE_SENTINEL"),
        ("topics", "pub", "Public", "safe public context"),
    ]:
        (root / "threads" / folder / f"{note_id}.md").write_text(
            f"---\nid: {note_id}\ntitle: {title}\ntype: topic\ntags: []\ncreated: {stamp}\nmodified: {stamp}\nauthor: user\nstatus: active\nhistory: []\n---\n{body}"
        )
    get_note_index().build(root / "threads")
    return root


def test_custom_cloud_context_excludes_folder_sentinel_and_ollama_keeps_it(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    cloud = AsyncMock()
    cloud.name = "openai"
    custom = CustomAgent(root, {"id": "digest", "name": "Digest"}, chat_provider=cloud)
    assert "UNIQUE_PRIVATE_SENTINEL" not in custom._gather_context()
    local = AsyncMock()
    local.name = "ollama"
    assert (
        "UNIQUE_PRIVATE_SENTINEL"
        in CustomAgent(root, {"id": "d2", "name": "D"}, local)._gather_context()
    )
    codex = AsyncMock()
    codex.name = "codex"
    assert (
        "UNIQUE_PRIVATE_SENTINEL"
        not in CustomAgent(root, {"id": "d3", "name": "D"}, codex)._gather_context()
    )


def test_researcher_cloud_fallback_never_formats_excluded_sentinel(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    cloud = AsyncMock()
    cloud.name = "openai"
    context, _refs = Researcher(root, chat_provider=cloud)._keyword_search_fallback("sentinel")
    assert "UNIQUE_PRIVATE_SENTINEL" not in context


def test_standup_and_read_chain_filter_protected_note_context(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    cloud = AsyncMock()
    cloud.name = "openai"
    # Standup uses metadata as its prompt-ready recap list.
    assert "Secret" not in [
        item["title"]
        for item in Standup(root, cloud)._find_modified_notes(date.fromisoformat(now_iso()[:10]))
    ]
    target = root / "threads" / "topics" / "target.md"
    stamp = now_iso()
    target.write_text(
        f"---\nid: target\ntitle: Target\ntype: topic\ntags: []\ncreated: {stamp}\nmodified: {stamp}\nauthor: user\nstatus: active\nhistory: []\n---\n[[Secret]]"
    )
    chain = ReadChain(root, chat_provider=cloud).execute("weaver", target)
    assert "UNIQUE_PRIVATE_SENTINEL" not in chain.context_text
