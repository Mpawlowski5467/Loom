"""Spider agent: the linker. Scans notes for connections and maintains
bidirectional wikilinks across the vault.

Uses vector search for semantic similarity when available, falls back to
tag-overlap heuristics. Each candidate link gets a confidence score:
  - >= auto_link_threshold  → linked automatically
  - >= suggest_threshold    → suggested but not auto-linked
  - below suggest_threshold → ignored
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from agents.base import BaseAgent
from agents.loom.spider_candidates import find_candidates
from agents.loom.spider_linker import apply_links
from agents.loom.spider_lookup import build_title_map
from agents.loom.spider_models import ScanReport, VaultScanReport
from core.notes import Note, parse_note

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)


class Spider(BaseAgent):
    """Spider maintains bidirectional wikilinks across the vault."""

    @property
    def name(self) -> str:
        return "spider"

    @property
    def role(self) -> str:
        return "Linker: discovers and maintains connections between notes"

    async def scan_for_connections(self, note_path: Path) -> list[str]:
        """Scan a note and auto-link above threshold. Returns linked titles."""
        report = await self.scan_and_report(note_path)
        return report.auto_linked

    async def scan_and_report(self, note_path: Path) -> ScanReport:
        """Scan a note, score candidates, auto-link or suggest. Returns full report."""

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            note = parse_note(note_path)
            if not note.id:
                return {
                    "action": "skipped",
                    "details": "No note ID",
                    "linked": [],
                    "_report": ScanReport(
                        source_id="", source_title=note.title, error="No note ID"
                    ),
                }

            report = ScanReport(source_id=note.id, source_title=note.title)

            existing_links = self._collect_existing_links(note, note_path)
            candidates = await find_candidates(
                self._vault_root, note, existing_links, self._chat_provider
            )
            report.candidates = candidates

            to_link = [c for c in candidates if c.decision == "auto-linked"]
            to_suggest = [c for c in candidates if c.decision == "suggested"]
            report.skipped = sum(1 for c in candidates if c.decision == "skipped")

            if to_link:
                linked_titles = apply_links(
                    self._vault_root, note_path, note, [c.title for c in to_link]
                )
                report.auto_linked = linked_titles

            report.suggested = [c.title for c in to_suggest]

            parts: list[str] = []
            if report.auto_linked:
                parts.append(
                    f"Auto-linked {len(report.auto_linked)}: {', '.join(report.auto_linked)}"
                )
            if report.suggested:
                parts.append(f"Suggested {len(report.suggested)}: {', '.join(report.suggested)}")
            if report.skipped:
                parts.append(f"Skipped {report.skipped} below threshold")

            action = "linked" if report.auto_linked else "scanned"
            details = "; ".join(parts) if parts else "No new connections found"

            return {
                "action": action,
                "details": details,
                "linked": report.auto_linked,
                "_report": report,
            }

        result = await self.execute_with_chain(note_path, _action)
        return result.get("_report", ScanReport(source_id="", source_title=""))

    async def scan_vault(self) -> int:
        """Run scan_for_connections on all notes. Returns total new links."""
        total = 0
        for md_path in self._iter_vault_notes():
            try:
                linked = await self.scan_for_connections(md_path)
                total += len(linked)
            except Exception:
                logger.warning("Spider scan failed for %s", md_path, exc_info=True)
        return total

    async def scan_vault_report(self) -> VaultScanReport:
        """Run scan_and_report on all notes. Returns full vault report."""
        vault_report = VaultScanReport()

        for md_path in self._iter_vault_notes():
            try:
                report = await self.scan_and_report(md_path)
                vault_report.reports.append(report)
                vault_report.total_auto_linked += len(report.auto_linked)
                vault_report.total_suggested += len(report.suggested)
                vault_report.total_skipped += report.skipped
            except Exception:
                logger.warning("Spider scan failed for %s", md_path, exc_info=True)

        return vault_report

    def _iter_vault_notes(self) -> list[Path]:
        """Iterate over all linkable notes in the vault."""
        threads_dir = self._vault_root / "threads"
        if not threads_dir.exists():
            return []
        return [
            p
            for p in threads_dir.rglob("*.md")
            if ".archive" not in p.parts and p.name != "_index.md"
        ]

    def _collect_existing_links(self, note: Note, note_path: Path) -> set[str]:
        """Collect all titles already linked from or to this note."""
        existing = {wl.lower() for wl in note.wikilinks}

        threads_dir = self._vault_root / "threads"
        title_map = build_title_map(threads_dir)

        for title_lower, path in title_map.items():
            if path == note_path:
                continue
            try:
                other = parse_note(path)
                if note.title.lower() in [wl.lower() for wl in other.wikilinks]:
                    existing.add(title_lower)
            except (OSError, yaml.YAMLError, ValidationError, ValueError):
                continue

        return existing


_spider: Spider | None = None


def get_spider() -> Spider | None:
    return _spider


def init_spider(vault_root: Path, chat_provider: BaseProvider | None = None) -> Spider:
    global _spider
    _spider = Spider(vault_root, chat_provider)
    return _spider
