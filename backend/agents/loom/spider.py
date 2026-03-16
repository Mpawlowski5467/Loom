"""Spider agent: the linker. Scans notes for connections and maintains
bidirectional wikilinks across the vault.
"""

from __future__ import annotations

import logging
import re
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

_FIND_CONNECTIONS_SYSTEM = """\
You are the Spider agent in a knowledge management system. Your job is to
identify meaningful connections between notes.

Given a source note and a list of existing vault notes (title + tags), return
the titles of notes that have a meaningful conceptual relationship with the
source. Only suggest connections that add real value — not just keyword overlap.

Respond with one title per line. No bullet points, no explanations. Just titles.
If there are no meaningful connections, respond with "NONE".
"""

MAX_SUGGESTIONS = 5


class Spider(BaseAgent):
    """Spider maintains bidirectional wikilinks across the vault."""

    @property
    def name(self) -> str:
        return "spider"

    @property
    def role(self) -> str:
        return "Linker: discovers and maintains connections between notes"

    async def scan_for_connections(self, note_path: Path) -> list[str]:
        """Scan a note and add bidirectional wikilinks to related notes.

        Returns list of note titles that were newly linked.
        """

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            note = parse_note(note_path)
            if not note.id:
                return {"action": "skipped", "details": "No note ID", "linked": []}

            existing_links = set(wl.lower() for wl in note.wikilinks)
            suggestions = await self._find_connections(note, chain)

            # Filter out already-linked notes
            new_links = [t for t in suggestions if t.lower() not in existing_links]
            if not new_links:
                return {"action": "scanned", "details": "No new connections found", "linked": []}

            # Add wikilinks to source and targets
            linked_titles = self._apply_links(note_path, note, new_links)

            return {
                "action": "linked",
                "details": f"Added {len(linked_titles)} link(s): {', '.join(linked_titles)}",
                "linked": linked_titles,
            }

        result = await self.execute_with_chain(note_path, _action)
        return result.get("linked", [])

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

    async def _find_connections(self, note: Note, chain: ReadChainResult) -> list[str]:
        """Identify related notes via LLM or title/tag overlap."""
        threads_dir = self._vault_root / "threads"
        vault_notes = self._list_vault_notes(threads_dir, exclude_id=note.id)

        if not vault_notes:
            return []

        if self._chat_provider is not None:
            return await self._find_connections_llm(note, vault_notes)
        return self._find_connections_heuristic(note, vault_notes)

    async def _find_connections_llm(self, note: Note, vault_notes: list[dict]) -> list[str]:
        """Use LLM to find meaningful connections."""
        note_list = "\n".join(
            f"- {n['title']} (tags: {', '.join(n['tags'])})" for n in vault_notes[:50]
        )
        user_msg = (
            f"Source note:\nTitle: {note.title}\nType: {note.type}\n"
            f"Tags: {', '.join(note.tags)}\nContent preview: {note.body[:1500]}\n\n"
            f"Vault notes:\n{note_list}\n\n"
            f"Which notes should be linked to the source? (max {MAX_SUGGESTIONS})"
        )

        try:
            resp = await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=_FIND_CONNECTIONS_SYSTEM,
            )
            if "NONE" in resp.upper():
                return []
            titles = [line.strip() for line in resp.strip().splitlines() if line.strip()]
            # Validate that suggested titles exist
            valid = {n["title"].lower(): n["title"] for n in vault_notes}
            return [valid[t.lower()] for t in titles[:MAX_SUGGESTIONS] if t.lower() in valid]
        except Exception:  # noqa: BLE001
            logger.warning("LLM connection finding failed, using heuristic", exc_info=True)
            return self._find_connections_heuristic(note, vault_notes)

    @staticmethod
    def _find_connections_heuristic(note: Note, vault_notes: list[dict]) -> list[str]:
        """Find connections by tag overlap."""
        if not note.tags:
            return []

        note_tags = set(t.lower() for t in note.tags)
        scored: list[tuple[int, str]] = []

        for vn in vault_notes:
            overlap = len(note_tags & set(t.lower() for t in vn["tags"]))
            if overlap > 0:
                scored.append((overlap, vn["title"]))

        scored.sort(key=lambda x: -x[0])
        return [title for _, title in scored[:MAX_SUGGESTIONS]]

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

            # Add [[target]] to source body
            self._add_link_to_note(source_path, title, ts, f"Spider linked to [[{title}]]")

            # Add [[source]] backlink to target
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

        # Append link at end of body
        new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

        # Update frontmatter
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {"action": "linked", "by": "agent:spider", "at": ts, "reason": reason}
        )

        from core.notes import note_to_file_content

        path.write_text(note_to_file_content(meta, new_body), encoding="utf-8")

    def _list_vault_notes(self, threads_dir: Path, exclude_id: str = "") -> list[dict]:
        """List all vault notes as dicts with title and tags."""
        index = get_note_index()
        if index.size > 0:
            return [
                {"title": e.title, "tags": e.tags, "id": e.id}
                for e in index.all_entries()
                if e.id != exclude_id
            ]
        # Fallback to disk scan if index is empty
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
        # Fallback to disk scan
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
