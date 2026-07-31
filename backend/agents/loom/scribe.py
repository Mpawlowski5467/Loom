"""Scribe agent: the summarizer. Generates folder index files and daily logs
from vault activity.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from agents.base import BaseAgent
from agents.file_locks import path_lock
from agents.loom.scribe_notes import (
    build_notes_referenced,
    normalize_sections,
    summarize_changelog_activity,
    summarize_changelog_day,
)
from core.exceptions import ProviderConfigError, ProviderError
from core.notes import (
    generate_id,
    normalize_wikilinks_in_body,
    now_iso,
    parse_note,
    parse_note_meta,
)
from core.notes_helpers import collect_changelog
from core.vault_io import write_note as _vault_write_note
from core.vault_io import write_text as _vault_write_text

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
1. Opens with a one-paragraph overview that names the folder's main notes and
   themes — no filler ("various topics", "a collection of notes")
2. Groups notes by theme or category if patterns emerge
3. Lists each note as a [[wikilink]] with a brief description
4. Keeps total length under 500 words

Use [[wikilinks]] for all note references. Return only the markdown body.
"""

_DAILY_LOG_SYSTEM = """\
You are the Scribe — a quiet keeper of daily logs. From today's per-agent
changelog entries, write a short daily entry that a returning user can scan
in thirty seconds to recall what actually happened.

Style rules — follow them strictly:
- Name names. Every claim must reference the concrete notes, projects or
  captures involved, as [[wikilinks]]. A sentence with no note named in it
  is almost always filler.
- Plain past tense, third person. The changelog only records agent actions —
  never address the reader as "you" and never write "we".
- Group related actions into one bullet instead of mirroring the changelog
  entry-for-entry: three "linked" actions on the same note are a single
  bullet.
- Use the Details fields for specifics (which capture was processed, what
  was linked to what) rather than restating the Agent/Action/Target fields.
- No filler or verdicts: never write "productive day", "busy day",
  "lots of activity", "various updates", "made progress", "several notes",
  or similar empty phrases. If a sentence can be deleted without losing a
  fact, delete it.
- Skip routine ticks (file-watch refreshes, index regenerations, scans,
  routine validations) unless something notable surfaced from them.
- Bounded length: the whole entry stays under 200 words.

Output exactly these sections, in this order:

## Summary
Two to three sentences saying what was created, linked or changed, naming
the notes involved. Lead with the most significant event of the day — no
throat-clearing opener, no assessment of how the day went.

## Themes
One to three short bullets naming the recurring topics or active threads of
the day. Use [[wikilinks]] where a theme maps to an existing note. Omit
this section entirely if no clear theme emerges.

## Activity
Five to ten bullets of notable actions. Each bullet starts with the actor
(weaver, spider, scribe, sentinel, archivist, researcher, standup), is past
tense, and names the [[note]] it touched.

## Notes Referenced
Every note created or modified today, one per line, as [[wikilinks]].
Deduplicate.

Use [[wikilinks]] for every note reference. Return only the markdown body
— no preamble, no closing remark.
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
            # Canonicalize wikilink targets (local models sometimes emit
            # unicode dash/space variants inside [[...]]).
            content = normalize_wikilinks_in_body(content)

            index_path = folder_path / "_index.md"
            # Hold a lock on _index.md so two concurrent indexings of the
            # same folder don't trample each other.
            async with path_lock(index_path):
                _vault_write_text(
                    self._vault_root,
                    index_path,
                    f"# {folder_path.name.title()} Index\n\n{content}\n",
                )

            return {
                "action": "indexed",
                "details": f"Updated _index.md for {folder_path.name}/ ({len(notes_info)} notes)",
                "content": content,
            }

        result = await self.execute_with_chain(folder_path, _action)
        return str(result.get("content", ""))

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
            # Rebuild the notes section from the changelog (ground truth) and
            # repair the model's section structure before writing. The model is
            # never trusted for which notes were touched.
            notes_section = build_notes_referenced(
                changelog_text,
                self._vault_root,
                self_note=f"{date_str}.md",
            )
            body = normalize_sections(body, notes_section)
            # Canonicalize wikilink targets in the model-drafted sections
            # (the deterministic notes section is already canonical; the
            # helper is idempotent).
            body = normalize_wikilinks_in_body(body)

            # Write or update the daily note. Lock covers the read-modify-write
            # so a concurrent run for the same date can't lose history entries.
            daily_path = daily_dir / f"{date_str}.md"
            async with path_lock(daily_path):
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

                _vault_write_note(self._vault_root, daily_path, meta, body)

            return {
                "action": "created",
                "details": f"Daily log for {date_str}",
                "content": body,
            }

        result = await self.execute_with_chain(daily_dir, _action)
        return str(result.get("content", ""))

    async def _generate_index(self, folder_name: str, notes_info: list[dict[str, Any]]) -> str:
        """Generate index content from note metadata."""
        if self._chat_provider is not None:
            return await self._generate_index_llm(folder_name, notes_info)
        return self._generate_index_simple(notes_info)

    async def _generate_index_llm(self, folder_name: str, notes_info: list[dict[str, Any]]) -> str:
        """Use LLM to generate a rich folder index."""
        if self._chat_provider is None:
            return self._generate_index_simple(notes_info)
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
        except (ProviderError, ProviderConfigError):
            logger.warning("LLM index generation failed, using simple format", exc_info=True)
            return self._generate_index_simple(notes_info)

    @staticmethod
    def _generate_index_simple(notes_info: list[dict[str, Any]]) -> str:
        """Generate a simple bullet-list index."""
        lines = [
            f"- [[{n['title']}]] — {n['type']}, tags: {', '.join(n['tags'])}" for n in notes_info
        ]
        return "\n".join(lines)

    async def _generate_daily_body(self, date_str: str, changelog_text: str) -> str:
        """Generate the raw daily log body from changelog entries.

        Returns the model's draft when a chat provider is configured, otherwise
        a deterministic fallback. Either way the caller runs the result through
        :func:`normalize_sections`, which repairs structure and splices in the
        trustworthy ``## Notes Referenced`` section — so this method only has to
        supply ``## Summary`` and ``## Activity`` content.
        """
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
            except (ProviderError, ProviderConfigError):
                logger.warning("LLM daily log failed, using deterministic fallback", exc_info=True)

        return self._fallback_daily_body(date_str, changelog_text)

    def _fallback_daily_body(self, date_str: str, changelog_text: str) -> str:
        """Deterministic daily body when no chat provider is available.

        Emits ``## Summary`` and ``## Activity`` from the changelog itself:
        the summary names what actually happened (notable actions and the
        notes they touched), the activity list skips routine ticks. The
        ``## Notes Referenced`` section is added by :func:`normalize_sections`.
        """
        summary = summarize_changelog_day(changelog_text, vault_root=self._vault_root)
        activity = summarize_changelog_activity(changelog_text, vault_root=self._vault_root)
        return f"## Summary\n\n{summary}\n\n## Activity\n\n{activity}\n"

    def _collect_folder_notes(self, folder_path: Path) -> list[dict[str, Any]]:
        """Collect metadata + preview for all notes in a folder."""
        notes: list[dict[str, Any]] = []
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
            except (OSError, yaml.YAMLError, ValidationError, ValueError):
                continue
        return notes

    def _collect_changelog(self, target_date: date) -> str:
        """Collect all changelog entries for a given date across all agents."""
        return collect_changelog(self._vault_root, target_date)


_scribe: Scribe | None = None


def get_scribe() -> Scribe | None:
    return _scribe


def init_scribe(vault_root: Path, chat_provider: BaseProvider | None = None) -> Scribe:
    global _scribe
    _scribe = Scribe(vault_root, chat_provider)
    return _scribe
