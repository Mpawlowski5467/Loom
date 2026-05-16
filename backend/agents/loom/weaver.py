"""Weaver agent: the creator. Turns captures into vault notes and handles
note creation from the UI modal.

Weaver is a Loom-layer agent. It reads the full context chain before
every action, classifies captures, generates structured notes, and
writes them to the appropriate vault folder with correct frontmatter.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from agents.base import BaseAgent
from agents.loom.weaver_io import archive_capture, write_note
from agents.loom.weaver_llm import classify_capture, format_content, generate_note_body
from agents.loom.weaver_prompts import SKELETON_SECTIONS
from core.notes import Note, parse_note
from core.notes_helpers import TYPE_TO_FOLDER, to_kebab

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)


class Weaver(BaseAgent):
    """Weaver is the creator agent — it turns captures into vault notes."""

    @property
    def name(self) -> str:
        return "weaver"

    @property
    def role(self) -> str:
        return "Note creator: classifies captures and generates structured vault notes"

    async def process_capture(self, capture_path: Path) -> Note:
        """Process a raw capture into a structured vault note.

        1. Runs read chain targeting captures/.
        2. Classifies the capture (type, folder, title, tags).
        3. Generates structured note body per schema.
        4. Writes the new note to the target folder.
        5. Returns the created Note.
        """
        captures_dir = capture_path.parent

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            raw_note = parse_note(capture_path)
            raw_content = raw_note.body.strip()

            if not raw_content:
                return {
                    "action": "skipped",
                    "details": f"Empty capture: {capture_path.name}",
                    "note": None,
                }

            classification = await classify_capture(raw_content, self._chat_provider)
            note_type = classification.get("type", "topic")
            folder = classification.get("folder", TYPE_TO_FOLDER.get(note_type, "topics"))
            title = classification.get("title", raw_note.title or capture_path.stem)
            tags_str = classification.get("tags", "")
            tags = [t.strip() for t in tags_str.split(",") if t.strip()]

            body = await generate_note_body(
                self._vault_root, raw_content, note_type, chain, self._chat_provider
            )

            note = write_note(
                self._vault_root,
                title,
                note_type,
                tags,
                folder,
                body,
                source=f"capture:{raw_note.id}",
            )

            archive_capture(self._vault_root, self.name, capture_path)

            return {
                "action": "created",
                "details": (
                    f"Processed capture '{capture_path.name}' → "
                    f"{folder}/{to_kebab(title)}.md"
                ),
                "note": note,
            }

        result = await self.execute_with_chain(captures_dir, _action)
        return result.get("note")  # type: ignore[return-value]

    async def create_from_modal(
        self,
        title: str,
        note_type: str,
        tags: list[str],
        folder: str,
        content: str,
    ) -> Note:
        """Create a note from the UI create-note modal.

        1. Runs read chain targeting the destination folder.
        2. Formats content per schema (or creates skeleton).
        3. Writes the note with full frontmatter.
        4. Returns the created Note.
        """
        target_dir = self._vault_root / "threads" / folder

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            if content.strip() and self._chat_provider is not None:
                body = await format_content(
                    self._vault_root, content, note_type, self._chat_provider
                )
            elif content.strip():
                body = content
            else:
                body = SKELETON_SECTIONS.get(note_type, "")

            note = write_note(self._vault_root, title, note_type, tags, folder, body)

            return {
                "action": "created",
                "details": f"Created '{title}' in {folder}/",
                "note": note,
            }

        result = await self.execute_with_chain(target_dir, _action)
        note: Note = result["note"]
        return note


_weaver: Weaver | None = None


def get_weaver() -> Weaver | None:
    """Return the cached Weaver instance, or None if not initialized."""
    return _weaver


def init_weaver(vault_root: Path, chat_provider: BaseProvider | None = None) -> Weaver:
    """Create and cache the global Weaver agent."""
    global _weaver
    _weaver = Weaver(vault_root, chat_provider)
    return _weaver
