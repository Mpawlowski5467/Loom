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
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from agents.base import BaseAgent
from core.note_index import get_note_index
from core.notes import Note, now_iso, parse_note, parse_note_meta

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

# -- Thresholds (configurable via linking policy) ----------------------------

AUTO_LINK_THRESHOLD = 0.75
SUGGEST_THRESHOLD = 0.50
MAX_CANDIDATES = 10

# -- LLM prompt for fallback connection finding ------------------------------

_FIND_CONNECTIONS_SYSTEM = """\
You are the Spider agent in a knowledge management system. Your job is to
identify meaningful connections between notes.

Given a source note and a list of existing vault notes (title + tags), return
the titles of notes that have a meaningful conceptual relationship with the
source. Only suggest connections that add real value — not just keyword overlap.

Respond with one title per line. No bullet points, no explanations. Just titles.
If there are no meaningful connections, respond with "NONE".
"""


@dataclass
class LinkCandidate:
    """A potential link discovered by Spider."""

    note_id: str
    title: str
    score: float
    decision: str  # "auto-linked", "suggested", "skipped"
    reason: str = ""


@dataclass
class ScanReport:
    """Full result of a Spider scan on a single note."""

    source_id: str
    source_title: str
    candidates: list[LinkCandidate] = field(default_factory=list)
    auto_linked: list[str] = field(default_factory=list)
    suggested: list[str] = field(default_factory=list)
    skipped: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API responses."""
        return {
            "source_id": self.source_id,
            "source_title": self.source_title,
            "auto_linked": self.auto_linked,
            "suggested": self.suggested,
            "skipped": self.skipped,
            "candidates": [
                {
                    "note_id": c.note_id,
                    "title": c.title,
                    "score": round(c.score, 4),
                    "decision": c.decision,
                    "reason": c.reason,
                }
                for c in self.candidates
            ],
        }


@dataclass
class VaultScanReport:
    """Full result of a Spider scan across the whole vault."""

    reports: list[ScanReport] = field(default_factory=list)
    total_auto_linked: int = 0
    total_suggested: int = 0
    total_skipped: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API responses."""
        return {
            "notes_scanned": len(self.reports),
            "total_auto_linked": self.total_auto_linked,
            "total_suggested": self.total_suggested,
            "total_skipped": self.total_skipped,
            "reports": [r.to_dict() for r in self.reports if r.auto_linked or r.suggested],
        }


