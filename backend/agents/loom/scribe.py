"""Scribe agent: the summarizer. Generates folder index files and daily logs
from vault activity.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from agents.base import BaseAgent
from core.notes import generate_id, now_iso, parse_note, parse_note_meta

if TYPE_CHECKING:
    from datetime import date
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_SUMMARIZE_FOLDER_SYSTEM = """\
You are the Scribe agent in a knowledge management system. Your job is to
generate a concise index summary for a folder of notes.

Given a list of notes (title, type, tags, first 200 chars), produce a markdown
index that:
1. Opens with a one-paragraph overview of the folder's content
2. Groups notes by theme or category if patterns emerge
3. Lists each note as a [[wikilink]] with a brief description
4. Keeps total length under 500 words

Use [[wikilinks]] for all note references. Return only the markdown body.
"""

_DAILY_LOG_SYSTEM = """\
You are the Scribe agent. Generate a daily activity summary from changelog entries.

Given today's changelog entries across all agents, produce a structured daily log:
1. **## Summary** — 2-3 sentence overview of the day
2. **## Activity** — bulleted list of notable actions
3. **## Notes Referenced** — [[wikilinks]] to all notes created or modified today

Be concise. Use [[wikilinks]] for all note references. Return only the markdown body.
"""


class Scribe(BaseAgent):
    """Scribe generates folder indexes and daily activity logs."""

    @property
    def name(self) -> str:
        return "scribe"

    @property
    def role(self) -> str:
        return "Summarizer: generates folder indexes and daily activity logs"

    async def update_index(self, folder_path: Path) -> str:
        """Generate or update the _index.md for a folder.

        Returns the generated index content.
        """

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            notes_info = self._collect_folder_notes(folder_path)
            if not notes_info:
                return {"action": "skipped", "details": "No notes in folder", "content": ""}

            content = await self._generate_index(folder_path.name, notes_info)

            index_path = folder_path / "_index.md"
            index_path.write_text(
                f"# {folder_path.name.title()} Index\n\n{content}\n", encoding="utf-8"
            )

            return {
                "action": "indexed",
                "details": f"Updated _index.md for {folder_path.name}/ ({len(notes_info)} notes)",
                "content": content,
            }

        result = await self.execute_with_chain(folder_path, _action)
        return result.get("content", "")

    async def generate_daily_log(self, target_date: date) -> str:
        """Create or update the daily log for a given date.

        Returns the generated log content.
        """
        threads_dir = self._vault_root / "threads"
        daily_dir = threads_dir / "daily"
        daily_dir.mkdir(parents=True, exist_ok=True)

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            date_str = target_date.isoformat()
            changelog_text = self._collect_changelog(target_date)

            if not changelog_text.strip():
                return {
                    "action": "skipped",
                    "details": f"No activity for {date_str}",
                    "content": "",
                }

            body = await self._generate_daily_body(date_str, changelog_text)

            # Write or update the daily note
            daily_path = daily_dir / f"{date_str}.md"
            if daily_path.exists():
                # Update existing note body
                note = parse_note(daily_path)
                meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
                meta["modified"] = now_iso()
                meta["history"].append(
                    {
                        "action": "edited",
                        "by": "agent:scribe",
                        "at": now_iso(),
                        "reason": "Daily log updated by Scribe",
                    }
                )
            else:
                ts = now_iso()
                meta = {
                    "id": generate_id(),
                    "title": date_str,
                    "type": "daily",
                    "tags": ["daily-log"],
                    "created": ts,
                    "modified": ts,
                    "author": "agent:scribe",
                    "source": "manual",
                    "links": [],
                    "status": "active",
                    "history": [
                        {
                            "action": "created",
                            "by": "agent:scribe",
                            "at": ts,
                            "reason": "Daily log generated by Scribe",
                        }
                    ],
                }

            from core.notes import note_to_file_content

            daily_path.write_text(note_to_file_content(meta, body), encoding="utf-8")

            return {
                "action": "created",
                "details": f"Daily log for {date_str}",
                "content": body,
            }

        result = await self.execute_with_chain(daily_dir, _action)
        return result.get("content", "")

    async def _generate_index(self, folder_name: str, notes_info: list[dict]) -> str:
        """Generate index content from note metadata."""
        if self._chat_provider is not None:
            return await self._generate_index_llm(folder_name, notes_info)
        return self._generate_index_simple(notes_info)

    async def _generate_index_llm(self, folder_name: str, notes_info: list[dict]) -> str:
        """Use LLM to generate a rich folder index."""
        notes_text = "\n".join(
            f"- {n['title']} (type: {n['type']}, tags: {', '.join(n['tags'])}): {n['preview']}"
            for n in notes_info
        )
        user_msg = f"Folder: {folder_name}/\n\nNotes:\n{notes_text}\n\nGenerate the folder index."

        try:
            return await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=_SUMMARIZE_FOLDER_SYSTEM,
            )
        except Exception:  # noqa: BLE001
            logger.warning("LLM index generation failed, using simple format", exc_info=True)
            return self._generate_index_simple(notes_info)

    @staticmethod
    def _generate_index_simple(notes_info: list[dict]) -> str:
        """Generate a simple bullet-list index."""
        lines = [
            f"- [[{n['title']}]] — {n['type']}, tags: {', '.join(n['tags'])}" for n in notes_info
        ]
        return "\n".join(lines)

    async def _generate_daily_body(self, date_str: str, changelog_text: str) -> str:
        """Generate daily log body from changelog entries."""
        if self._chat_provider is not None:
            try:
                return await self._chat_provider.chat(
                    messages=[
                        {
                            "role": "user",
                            "content": f"Date: {date_str}\n\nChangelog:\n{changelog_text}",
                        }
                    ],
                    system=_DAILY_LOG_SYSTEM,
                )
            except Exception:  # noqa: BLE001
                logger.warning("LLM daily log failed, using raw changelog", exc_info=True)

        return f"## Summary\n\nActivity log for {date_str}.\n\n## Activity\n\n{changelog_text}\n"

    def _collect_folder_notes(self, folder_path: Path) -> list[dict]:
        """Collect metadata + preview for all notes in a folder."""
        notes: list[dict] = []
        if not folder_path.exists():
            return notes
        for md in sorted(folder_path.glob("*.md")):
            if md.name == "_index.md":
                continue
            try:
                meta = parse_note_meta(md)
                if not meta.id:
                    continue
                # Read first 200 chars of body for preview
                note = parse_note(md)
                preview = note.body[:200].replace("\n", " ").strip()
                notes.append(
                    {
                        "title": meta.title,
                        "type": meta.type,
                        "tags": list(meta.tags),
                        "preview": preview,
                    }
                )
            except Exception:  # noqa: BLE001
                continue
        return notes

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


_scribe: Scribe | None = None


def get_scribe() -> Scribe | None:
    return _scribe


def init_scribe(vault_root: Path, chat_provider: BaseProvider | None = None) -> Scribe:
    global _scribe
    _scribe = Scribe(vault_root, chat_provider)
    return _scribe
