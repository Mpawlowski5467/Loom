---
id: schema_topic
title: Topic Note Schema
type: schema
created: 2026-03-01T09:00:00Z
modified: 2026-03-01T09:00:00Z
author: user
---

# Topic Note Schema

Template for all notes with `type: topic`. Agents must follow this structure when creating or editing topic notes.

## Required Frontmatter

```yaml
---
id: thr_XXXXXX
title: Descriptive Title
type: topic
tags: [max-five, lowercase, hyphenated]
created: ISO8601
modified: ISO8601
author: user|agent:<name>
source: manual|capture:thr_XXXXXX
links: []
status: active
history:
  - action: created
    by: user|agent:<name>
    at: ISO8601
    reason: "why this note was created"
---
```

## Required Sections

### Definition

A 1-2 sentence definition of the topic. What is it?

### Key Concepts

Bulleted list of the core ideas. Each bullet should be a single sentence. Link to other notes with [[wikilinks]] where relevant.

### Connections

How does this topic relate to other things in the vault? This section should be dense with [[wikilinks]].

### References

Optional. External sources, papers, articles, or tools. Use standard markdown links for external URLs.

## Rules

- Keep topic notes under 200 lines.
- Every topic must link to at least 2 other notes in the vault.
- Prefer [[wikilinks]] for internal references, standard markdown links for external.
- Update the `modified` timestamp and add a `history` entry on every edit.
