#!/usr/bin/env python3
"""Inspect a vault's LanceDB vector index.

A read-only companion to ``verify_index.py``. Where that script *exercises*
the index (reindex + test searches), this one lets you *browse* what is
actually stored: row counts, chunks per note, and sample rows. Inspection
needs no AI provider — it opens the LanceDB table directly. The optional
``--search`` mode does need a configured embed provider, since it has to
embed the query.

Usage:
    python scripts/inspect_index.py                  # active vault, summary
    python scripts/inspect_index.py <vault>          # named vault, summary
    python scripts/inspect_index.py <vault> --rows 30
    python scripts/inspect_index.py <vault> --search "auth rollback"
    python scripts/inspect_index.py --list           # list vaults + index status
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Allow running from the repo root or backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import lancedb

from core.vault import VaultManager
from index.indexer import TABLE_NAME

# Columns shown in sample/table output. The vector column is intentionally
# excluded — it is hundreds of floats per row and unreadable in a terminal.
_DISPLAY_COLUMNS = ["id", "note_id", "chunk_index", "note_type", "heading", "text"]
_TEXT_PREVIEW = 60


def _header(text: str) -> None:
    print(f"\n{'=' * 64}")
    print(f"  {text}")
    print(f"{'=' * 64}")


def _index_db_path(vm: VaultManager, vault: str) -> Path:
    """Return the LanceDB path for a vault (matches VectorIndexer)."""
    return vm.vault_path(vault) / ".loom" / "index.db"


def _open_table(db_path: Path) -> Any | None:
    """Open the chunks table read-only, or return None if it doesn't exist."""
    if not db_path.exists():
        return None
    db = lancedb.connect(str(db_path))
    if TABLE_NAME not in db.list_tables().tables:
        return None
    return db.open_table(TABLE_NAME)


def _truncate(value: Any, width: int = _TEXT_PREVIEW) -> str:
    """Collapse whitespace and cap a cell value for terminal display."""
    text = " ".join(str(value).split())
    return text if len(text) <= width else text[: width - 1] + "…"


def _print_rows(rows: list[dict[str, Any]]) -> None:
    """Print selected columns of LanceDB rows as an aligned table."""
    if not rows:
        print("  (no rows)")
        return
    cols = [c for c in _DISPLAY_COLUMNS if c in rows[0]]
    widths = {c: len(c) for c in cols}
    rendered: list[dict[str, str]] = []
    for row in rows:
        cells = {c: _truncate(row.get(c, "")) for c in cols}
        for c in cols:
            widths[c] = max(widths[c], len(cells[c]))
        rendered.append(cells)
    print("  " + "  ".join(c.ljust(widths[c]) for c in cols))
    print("  " + "  ".join("-" * widths[c] for c in cols))
    for cells in rendered:
        print("  " + "  ".join(cells[c].ljust(widths[c]) for c in cols))


def _list_vaults(vm: VaultManager) -> None:
    """Print every vault with whether its index exists and its row count."""
    _header("VAULTS")
    active = vm.get_active_vault()
    vaults = vm.list_vaults()
    if not vaults:
        print("  (no vaults found under ~/.loom/vaults/)")
        return
    for name in vaults:
        table = _open_table(_index_db_path(vm, name))
        status = "no index" if table is None else f"{table.count_rows()} chunks"
        marker = "* " if name == active else "  "
        print(f"{marker}{name:<24} {status}")
    print("\n* = active vault")


def _summarize(table: Any, sample_rows: int) -> None:
    """Print row count, chunks-per-note ranking, type breakdown, and a sample."""
    total = table.count_rows()
    # Pull everything except the vector for analysis (indexes are small —
    # thousands of chunks at most — so a full scan is fine).
    rows: list[dict[str, Any]] = table.search().limit(total).to_list()
    for row in rows:
        row.pop("vector", None)

    _header("SUMMARY")
    note_ids = {r.get("note_id") for r in rows}
    print(f"  chunks table : {total} rows")
    print(f"  distinct notes: {len(note_ids)}")
    if note_ids:
        print(f"  avg chunks/note: {total / len(note_ids):.1f}")

    type_counts = Counter(r.get("note_type", "?") for r in rows)
    if type_counts:
        _header("CHUNKS BY NOTE TYPE")
        for note_type, count in type_counts.most_common():
            print(f"  {note_type:<12} {count}")

    chunks_per_note = Counter(r.get("note_id") for r in rows)
    heading_by_note = {r.get("note_id"): r.get("heading") for r in rows}
    _header("TOP NOTES BY CHUNK COUNT")
    for note_id, count in chunks_per_note.most_common(10):
        heading = heading_by_note.get(note_id) or "(no heading)"
        print(f"  {note_id:<16} {count:>3}  {_truncate(heading, 40)}")

    _header(f"SAMPLE ROWS (first {sample_rows})")
    _print_rows(rows[:sample_rows])


async def _run_search(vm: VaultManager, vault: str, query: str) -> None:
    """Embed a query and print ranked search hits (needs an embed provider)."""
    from core.config import GlobalConfig, settings
    from core.graph import build_graph
    from core.providers import ProviderRegistry
    from index.indexer import VectorIndexer
    from index.searcher import VectorSearcher

    try:
        registry = ProviderRegistry(GlobalConfig.load(settings.config_path))
        embed_provider = registry.get_embed_provider()
    except Exception as exc:  # noqa: BLE001 — surface any config/provider error plainly
        print(f"\n--search needs an embed provider, but none is usable: {exc}")
        print("Configure one in ~/.loom/config.yaml, or omit --search.")
        return

    loom_dir = vm.vault_path(vault) / ".loom"
    indexer = VectorIndexer(loom_dir, embed_provider)
    graph = build_graph(vm.vault_path(vault) / "threads")
    searcher = VectorSearcher(indexer, embed_provider, graph)

    _header(f"SEARCH: {query!r}  (embed: {embed_provider.name})")
    results = await searcher.search(query)
    if not results:
        print("  (no results)")
        return
    for r in results[:10]:
        heading = r.heading or "(no heading)"
        print(f"  [{r.score:.4f}] {r.note_id} ({r.note_type}) — {_truncate(heading, 40)}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect a vault's LanceDB vector index.")
    parser.add_argument(
        "vault",
        nargs="?",
        help="Vault name (defaults to the active vault).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all vaults and their index status, then exit.",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=15,
        help="Number of sample rows to print (default: 15).",
    )
    parser.add_argument(
        "--search",
        metavar="QUERY",
        help="Run a semantic search (requires a configured embed provider).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    vm = VaultManager()

    if args.list:
        _list_vaults(vm)
        return

    vault = args.vault or vm.get_active_vault()
    if not vm.vault_exists(vault):
        print(f"Vault {vault!r} not found. Use --list to see available vaults.")
        sys.exit(1)

    print(f"Vault: {vault}")
    print(f"Index: {_index_db_path(vm, vault)}")

    table = _open_table(_index_db_path(vm, vault))
    if table is None:
        print("\nNo index table yet — this vault has not been indexed, or no")
        print("embed provider was configured when its notes were written.")
        print("Run scripts/verify_index.py (or open the app with a provider) to build it.")
        sys.exit(0)

    _summarize(table, args.rows)

    if args.search:
        import asyncio

        asyncio.run(_run_search(vm, vault, args.search))


if __name__ == "__main__":
    main()
