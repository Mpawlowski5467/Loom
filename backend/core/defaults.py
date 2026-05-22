"""Default file contents for vault initialization."""

# -- Agent constants ----------------------------------------------------------

LOOM_AGENTS = ["weaver", "spider", "archivist", "scribe", "sentinel"]
SHUTTLE_AGENTS = ["researcher", "standup"]
ALL_AGENTS = LOOM_AGENTS + SHUTTLE_AGENTS

# -- Prime (constitution) -----------------------------------------------------

PRIME_MD = """\
# Prime — Vault Constitution

These rules govern all agent behavior within this vault. They are immutable
to agents and can only be changed by the vault owner.

## Rules

1. **Atomic notes.** Each note captures one concept, one project, or one person.
   Never merge unrelated ideas into a single file.

2. **Archive, never delete.** Moving a note to `.archive/` is the only permitted
   removal. No agent may permanently delete a file under any circumstance.

3. **Read before write.** Every agent must complete the full read chain
   (vault.yaml → prime.md → role rules → memory.md → _index.md → linked notes)
   before creating or modifying any file.

4. **Link related notes.** When a meaningful relationship exists between two
   notes, create a `[[wikilink]]`. Prefer explicit links over implicit keyword
   overlap.

5. **Log every action.** All agent mutations must be recorded in the per-agent
   changelog at `.loom/changelog/<agent>/<date>.md` and in the note's
   `history` frontmatter field.

6. **Respect the shuttle boundary.** Shuttle-layer agents (Researcher, Standup)
   write only to `captures/`. Loom-layer agents process captures into the
   vault proper.

7. **User authority is final.** If a user instruction conflicts with any agent
   heuristic, the user instruction takes precedence. Agents must never
   silently override user intent.

8. **Summarize memory regularly.** Agent `memory.md` must be summarized every
   20 actions to prevent unbounded context growth.
"""

# -- Schemas ------------------------------------------------------------------

SCHEMA_PROJECT_MD = """\
# Schema: Project

Template for project notes in `threads/projects/`.

## Required Frontmatter

```yaml
id: thr_<6char>
title: Project Name
type: project
tags: []
created: ISO8601
modified: ISO8601
author: user|agent:<name>
status: active|archived
links: []
history: []
```

## Expected Sections

- `## Overview` — one-paragraph project summary
- `## Goals` — bulleted list of objectives
- `## Status` — current state and next steps
- `## Related` — wikilinks to people, topics, other projects
"""

SCHEMA_TOPIC_MD = """\
# Schema: Topic

Template for topic notes in `threads/topics/`.

## Required Frontmatter

```yaml
id: thr_<6char>
title: Topic Name
type: topic
tags: []
created: ISO8601
modified: ISO8601
author: user|agent:<name>
status: active|archived
links: []
history: []
```

## Expected Sections

- `## Summary` — core idea in 2-3 sentences
- `## Details` — expanded knowledge
- `## References` — external sources or wikilinks
"""

SCHEMA_PERSON_MD = """\
# Schema: Person

Template for person notes in `threads/people/`.

## Required Frontmatter

```yaml
id: thr_<6char>
title: Person Name
type: person
tags: []
created: ISO8601
modified: ISO8601
author: user|agent:<name>
status: active|archived
links: []
history: []
```

## Expected Sections

- `## Context` — role, relationship, organization
- `## Notes` — key interactions or knowledge shared
- `## Related` — wikilinks to projects, topics, other people
"""

SCHEMA_DAILY_MD = """\
# Schema: Daily

Template for daily log notes in `threads/daily/`.

## Required Frontmatter

```yaml
id: thr_<6char>
title: YYYY-MM-DD
type: daily
tags: []
created: ISO8601
modified: ISO8601
author: user|agent:<name>
status: active|archived
links: []
history: []
```

## Expected Sections

- `## Log` — freeform daily entries, timestamped
- `## Tasks` — completed and pending items
- `## Links` — wikilinks to notes referenced today
"""

SCHEMA_CAPTURE_MD = """\
# Schema: Capture

Template for raw captures in `threads/captures/`.

## Required Frontmatter

```yaml
id: thr_<6char>
title: Capture Title
type: capture
tags: []
created: ISO8601
modified: ISO8601
author: user|agent:<name>
source: capture:<id>|manual|bridge:<type>
status: active|archived
links: []
history: []
```

## Expected Sections

- `## Content` — raw captured text or data
- `## Context` — where this came from, why it matters
"""

SCHEMAS = {
    "project.md": SCHEMA_PROJECT_MD,
    "topic.md": SCHEMA_TOPIC_MD,
    "person.md": SCHEMA_PERSON_MD,
    "daily.md": SCHEMA_DAILY_MD,
    "capture.md": SCHEMA_CAPTURE_MD,
}

# -- Prompts ------------------------------------------------------------------

SYSTEM_PREAMBLE_MD = """\
# System Preamble

You are an agent in the Loom knowledge management system. You operate within
a markdown-based vault and follow the rules defined in `prime.md`.

## Core Principles

- Read the full context chain before taking any action.
- Log every mutation to the changelog.
- Use [[wikilinks]] for all internal references.
- Respect the vault constitution (prime.md) at all times.
- When uncertain, prefer inaction over incorrect action.
"""

# -- Agent defaults -----------------------------------------------------------

AGENT_MEMORY_MD = """\
# Memory

No actions recorded yet.
"""

AGENT_STATE_JSON = '{"action_count": 0, "last_action": null}\n'


def agent_config_yaml(name: str) -> str:
    """Return default config.yaml content for an agent."""
    return f"""\
# Agent: {name}
name: {name}
enabled: true
trust_level: standard
memory_threshold: 20
"""
