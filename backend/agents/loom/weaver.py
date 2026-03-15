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
from core.notes import Note, generate_id, note_to_file_content, now_iso, parse_note

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

# Maps note type to default target folder
_TYPE_TO_FOLDER = {
    "daily": "daily",
    "project": "projects",
    "topic": "topics",
    "person": "people",
    "capture": "captures",
}

# System prompt for capture classification
_CLASSIFY_SYSTEM = """\
You are the Weaver agent in a knowledge management system. Your job is to
classify a raw capture and decide how it should be filed.

Analyze the capture content and respond with EXACTLY this format (no extra text):

type: <topic|project|person|daily>
folder: <topics|projects|people|daily>
title: <concise descriptive title>
tags: <comma-separated tags>

Rules:
- If the capture discusses a specific project or initiative → type: project
- If it's about a person or collaborator → type: person
- If it's a daily log or standup → type: daily
- Otherwise → type: topic
- Tags should be 2-5 relevant keywords, lowercase
- Title should be concise (under 60 chars), descriptive, no dates unless daily
"""

# System prompt for note content generation
_CREATE_SYSTEM = """\
You are the Weaver agent in a knowledge management system. Your job is to
transform raw content into a well-structured vault note.

Given a raw capture and a schema template, produce the note body (markdown only,
no frontmatter — that's handled separately).

Rules:
- Follow the schema's expected sections exactly
- Use ## headers for sections as specified in the schema
- Use [[wikilinks]] for any references to people, projects, or topics
- Keep the content faithful to the source material — don't invent facts
- Be concise but preserve all important information
- If the source references specific people, projects, or concepts, wrap them
  in [[double brackets]]
"""

# System prompt for formatting modal content per schema
_FORMAT_SYSTEM = """\
You are the Weaver agent. The user has provided content for a new note.
Format it to match the schema template for the note type.

Rules:
- Organize the content under the schema's expected ## sections
- Use [[wikilinks]] for references to other notes
- Don't add information that isn't in the original content
- Keep it concise and well-structured
- Return only the markdown body (no frontmatter)
"""

# Default schema section templates for skeleton notes
_SKELETON_SECTIONS: dict[str, str] = {
    "project": "## Overview\n\n\n\n## Goals\n\n\n\n## Status\n\n\n\n## Related\n\n",
    "topic": "## Summary\n\n\n\n## Details\n\n\n\n## References\n\n",
    "person": "## Context\n\n\n\n## Notes\n\n\n\n## Related\n\n",
    "daily": "## Log\n\n\n\n## Tasks\n\n\n\n## Links\n\n",
    "capture": "## Content\n\n\n\n## Context\n\n",
}


def _to_kebab(title: str) -> str:
    """Convert a title to a kebab-case filename stem (max 60 chars)."""
    cleaned = "".join(c if c.isalnum() or c in " -_" else "" for c in title)
    return "-".join(cleaned.lower().split())[:60]


def _parse_classification(text: str) -> dict[str, str]:
    """Parse the LLM classification response into a dict."""
    result: dict[str, str] = {}
    for line in text.strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if key in ("type", "folder", "title", "tags"):
                result[key] = value
    return result


def _load_schema(vault_root: Path, note_type: str) -> str:
    """Load the schema template for a note type from rules/schemas/."""
    schema_path = vault_root / "rules" / "schemas" / f"{note_type}.md"
    if schema_path.exists():
        return schema_path.read_text(encoding="utf-8")
    return ""


