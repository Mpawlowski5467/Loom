"""Deterministic post-processing for Scribe's daily log.

The LLM that drafts a daily log cannot be trusted with the
``## Notes Referenced`` section — a weak local model invents prose, mislabels
the header, or links to filenames instead of titles. These helpers rebuild
that section from the *ground truth* (the per-agent changelog) and normalise
the model's section structure before the note is written to disk.

Everything here is pure (no LLM, no vault writes) so it can be unit-tested in
isolation. Reads of note frontmatter go through ``parse_note_meta`` directly;
that is allowed — only *writes* must go through ``core/vault_io``.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml
from pydantic import ValidationError

from core.notes import parse_note_meta

# -- Section names -----------------------------------------------------------

NOTES_HEADING = "## Notes Referenced"
_NOTES_EMPTY = f"{NOTES_HEADING}\n\n_No notes touched today._\n"

# Canonical required/optional sections, in their final order.
_SUMMARY = "summary"
_THEMES = "themes"
_ACTIVITY = "activity"
_NOTES = "notes referenced"
_CANONICAL_ORDER = [_SUMMARY, _THEMES, _ACTIVITY, _NOTES]
_REQUIRED = (_SUMMARY, _ACTIVITY, _NOTES)
_CANONICAL_TITLE = {
    _SUMMARY: "## Summary",
    _THEMES: "## Themes",
    _ACTIVITY: "## Activity",
    _NOTES: NOTES_HEADING,
}
_PLACEHOLDER = {
    _SUMMARY: "_No summary recorded._",
    _ACTIVITY: "_No activity recorded._",
}

# -- Changelog parsing -------------------------------------------------------

# A changelog "- **Target:** <path>" line. The path runs to end-of-line. The
# leading "- " bullet may carry extra spaces; the value is taken verbatim
# (filenames can contain spaces) and stripped of surrounding quotes/backticks.
_TARGET_RE = re.compile(r"^\s*-\s+\*\*Target:\*\*\s*(.+?)\s*$", re.MULTILINE)
# A changelog "- **Details:** <text>" line.
_DETAILS_RE = re.compile(r"^\s*-\s+\*\*Details:\*\*\s*(.+?)\s*$", re.MULTILINE)
# Weaver records the note it created as a relative path *after an arrow* in its
# Details line: "Processed capture 'x.md' → daily/foo.md". We only trust the
# post-arrow token — a path-shaped substring anywhere else in Details (e.g.
# inside a human note title) is NOT treated as a note. Arrow may be →, -> or =>.
_ARROW_PATH_RE = re.compile(r"(?:→|->|=>)\s*([\w-]+(?:/[\w.-]+)+\.md)\b")


def build_notes_referenced(
    changelog_text: str,
    vault_root: Path,
    *,
    self_note: str | None = None,
) -> str:
    """Build the deterministic ``## Notes Referenced`` section.

    Extracts every real note path touched in ``changelog_text`` (from
    ``Target:`` lines and the post-arrow path in ``Details:`` lines), drops the
    captures inbox / archive / folder targets, resolves each path to its note
    title, and renders a deduplicated, alphabetically-sorted list of
    ``[[wikilinks]]``.

    Args:
        changelog_text: Concatenated per-agent changelog markdown for the day.
        vault_root: Root of the active vault (used to resolve and validate
            paths under ``threads/``).
        self_note: Filename of the daily note being generated (e.g.
            ``"2026-06-07.md"``); excluded so the log never links to itself.

    Returns:
        The full section string, including its ``## Notes Referenced`` heading
        and a trailing newline. When nothing resolves, a placeholder line is
        emitted instead of an empty list.
    """
    threads_dir = (vault_root / "threads").resolve()
    paths = _collect_note_paths(changelog_text, threads_dir, self_note)

    # Resolve to titles, dedup case-insensitively, keep first-seen casing.
    titles: dict[str, str] = {}
    for path in paths:
        title = _resolve_title(path)
        key = title.lower()
        if key not in titles:
            titles[key] = title

    if not titles:
        return _NOTES_EMPTY

    lines = "\n".join(f"[[{titles[key]}]]" for key in sorted(titles))
    return f"{NOTES_HEADING}\n\n{lines}\n"


def _collect_note_paths(
    changelog_text: str,
    threads_dir: Path,
    self_note: str | None,
) -> list[Path]:
    """Collect resolved note file paths referenced in the changelog.

    Returns absolute paths to existing ``.md`` files under ``threads/``,
    excluding the captures inbox, the archive, and the day's own daily note.
    Order is first-seen.
    """
    seen: set[Path] = set()
    ordered: list[Path] = []

    def consider(candidate: Path) -> None:
        try:
            resolved = candidate.resolve()
        except OSError:
            return
        if resolved in seen:
            return
        if self_note and resolved.name == self_note:
            return
        if _is_real_note(resolved, threads_dir):
            seen.add(resolved)
            ordered.append(resolved)

    # 1. Absolute paths from Target lines.
    for raw in _TARGET_RE.findall(changelog_text):
        consider(Path(_unwrap(raw)))

    # 2. Post-arrow relative note path in Details (weaver's created note),
    #    resolved against threads/.
    for details in _DETAILS_RE.findall(changelog_text):
        for rel in _ARROW_PATH_RE.findall(details):
            consider(threads_dir / rel)

    return ordered


def _unwrap(value: str) -> str:
    """Strip surrounding quotes/backticks an agent may have wrapped a path in."""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'`":
        return value[1:-1].strip()
    return value


def _is_real_note(resolved: Path, threads_dir: Path) -> bool:
    """True if ``resolved`` is an existing note file we should list.

    Excludes folder targets (no ``.md``), the captures inbox, the archive,
    ``_index.md`` files, and anything outside ``threads/``.
    """
    if resolved.suffix.lower() != ".md":
        return False
    try:
        rel_parts = resolved.relative_to(threads_dir).parts
    except ValueError:
        return False
    # rel_parts[-1] is the filename; everything before it is the folder chain.
    folders = rel_parts[:-1]
    if "captures" in folders or ".archive" in folders:
        return False
    if resolved.name == "_index.md":
        return False
    return resolved.is_file()


def _resolve_title(path: Path) -> str:
    """Resolve a note path to its title, falling back to a humanised stem.

    Catches a deliberately wide set of exceptions: ``parse_note_meta`` calls
    ``_coerce_meta``, which does ``.items()`` on whatever ``yaml.safe_load``
    returns — so a note with non-dict frontmatter (a bare string/list/int)
    raises ``AttributeError``. A single malformed note must never abort the
    whole section; the humanised stem is always a valid fallback.
    """
    try:
        meta = parse_note_meta(path)
        if meta.title.strip():
            return _clean_title(meta.title)
    except (OSError, ValueError, TypeError, AttributeError, yaml.YAMLError, ValidationError):
        pass
    return _humanise_stem(path.stem)


def _clean_title(title: str) -> str:
    """Flatten whitespace and strip wikilink brackets so the wrap stays valid."""
    flattened = " ".join(title.split())
    return flattened.replace("[[", "").replace("]]", "").strip()


def _humanise_stem(stem: str) -> str:
    """Turn a kebab/snake filename stem into a human-ish title."""
    words = stem.replace("_", " ").replace("-", " ").split()
    return " ".join(w.capitalize() for w in words) if words else stem


# -- Fallback activity summary -----------------------------------------------

_AGENT_RE = re.compile(r"^\s*-\s+\*\*Agent:\*\*\s*(.+?)\s*$", re.MULTILINE)
_ACTION_RE = re.compile(r"^\s*-\s+\*\*Action:\*\*\s*(.+?)\s*$", re.MULTILINE)
# Entry boundary: a "## <timestamp>" heading.
_ENTRY_RE = re.compile(r"^##[ \t]+\S", re.MULTILINE)
# Routine, low-signal actions to omit from the fallback activity list.
_NOISE_ACTIONS = {"scanned", "audited", "indexed", "validated", "blocked", "error"}


def summarize_changelog_activity(changelog_text: str, *, limit: int = 10) -> str:
    """Render changelog entries as a deterministic ``## Activity`` bullet list.

    Produces ``- {agent} {action} {note-title}`` lines from each entry's
    structured fields, skipping routine/low-signal actions. Used by the
    no-provider fallback so the daily log still has readable activity without
    dumping raw changelog markdown.

    Args:
        changelog_text: Concatenated per-agent changelog markdown for the day.
        limit: Maximum number of bullets to emit.

    Returns:
        A markdown bullet list, or a placeholder when nothing notable remains.
    """
    bullets: list[str] = []
    for block in _split_entries(changelog_text):
        agent_m = _AGENT_RE.search(block)
        action_m = _ACTION_RE.search(block)
        target_m = _TARGET_RE.search(block)
        if not (agent_m and action_m):
            continue
        action = action_m.group(1).strip()
        if action in _NOISE_ACTIONS:
            continue
        agent = agent_m.group(1).strip()
        target = _target_label(target_m.group(1)) if target_m else ""
        bullet = f"- {agent} {action}"
        if target:
            bullet += f" {target}"
        bullets.append(bullet.rstrip())
        if len(bullets) >= limit:
            break

    if not bullets:
        return "_No notable activity recorded._"
    return "\n".join(bullets)


def _split_entries(changelog_text: str) -> list[str]:
    """Split concatenated changelog text into per-entry blocks."""
    starts = [m.start() for m in _ENTRY_RE.finditer(changelog_text)]
    if not starts:
        return []
    bounds = [*starts, len(changelog_text)]
    return [changelog_text[bounds[i] : bounds[i + 1]] for i in range(len(starts))]


def _target_label(raw: str) -> str:
    """Turn a Target path into a short ``[[Title]]`` or humanised label.

    Folder targets (no ``.md``) and capture/archive paths collapse to an empty
    label so the bullet just reads ``- agent action``.
    """
    path = Path(_unwrap(raw))
    if path.suffix.lower() != ".md":
        return ""
    if "captures" in path.parts or ".archive" in path.parts or path.name == "_index.md":
        return ""
    return f"[[{_resolve_title(path)}]]"


# -- Section normalisation ---------------------------------------------------

# A "## Heading" line (exactly two hashes, not ### ). Used to slice the body.
_SECTION_RE = re.compile(r"^##[ \t]+(?P<title>.+?)[ \t]*$", re.MULTILINE)
_FENCE_RE = re.compile(r"^\s*(```|~~~)")


def normalize_sections(body: str, notes_section: str) -> str:
    """Repair the model's daily-log body into canonical section structure.

    - Drops any preamble before the first ``## `` heading and trailing chatter
      after the last recognised section.
    - Renames near-miss headings (``## Notes``, ``## Summary:``) to canonical.
    - Guarantees ``## Summary``, ``## Activity`` and ``## Notes Referenced``
      exist, inserting a minimal placeholder for any that are missing.
    - Keeps ``## Themes`` only when the model supplied it.
    - Always replaces the notes content with ``notes_section`` — the model's
      version of that section is never trusted.

    Args:
        body: Raw markdown body as produced by the LLM.
        notes_section: The trustworthy ``## Notes Referenced`` block from
            :func:`build_notes_referenced`.

    Returns:
        A normalised body with sections in canonical order, ending in a single
        newline.
    """
    normalised_body = body.replace("\r\n", "\n").replace("\r", "\n")
    sections = _parse_model_sections(normalised_body)

    # If the model emitted no recognised headers at all but wrote real prose,
    # keep that prose as the Summary rather than discarding the user's content.
    if not any(sections.get(k, "").strip() for k in (_SUMMARY, _THEMES, _ACTIVITY)):
        leftover = normalised_body.strip()
        if leftover and "##" not in leftover:
            sections[_SUMMARY] = leftover

    # The deterministic notes section always wins, header and all.
    sections[_NOTES] = _strip_heading(notes_section)

    for key in _REQUIRED:
        if not sections.get(key, "").strip():
            sections[key] = _PLACEHOLDER.get(key, "")

    blocks: list[str] = []
    for key in _CANONICAL_ORDER:
        if key not in sections:
            continue  # optional Themes, absent
        content = sections[key].strip()
        if key == _THEMES and not content:
            continue  # never emit an empty optional section
        blocks.append(f"{_CANONICAL_TITLE[key]}\n\n{content}".rstrip())

    return "\n\n".join(blocks) + "\n"


def _parse_model_sections(body: str) -> dict[str, str]:
    """Map canonical section keys to the model's content for that section.

    Headings inside fenced code blocks are ignored. Unknown headings and any
    preamble before the first heading are dropped. The first occurrence of a
    canonical section wins (later duplicates are ignored). A trailing closing
    remark glued to the final section's content is stripped.
    """
    headers = _find_headers(body)
    sections: dict[str, str] = {}
    last_key: str | None = None
    for i, (_pos, end, title) in enumerate(headers):
        key = _canonical_key(title)
        if key is None or key in sections:
            continue
        content_start = end
        content_end = headers[i + 1][0] if i + 1 < len(headers) else len(body)
        sections[key] = body[content_start:content_end].strip()
        last_key = key
    # The model often appends a sign-off after its final section. Strip a
    # trailing prose paragraph from that section (real activity is bulleted, so
    # a non-bullet trailing paragraph is a closing remark, not content).
    if last_key is not None and last_key != _NOTES:
        sections[last_key] = _strip_trailing_remark(sections[last_key])
    return sections


def _strip_trailing_remark(content: str) -> str:
    """Drop a trailing conversational paragraph after structured content.

    Only strips when the section has earlier blank-line-separated paragraphs
    and the final paragraph is plain prose (no list/heading/wikilink markers),
    so genuine single-paragraph sections and bulleted lists are left intact.
    """
    paragraphs = re.split(r"\n[ \t]*\n", content.strip())
    if len(paragraphs) < 2:
        return content.strip()
    last = paragraphs[-1].strip()
    is_structured = any(
        line.lstrip().startswith(("-", "*", "+", "#", "[[", ">")) for line in last.splitlines()
    )
    if is_structured:
        return content.strip()
    return "\n\n".join(p.strip() for p in paragraphs[:-1]).strip()


def _find_headers(body: str) -> list[tuple[int, int, str]]:
    """Find ``## `` headers outside fenced code blocks.

    Returns ``(line_start, line_end, title)`` tuples in document order.
    """
    headers: list[tuple[int, int, str]] = []
    in_fence = False
    offset = 0
    for line in body.splitlines(keepends=True):
        stripped = line.rstrip("\n")
        if _FENCE_RE.match(stripped):
            in_fence = not in_fence
        elif not in_fence:
            match = _SECTION_RE.match(stripped)
            if match:
                headers.append((offset, offset + len(line), match.group("title")))
        offset += len(line)
    return headers


def _canonical_key(heading: str) -> str | None:
    """Map a raw heading to a canonical section key, or None if unrecognised.

    Normalises by lowercasing, stripping non-alphanumeric chars, and collapsing
    whitespace, so ``## Notes``, ``## Notes:``, ``## NOTES REFERENCED`` and
    ``## Notes-Referenced`` all map to the notes section.
    """
    normalised = re.sub(r"[^a-z0-9]+", " ", heading.lower()).strip()
    if not normalised:
        return None
    if normalised in {"notes", "notes referenced", "referenced notes"}:
        return _NOTES
    if normalised in {"summary", "overview", "tldr", "tl dr"}:
        return _SUMMARY
    if normalised in {"themes", "theme"}:
        return _THEMES
    if normalised in {"activity", "activities", "actions", "activity log"}:
        return _ACTIVITY
    return None


def _strip_heading(section: str) -> str:
    """Return a ``## Heading``-led block's body, without the heading line."""
    match = _SECTION_RE.search(section)
    if not match:
        return section.strip()
    return section[match.end() :].strip()
