"""Standup agent: generates daily recaps from vault activity.

Shuttle-layer agent. Writes only to captures/. The Scribe agent picks up
the standup capture and incorporates it into the daily log.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from agents.base import BaseAgent
from core.notes import generate_id, note_to_file_content, now_iso

if TYPE_CHECKING:
    from datetime import date
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_STANDUP_SYSTEM = """\
You are the Standup agent in a knowledge management system. Your job is to
produce a concise daily recap from the day's activity.

Given changelog entries and notes modified today, produce a standup-style recap:

## Highlights
- Key accomplishments and important actions (3-5 bullets)

## Notes Touched
- [[wikilinks]] to all notes that were created, modified, or linked today

## Patterns
- Any recurring themes or notable trends from today's activity

Keep it concise (under 300 words). Use [[wikilinks]] for note references.
Return only the markdown body.
"""


@dataclass
class StandupResult:
    """Result of a Standup generation."""

    recap: str
    date: str
    notes_modified: int
    capture_id: str = ""
    capture_path: str = ""

    def to_dict(self) -> dict:
        return {
            "recap": self.recap,
            "date": self.date,
            "notes_modified": self.notes_modified,
            "capture_id": self.capture_id,
            "capture_path": self.capture_path,
        }


class Standup(BaseAgent):
    """Standup generates daily activity recaps and saves them as captures."""

    @property
    def name(self) -> str:
        return "standup"

    @property
    def role(self) -> str:
        return "Daily recap: summarizes vault activity into standup captures"

    async def generate(self, target_date: date | None = None) -> StandupResult:
        """Generate a daily recap for the given date.

        Args:
            target_date: Date to recap. Defaults to today.

        Returns:
            StandupResult with the recap text and capture info.
        """
        if target_date is None:
            from datetime import date as date_cls

            # Use UTC date to match changelog timestamps (now_iso() is UTC)
            utc_date_str = now_iso()[:10]
            target_date = date_cls.fromisoformat(utc_date_str)

        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)
        date_str = target_date.isoformat()

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            changelog_text = self._collect_changelog(target_date)
            modified_notes = self._find_modified_notes(target_date)
            notes_count = len(modified_notes)

            if not changelog_text.strip() and not modified_notes:
                return {
                    "action": "skipped",
                    "details": f"No activity for {date_str}",
                    "result": StandupResult(recap="", date=date_str, notes_modified=0),
                }

            notes_text = "\n".join(f"- [[{n['title']}]] ({n['type']})" for n in modified_notes)

            recap = await self._generate_recap(date_str, changelog_text, notes_text)
            capture_id, capture_path = self._save_capture(date_str, recap)

            return {
                "action": "created",
                "details": f"Standup for {date_str}: {notes_count} notes, recap saved",
                "result": StandupResult(
                    recap=recap,
                    date=date_str,
                    notes_modified=notes_count,
                    capture_id=capture_id,
                    capture_path=str(capture_path),
                ),
            }

        result = await self.execute_with_chain(captures_dir, _action)
        return result.get("result", StandupResult(recap="", date=date_str, notes_modified=0))

    def _collect_changelog(self, target_date: date) -> str:
        """Collect all changelog entries for a given date across all agents."""
        changelog_root = self._vault_root / ".loom" / "changelog"
        date_str = target_date.isoformat()
        parts: list[str] = []

        if not changelog_root.exists():
            return ""

        for agent_dir in sorted(changelog_root.iterdir()):
            if not agent_dir.is_dir():
                continue
            log_file = agent_dir / f"{date_str}.md"
            if log_file.exists():
                try:
                    parts.append(log_file.read_text(encoding="utf-8"))
                except Exception:  # noqa: BLE001
                    continue
        return "\n\n".join(parts)

    def _find_modified_notes(self, target_date: date) -> list[dict]:
        """Find notes modified on the given date."""
        from core.note_index import get_note_index

        index = get_note_index()
        date_str = target_date.isoformat()
        modified: list[dict] = []

        for entry in index.all_entries():
            # Check if the note's mtime matches the target date
            if entry.meta.modified and entry.meta.modified.startswith(date_str):
                modified.append(
                    {
                        "title": entry.title,
                        "type": entry.type,
                        "id": entry.id,
                    }
                )

        return modified

    async def _generate_recap(self, date_str: str, changelog_text: str, notes_text: str) -> str:
        """Generate the standup recap text."""
        if self._chat_provider is not None:
            user_msg = (
                f"Date: {date_str}\n\n"
                f"## Changelog\n\n{changelog_text}\n\n"
                f"## Notes Modified\n\n{notes_text}\n\n"
                "Generate the daily standup recap."
            )
            try:
                return await self._chat_provider.chat(
                    messages=[{"role": "user", "content": user_msg}],
                    system=_STANDUP_SYSTEM,
                )
            except Exception:  # noqa: BLE001
                logger.warning("LLM standup generation failed", exc_info=True)

        # Fallback: simple formatted recap
        return (
            f"## Highlights\n\n- Activity recorded for {date_str}\n\n"
            f"## Notes Touched\n\n{notes_text or '- No notes modified'}\n\n"
            f"## Activity Log\n\n{changelog_text or 'No changelog entries.'}\n"
        )

    def _save_capture(self, date_str: str, recap: str) -> tuple[str, Path]:
        """Save the standup recap as a capture note."""
        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        capture_id = generate_id()
        ts = now_iso()

        meta = {
            "id": capture_id,
            "title": f"Standup — {date_str}",
            "type": "capture",
            "tags": ["standup", "daily"],
            "created": ts,
            "modified": ts,
            "author": "agent:standup",
            "source": "agent:standup",
            "links": [],
            "status": "active",
            "history": [
                {
                    "action": "created",
                    "by": "agent:standup",
                    "at": ts,
                    "reason": "Daily standup recap",
                },
            ],
        }

        filename = f"standup-{date_str}.md"
        path = captures_dir / filename
        path.write_text(note_to_file_content(meta, recap), encoding="utf-8")
        return capture_id, path


_standup: Standup | None = None


def get_standup() -> Standup | None:
    return _standup


def init_standup(vault_root: Path, chat_provider: BaseProvider | None = None) -> Standup:
    global _standup
    _standup = Standup(vault_root, chat_provider)
    return _standup
