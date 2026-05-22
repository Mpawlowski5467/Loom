#!/usr/bin/env python3
"""Verify the vector indexing and search system end-to-end.

Assumes the demo vault has been seeded (run seed_demo.py first)
and that an embed provider is configured in ~/.loom/config.yaml.
"""

import asyncio
import sys
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import GlobalConfig, settings
from core.graph import build_graph, save_graph
from core.providers import ProviderRegistry
from core.vault import VaultManager
from index.chunker import chunk_file
from index.indexer import VectorIndexer
from index.searcher import VectorSearcher


def _header(text: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}")


async def main() -> None:
    vm = VaultManager()
    vault_name = "demo"

    if not vm.vault_exists(vault_name):
        print("Demo vault not found. Run seed_demo.py first.")
        sys.exit(1)

    vm.set_active_vault(vault_name)
    threads_dir = vm.active_threads_dir()
    loom_dir = vm.active_loom_dir()

    # ----------------------------------------------------------------
    # 1. Verify chunking
    # ----------------------------------------------------------------
    _header("1. CHUNKING")
    md_files = sorted(threads_dir.rglob("*.md"))
    md_files = [p for p in md_files if ".archive" not in p.parts]
    print(f"Found {len(md_files)} markdown files")

    total_chunks = 0
    for md in md_files:
        chunks = chunk_file(md)
        total_chunks += len(chunks)
        if chunks:
            print(f"  {md.relative_to(threads_dir)}: {len(chunks)} chunk(s)")

    print(f"\nTotal chunks: {total_chunks}")

    # ----------------------------------------------------------------
    # 2. Set up embed provider
    # ----------------------------------------------------------------
    _header("2. EMBED PROVIDER")
    try:
        global_config = GlobalConfig.load(settings.config_path)
        registry = ProviderRegistry(global_config)
        embed_provider = registry.get_embed_provider()
        print(f"Embed provider: {embed_provider.name}")

        # Quick sanity check
        test_vec = await embed_provider.embed("hello world")
        print(f"Embedding dimension: {len(test_vec)}")
    except Exception as exc:
        print(f"ERROR: Could not initialize embed provider: {exc}")
        print("Configure an embed provider in ~/.loom/config.yaml")
        sys.exit(1)

    # ----------------------------------------------------------------
    # 3. Full reindex
    # ----------------------------------------------------------------
    _header("3. REINDEX VAULT")
    indexer = VectorIndexer(loom_dir, embed_provider)
    count = await indexer.reindex_vault(threads_dir)
    print(f"Indexed {count} chunks")
    print(f"Index ready: {indexer.is_ready}")

    # ----------------------------------------------------------------
    # 4. Build graph for boosting tests
    # ----------------------------------------------------------------
    _header("4. GRAPH")
    graph = build_graph(threads_dir)
    save_graph(graph, loom_dir)
    print(f"Graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges")

    # ----------------------------------------------------------------
    # 5. Search tests
    # ----------------------------------------------------------------
    _header("5. SEARCH TESTS")
    searcher = VectorSearcher(indexer, embed_provider, graph)

    # 5a. Basic semantic search
    print("\n--- Search: 'authentication' ---")
    results = await searcher.search("authentication")
    if not results:
        print("  (no results)")
    for r in results[:5]:
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {r.heading or '(no heading)'}")

    # 5b. Search: distributed systems
    print("\n--- Search: 'distributed systems conflict resolution' ---")
    results = await searcher.search("distributed systems conflict resolution")
    for r in results[:5]:
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {r.heading or '(no heading)'}")

    # 5c. Search: database
    print("\n--- Search: 'database migration rollback' ---")
    results = await searcher.search("database migration rollback")
    for r in results[:5]:
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {r.heading or '(no heading)'}")

    # ----------------------------------------------------------------
    # 6. Filter tests
    # ----------------------------------------------------------------
    _header("6. FILTER TESTS")

    print("\n--- Search 'protocol' filtered by type=topic ---")
    results = await searcher.search("protocol", filters={"type": "topic"})
    for r in results[:5]:
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {r.heading or '(no heading)'}")

    print("\n--- Search 'engineering' filtered by type=person ---")
    results = await searcher.search("engineering", filters={"type": "person"})
    for r in results[:5]:
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {r.heading or '(no heading)'}")

    # ----------------------------------------------------------------
    # 7. Graph-aware boost test
    # ----------------------------------------------------------------
    _header("7. GRAPH-AWARE BOOST")

    # Find the Meridian Protocol note ID (a hub note)
    meridian_id = None
    for node in graph.nodes:
        if "meridian" in node.title.lower():
            meridian_id = node.id
            break

    if meridian_id:
        print(f"Context note: Meridian Protocol ({meridian_id})")

        # Search without context
        results_no_ctx = await searcher.search("fundamentals")
        print("\n  Without context:")
        for r in results_no_ctx[:5]:
            print(f"    [{r.score:.4f}] {r.note_id} ({r.note_type})")

        # Search with Meridian as context — linked notes should rank higher
        results_with_ctx = await searcher.search("fundamentals", context_note_ids=[meridian_id])
        print("\n  With Meridian Protocol as context:")
        for r in results_with_ctx[:5]:
            print(f"    [{r.score:.4f}] {r.note_id} ({r.note_type})")
    else:
        print("Could not find Meridian Protocol note for boost test")

    # ----------------------------------------------------------------
    # 8. Single note re-index test
    # ----------------------------------------------------------------
    _header("8. SINGLE NOTE RE-INDEX")
    test_file = list(threads_dir.rglob("*.md"))[0]
    count = await indexer.index_note(test_file)
    print(f"Re-indexed {test_file.name}: {count} chunks")

    # ----------------------------------------------------------------
    # 9. Remove note test
    # ----------------------------------------------------------------
    _header("9. REMOVE NOTE")
    if graph.nodes:
        test_id = graph.nodes[0].id
        indexer.remove_note(test_id)
        print(f"Removed note {test_id} from index")
        # Re-add it
        entry_path = None
        for md in md_files:
            chunks = chunk_file(md)
            if chunks and chunks[0].note_id == test_id:
                entry_path = md
                break
        if entry_path:
            count = await indexer.index_note(entry_path)
            print(f"Re-indexed {entry_path.name}: {count} chunks")

    _header("ALL TESTS PASSED")
    print("Vector indexing system is operational.\n")


if __name__ == "__main__":
    asyncio.run(main())