def _build_meta(
    note_id: str,
    title: str,
    note_type: str,
    tags: list[str],
    source: str = "manual",
) -> dict:
    """Build a complete frontmatter metadata dict."""
    ts = now_iso()
    return {
        "id": note_id,
        "title": title,
        "type": note_type,
        "tags": tags,
        "created": ts,
        "modified": ts,
        "author": "agent:weaver",
        "source": source,
        "links": [],
        "status": "active",
        "history": [
            {
                "action": "created",
                "by": "agent:weaver",
                "at": ts,
                "reason": "Created by Weaver agent",
            },
        ],
    }


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
            # Read the capture
            raw_note = parse_note(capture_path)
            raw_content = raw_note.body.strip()

            if not raw_content:
                return {
                    "action": "skipped",
                    "details": f"Empty capture: {capture_path.name}",
                    "note": None,
                }

            # Classify the capture
            classification = await self._classify_capture(raw_content, chain)
            note_type = classification.get("type", "topic")
            folder = classification.get("folder", _TYPE_TO_FOLDER.get(note_type, "topics"))
            title = classification.get("title", raw_note.title or capture_path.stem)
            tags_str = classification.get("tags", "")
            tags = [t.strip() for t in tags_str.split(",") if t.strip()]

            # Generate structured content
            body = await self._generate_note_body(raw_content, note_type, chain)

            # Write the note
            note = self._write_note(
                title, note_type, tags, folder, body, source=f"capture:{raw_note.id}"
            )

            return {
                "action": "created",
                "details": f"Processed capture '{capture_path.name}' → {folder}/{_to_kebab(title)}.md",
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
                body = await self._format_content(content, note_type, chain)
            elif content.strip():
                body = content
            else:
                body = _SKELETON_SECTIONS.get(note_type, "")

            note = self._write_note(title, note_type, tags, folder, body)

            return {
                "action": "created",
                "details": f"Created '{title}' in {folder}/",
                "note": note,
            }

        result = await self.execute_with_chain(target_dir, _action)
        return result["note"]

    # -- Private helpers --------------------------------------------------------

    async def _classify_capture(self, content: str, chain: ReadChainResult) -> dict[str, str]:
        """Use LLM to classify a capture's type, folder, title, and tags."""
        if self._chat_provider is None:
            return self._classify_heuristic(content)

        user_message = (
            f"Classify this capture:\n\n---\n{content[:3000]}\n---\n\n"
            "Respond with type, folder, title, and tags."
        )

        try:
            response = await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_message}],
                system=_CLASSIFY_SYSTEM,
            )
            parsed = _parse_classification(response)
            if parsed.get("type") and parsed.get("title"):
                return parsed
        except Exception:  # noqa: BLE001
            logger.warning("LLM classification failed, using heuristic", exc_info=True)

        return self._classify_heuristic(content)

    @staticmethod
    def _classify_heuristic(content: str) -> dict[str, str]:
        """Simple keyword-based fallback classification."""
        lower = content.lower()
        if any(kw in lower for kw in ("standup", "daily", "today", "morning", "afternoon")):
            return {"type": "daily", "folder": "daily", "title": "Daily Log", "tags": "daily"}
        if any(kw in lower for kw in ("project", "milestone", "sprint", "roadmap")):
            return {
                "type": "project",
                "folder": "projects",
                "title": "New Project",
                "tags": "project",
            }
        if any(kw in lower for kw in ("meeting with", "spoke to", "conversation with")):
            return {"type": "person", "folder": "people", "title": "Person Note", "tags": "person"}
        return {"type": "topic", "folder": "topics", "title": "New Topic", "tags": "topic"}

    async def _generate_note_body(
        self, raw_content: str, note_type: str, chain: ReadChainResult
    ) -> str:
        """Use LLM to generate a structured note body from raw content."""
        if self._chat_provider is None:
            return raw_content

        schema = _load_schema(self._vault_root, note_type)
        context_hint = ""
        if chain.prime_text:
            context_hint = f"\n\nVault rules summary: {chain.prime_text[:500]}"

        user_message = (
            f"Schema template:\n{schema}\n\n"
            f"Raw content to structure:\n---\n{raw_content[:4000]}\n---"
            f"{context_hint}\n\n"
            "Transform this into a well-structured note body following the schema."
        )

        try:
            return await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_message}],
                system=_CREATE_SYSTEM,
            )
        except Exception:  # noqa: BLE001
            logger.warning("LLM note generation failed, using raw content", exc_info=True)
            return raw_content

    async def _format_content(self, content: str, note_type: str, chain: ReadChainResult) -> str:
        """Use LLM to format user-provided content per the type schema."""
        if self._chat_provider is None:
            return content

        schema = _load_schema(self._vault_root, note_type)
        user_message = (
            f"Schema template:\n{schema}\n\n"
            f"User content:\n---\n{content[:4000]}\n---\n\n"
            "Format this content to match the schema."
        )

        try:
            return await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_message}],
                system=_FORMAT_SYSTEM,
            )
        except Exception:  # noqa: BLE001
            logger.warning("LLM formatting failed, using raw content", exc_info=True)
            return content

    def _write_note(
        self,
        title: str,
        note_type: str,
        tags: list[str],
        folder: str,
        body: str,
        source: str = "manual",
    ) -> Note:
        """Write a note file to the vault and return the parsed Note."""
        threads_dir = self._vault_root / "threads"
        target_dir = threads_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)

        note_id = generate_id()
        stem = _to_kebab(title) or note_id
        file_path = target_dir / f"{stem}.md"

        # Avoid overwriting existing files
        if file_path.exists():
            file_path = target_dir / f"{stem}-{note_id}.md"

        meta = _build_meta(note_id, title, note_type, tags, source)
        file_path.write_text(note_to_file_content(meta, body), encoding="utf-8")

        logger.info("Weaver created note: %s → %s", title, file_path)
        return parse_note(file_path)


# ---------------------------------------------------------------------------
# Module-level factory
# ---------------------------------------------------------------------------

_weaver: Weaver | None = None


def get_weaver() -> Weaver | None:
    """Return the cached Weaver instance, or None if not initialized."""
    return _weaver


def init_weaver(vault_root: Path, chat_provider: BaseProvider | None = None) -> Weaver:
    """Create and cache the global Weaver agent."""
    global _weaver
    _weaver = Weaver(vault_root, chat_provider)
    return _weaver