class Spider(BaseAgent):
    """Spider maintains bidirectional wikilinks across the vault."""

    @property
    def name(self) -> str:
        return "spider"

    @property
    def role(self) -> str:
        return "Linker: discovers and maintains connections between notes"

    # -- Public API ----------------------------------------------------------

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

            # Collect existing links (bidirectional) to skip
            existing_links = self._collect_existing_links(note, note_path)

            # Find and score candidates
            candidates = await self._find_candidates(note, existing_links)
            report.candidates = candidates

            # Separate by decision
            to_link = [c for c in candidates if c.decision == "auto-linked"]
            to_suggest = [c for c in candidates if c.decision == "suggested"]
            report.skipped = sum(1 for c in candidates if c.decision == "skipped")

            # Apply auto-links
            if to_link:
                linked_titles = self._apply_links(note_path, note, [c.title for c in to_link])
                report.auto_linked = linked_titles

            report.suggested = [c.title for c in to_suggest]

            # Build details string for changelog
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
        threads_dir = self._vault_root / "threads"
        if not threads_dir.exists():
            return 0

        md_files = [
            p
            for p in threads_dir.rglob("*.md")
            if ".archive" not in p.parts and p.name != "_index.md"
        ]

        total = 0
        for md_path in md_files:
            try:
                linked = await self.scan_for_connections(md_path)
                total += len(linked)
            except Exception:  # noqa: BLE001
                logger.debug("Spider scan failed for %s", md_path, exc_info=True)
        return total

    async def scan_vault_report(self) -> VaultScanReport:
        """Run scan_and_report on all notes. Returns full vault report."""
        threads_dir = self._vault_root / "threads"
        vault_report = VaultScanReport()

        if not threads_dir.exists():
            return vault_report

        md_files = [
            p
            for p in threads_dir.rglob("*.md")
            if ".archive" not in p.parts and p.name != "_index.md"
        ]

        for md_path in md_files:
            try:
                report = await self.scan_and_report(md_path)
                vault_report.reports.append(report)
                vault_report.total_auto_linked += len(report.auto_linked)
                vault_report.total_suggested += len(report.suggested)
                vault_report.total_skipped += report.skipped
            except Exception:  # noqa: BLE001
                logger.debug("Spider scan failed for %s", md_path, exc_info=True)

        return vault_report

    # -- Candidate finding ---------------------------------------------------

    async def _find_candidates(self, note: Note, existing_links: set[str]) -> list[LinkCandidate]:
        """Find and score candidate links using vector search or fallback."""
        # Try vector search first
        candidates = await self._find_candidates_vector(note, existing_links)

        # Fall back to LLM or heuristic if vector search returned nothing
        if not candidates:
            candidates = await self._find_candidates_fallback(note, existing_links)

        return candidates

    async def _find_candidates_vector(
        self, note: Note, existing_links: set[str]
    ) -> list[LinkCandidate]:
        """Use vector search to find semantically similar notes."""
        from index.searcher import get_searcher

        searcher = get_searcher()
        if searcher is None:
            return []

        # Build a search query from the note's title, tags, and body preview
        query = f"{note.title} {' '.join(note.tags)} {note.body[:500]}"

        try:
            results = await searcher.search(
                query,
                context_note_ids=[note.id],
                limit=MAX_CANDIDATES * 2,  # fetch extra, we'll filter
            )
        except Exception:  # noqa: BLE001
            logger.warning("Vector search failed for Spider", exc_info=True)
            return []

        candidates: list[LinkCandidate] = []
        for result in results:
            # Skip self
            if result.note_id == note.id:
                continue

            # Look up the note title from the index
            title = self._resolve_title(result.note_id)
            if not title:
                continue

            # Skip already-linked notes
            if title.lower() in existing_links:
                continue

            # Score → decision
            decision, reason = self._score_decision(result.score, title)
            candidates.append(
                LinkCandidate(
                    note_id=result.note_id,
                    title=title,
                    score=result.score,
                    decision=decision,
                    reason=reason,
                )
            )

            if len(candidates) >= MAX_CANDIDATES:
                break

        return candidates

    async def _find_candidates_fallback(
        self, note: Note, existing_links: set[str]
    ) -> list[LinkCandidate]:
        """Fall back to LLM or heuristic tag-overlap matching."""
        threads_dir = self._vault_root / "threads"
        vault_notes = self._list_vault_notes(threads_dir, exclude_id=note.id)

        if not vault_notes:
            return []

        if self._chat_provider is not None:
            titles = await self._find_connections_llm(note, vault_notes)
        else:
            titles = self._find_connections_heuristic(note, vault_notes)

        # Convert to candidates — heuristic/LLM results get a flat score
        candidates: list[LinkCandidate] = []
        for i, title in enumerate(titles):
            if title.lower() in existing_links:
                continue

            # Assign decreasing scores: LLM/heuristic results are ranked
            score = 0.85 - (i * 0.05)
            score = max(score, 0.4)
            decision, reason = self._score_decision(score, title)
            note_id = self._resolve_id(title, vault_notes)

            candidates.append(
                LinkCandidate(
                    note_id=note_id,
                    title=title,
                    score=score,
                    decision=decision,
                    reason=reason,
                )
            )

        return candidates

    # -- Score decision logic ------------------------------------------------

    @staticmethod
    def _score_decision(score: float, title: str) -> tuple[str, str]:
        """Map a confidence score to a linking decision."""
        if score >= AUTO_LINK_THRESHOLD:
            return "auto-linked", f"High confidence ({score:.2f}) — auto-linked"
        if score >= SUGGEST_THRESHOLD:
            return "suggested", f"Medium confidence ({score:.2f}) — suggested for review"
        return "skipped", f"Low confidence ({score:.2f}) — below threshold"

    # -- Existing link collection --------------------------------------------

    def _collect_existing_links(self, note: Note, note_path: Path) -> set[str]:
        """Collect all titles already linked from or to this note."""
        existing = {wl.lower() for wl in note.wikilinks}

        # Also check for backlinks: notes that already link TO this note
        threads_dir = self._vault_root / "threads"
        title_map = self._build_title_map(threads_dir)

        for title_lower, path in title_map.items():
            if path == note_path:
                continue
            try:
                other = parse_note(path)
                if note.title.lower() in [wl.lower() for wl in other.wikilinks]:
                    existing.add(title_lower)
            except Exception:  # noqa: BLE001
                continue

        return existing

    # -- LLM / heuristic fallbacks (unchanged) -------------------------------

    async def _find_connections_llm(self, note: Note, vault_notes: list[dict]) -> list[str]:
        """Use LLM to find meaningful connections."""
        note_list = "\n".join(
            f"- {n['title']} (tags: {', '.join(n['tags'])})" for n in vault_notes[:50]
        )
        user_msg = (
            f"Source note:\nTitle: {note.title}\nType: {note.type}\n"
            f"Tags: {', '.join(note.tags)}\nContent preview: {note.body[:1500]}\n\n"
            f"Vault notes:\n{note_list}\n\n"
            f"Which notes should be linked to the source? (max {MAX_CANDIDATES})"
        )

        try:
            resp = await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=_FIND_CONNECTIONS_SYSTEM,
            )
            if "NONE" in resp.upper():
                return []
            titles = [line.strip() for line in resp.strip().splitlines() if line.strip()]
            valid = {n["title"].lower(): n["title"] for n in vault_notes}
            return [valid[t.lower()] for t in titles[:MAX_CANDIDATES] if t.lower() in valid]
        except Exception:  # noqa: BLE001
            logger.warning("LLM connection finding failed, using heuristic", exc_info=True)
            return self._find_connections_heuristic(note, vault_notes)

    @staticmethod
    def _find_connections_heuristic(note: Note, vault_notes: list[dict]) -> list[str]:
        """Find connections by tag overlap."""
        if not note.tags:
            return []

        note_tags = {t.lower() for t in note.tags}
        scored: list[tuple[int, str]] = []

        for vn in vault_notes:
            overlap = len(note_tags & {t.lower() for t in vn["tags"]})
            if overlap > 0:
                scored.append((overlap, vn["title"]))

        scored.sort(key=lambda x: -x[0])
        return [title for _, title in scored[:MAX_CANDIDATES]]

    # -- Link application (unchanged core logic) -----------------------------

    def _apply_links(
        self, source_path: Path, source_note: Note, target_titles: list[str]
    ) -> list[str]:
        """Add wikilinks to source note and backlinks to targets."""
        threads_dir = self._vault_root / "threads"
        title_map = self._build_title_map(threads_dir)
        ts = now_iso()
        linked: list[str] = []

        for title in target_titles:
            target_path = title_map.get(title.lower())
            if target_path is None or target_path == source_path:
                continue

            self._add_link_to_note(source_path, title, ts, f"Spider linked to [[{title}]]")
            self._add_link_to_note(
                target_path,
                source_note.title,
                ts,
                f"Spider added backlink from [[{source_note.title}]]",
            )
            linked.append(title)

        return linked

    @staticmethod
    def _add_link_to_note(path: Path, link_title: str, ts: str, reason: str) -> None:
        """Append a wikilink to a note if not already present."""
        note = parse_note(path)
        if link_title.lower() in [wl.lower() for wl in note.wikilinks]:
            return

        new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {"action": "linked", "by": "agent:spider", "at": ts, "reason": reason}
        )

        from core.notes import note_to_file_content

        path.write_text(note_to_file_content(meta, new_body), encoding="utf-8")

    # -- Helpers -------------------------------------------------------------

    def _resolve_title(self, note_id: str) -> str:
        """Look up a note title by ID from the index."""
        index = get_note_index()
        if index.size > 0:
            entry = index.get_by_id(note_id)
            if entry is not None:
                return entry.title
        # Fallback: scan disk
        threads_dir = self._vault_root / "threads"
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts:
                continue
            try:
                meta = parse_note_meta(md)
                if meta.id == note_id:
                    return meta.title
            except Exception:  # noqa: BLE001
                continue
        return ""

    @staticmethod
    def _resolve_id(title: str, vault_notes: list[dict]) -> str:
        """Look up a note ID by title from the vault notes list."""
        for vn in vault_notes:
            if vn["title"].lower() == title.lower():
                return vn.get("id", "")
        return ""

    def _list_vault_notes(self, threads_dir: Path, exclude_id: str = "") -> list[dict]:
        """List all vault notes as dicts with title and tags."""
        index = get_note_index()
        if index.size > 0:
            return [
                {"title": e.title, "tags": e.tags, "id": e.id}
                for e in index.all_entries()
                if e.id != exclude_id
            ]
        notes: list[dict] = []
        if not threads_dir.exists():
            return notes
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts or md.name == "_index.md":
                continue
            try:
                meta = parse_note_meta(md)
                if meta.id and meta.id != exclude_id:
                    notes.append({"title": meta.title, "tags": list(meta.tags), "id": meta.id})
            except Exception:  # noqa: BLE001
                continue
        return notes

    @staticmethod
    def _build_title_map(threads_dir: Path) -> dict[str, Path]:
        """Build lowercase-title → path map, preferring the cached NoteIndex."""
        index = get_note_index()
        if index.size > 0:
            return index.get_title_map()
        title_map: dict[str, Path] = {}
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts:
                continue
            try:
                meta = parse_note_meta(md)
                if meta.title:
                    title_map[meta.title.lower()] = md
            except Exception:  # noqa: BLE001
                continue
        return title_map


_spider: Spider | None = None


def get_spider() -> Spider | None:
    return _spider


def init_spider(vault_root: Path, chat_provider: BaseProvider | None = None) -> Spider:
    global _spider
    _spider = Spider(vault_root, chat_provider)
    return _spider
