"""End-to-end HTTP smoke test: capture → /process → /graph + /search.

Every other API test mocks an agent or the runner in isolation, and the
direct-runner E2E (``test_pipeline_e2e.py``) never touches the FastAPI layer.
Nothing proves the *whole HTTP chain composes*: that dropping a capture file
and POSTing to ``/api/captures/process`` produces a real note which is then
discoverable through ``GET /api/graph`` and ``GET /api/search`` — all over the
Starlette TestClient, with stubbed chat/embed providers so nothing hits the
network.

This test drives that chain through the routers (not the runner directly),
wiring the global Loom agent singletons the ``/process`` route pulls
(``get_weaver``/``get_spider``/``get_scribe``/``get_sentinel``) against the
*same* vault dir the injected ``VaultManager`` uses.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from starlette.testclient import TestClient

from core.note_index import NoteIndex
from core.notes import build_frontmatter
from core.vault import VaultManager
from tests.conftest import _seed_notes

_EMBED_DIM = 16


@pytest.fixture(autouse=True)
def _reset_singletons() -> Iterator[None]:
    """Isolate every process-global the test touches, restoring prior values.

    The autouse ``conftest._hermetic_globals`` only resets the rate limiter and
    the note-index singleton. This test additionally initializes the indexer,
    the searcher, and the four Loom agent globals (``_weaver``/``_spider``/
    ``_scribe``/``_sentinel``) — none of which conftest restores. Without this,
    a later test that does *not* patch ``get_weaver`` would see this test's
    weaver pointed at a now-deleted temp vault. Mirror ``test_pipeline_e2e``'s
    ``_reset_singletons`` and additionally null the agent globals back out.
    """
    from agents.loom import scribe as scribe_mod
    from agents.loom import sentinel as sentinel_mod
    from agents.loom import spider as spider_mod
    from agents.loom import weaver as weaver_mod
    from index import indexer as idx_mod
    from index import searcher as srch_mod

    idx_mod.reset_indexer()
    srch_mod.reset_searcher()
    prev_weaver = weaver_mod._weaver
    prev_spider = spider_mod._spider
    prev_scribe = scribe_mod._scribe
    prev_sentinel = sentinel_mod._sentinel
    yield
    idx_mod.reset_indexer()
    srch_mod.reset_searcher()
    weaver_mod._weaver = prev_weaver
    spider_mod._spider = prev_spider
    scribe_mod._scribe = prev_scribe
    sentinel_mod._sentinel = prev_sentinel


def _stub_chat() -> AsyncMock:
    """A chat provider that classifies as a topic and emits a wikilinked body.

    Copied from ``test_pipeline_e2e._stub_chat``: the first ``chat`` call is the
    Weaver classification, the second emits the structured markdown body
    (carrying a ``[[wikilink]]`` so the produced note is genuinely linked).
    """
    chat = AsyncMock()
    chat.chat = AsyncMock(
        side_effect=[
            "type: topic\nfolder: topics\ntitle: Raft Consensus\ntags: distributed, consensus",
            "## Summary\n\nRaft is a consensus algorithm.\n\n"
            "## Details\n\nElects a leader; see [[Paxos]] for contrast.\n\n"
            "## References\n\n- [[Distributed Systems]]\n",
        ]
    )
    return chat


def _stub_embed() -> AsyncMock:
    """An embedder returning a fixed-dimension constant vector.

    Unused on the keyword search path this test takes, but constructed (never a
    real provider) so the wiring is honest if the assertions are ever flipped to
    the semantic path.
    """
    embed = AsyncMock()
    embed.embed = AsyncMock(return_value=[0.1] * _EMBED_DIM)
    return embed


def _write_capture_file(threads_dir: Path, filename: str, title: str, body: str) -> str:
    """Drop a valid-frontmatter capture file into threads/captures/.

    Returns the capture id (the route processes by path; we keep the id only for
    documentation symmetry with the runner tests).
    """
    capture_id = f"thr_{filename[:6]}"
    meta: dict[str, object] = {
        "id": capture_id,
        "title": title,
        "type": "capture",
        "tags": ["inbox"],
        "created": "2026-03-15T10:00:00+00:00",
        "modified": "2026-03-15T10:00:00+00:00",
        "author": "user",
        "source": "manual",
        "status": "active",
    }
    captures_dir = threads_dir / "captures"
    captures_dir.mkdir(parents=True, exist_ok=True)
    (captures_dir / filename).write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return capture_id


class TestApiE2ESmoke:
    def test_capture_process_graph_search_compose(
        self,
        client: TestClient,
        vault_manager: VaultManager,
        note_index: NoteIndex,
    ) -> None:
        """A capture POSTed to /process becomes a note in /graph and /search."""
        # --- Arrange: a real, scaffolded, active vault (agent dirs + rules). ---
        # ``_seed_notes`` calls init_vault + set_active_vault, so
        # ``vm.active_vault_dir()`` resolves and every Loom agent has its
        # config.yaml / memory.md / state.json / changelog dir on disk.
        root = _seed_notes(vault_manager, note_index, [])
        assert root == vault_manager.active_vault_dir()

        # Wire the four Loom agent singletons the /process route pulls, against
        # the SAME vault dir the injected VaultManager uses. Only Weaver needs a
        # chat provider; Spider/Scribe/Sentinel run their deterministic paths.
        from agents.loom.scribe import init_scribe
        from agents.loom.sentinel import init_sentinel
        from agents.loom.spider import init_spider
        from agents.loom.weaver import init_weaver

        init_weaver(root, _stub_chat())
        init_spider(root, None)
        init_scribe(root, None)
        init_sentinel(root, None)

        # Construct a stub embedder (never a real provider). Not initialized as a
        # searcher here — we assert the keyword fallback path (see caveats).
        _ = _stub_embed()

        # --- Act 1: drop a capture file into the inbox. ---
        capture_name = "cap-raft.md"
        _write_capture_file(
            vault_manager.active_threads_dir(),
            capture_name,
            "Raft notes",
            "Notes on the Raft consensus protocol.\n",
        )

        # --- Act 2: process it through the HTTP route. ---
        resp = client.post(
            "/api/captures/process",
            json={"capture_path": f"captures/{capture_name}"},
        )

        # --- Assert: the pipeline ran and produced an archived topic note. ---
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["processed"] is True
        note_id = data["note_id"]
        assert note_id  # non-empty
        assert data["note_type"] == "topic"
        assert data["capture_archived"] is True

        # --- Assert: the note is a node in the knowledge graph. ---
        graph_resp = client.get("/api/graph")
        assert graph_resp.status_code == 200, graph_resp.text
        nodes = graph_resp.json()["nodes"]
        # Match strictly on the produced id so a graph-build id-derivation bug
        # can't be masked by a title coincidence.
        assert any(n["id"] == note_id for n in nodes), (
            f"produced note {note_id} (Raft Consensus) not found among {len(nodes)} graph nodes"
        )

        # --- Assert: the note is discoverable via search. ---
        # /process refreshed the NoteIndex (refresh_index=index.refresh_file), so
        # the keyword fallback (no searcher initialized → mode="keyword") finds
        # it over the full HTTP stack.
        search_resp = client.get("/api/search", params={"q": "Raft Consensus"})
        assert search_resp.status_code == 200, search_resp.text
        search_data = search_resp.json()
        assert search_data["mode"] == "keyword"
        result_ids = {r["id"] for r in search_data["results"]}
        assert note_id in result_ids, f"produced note {note_id} not in search results {result_ids}"
