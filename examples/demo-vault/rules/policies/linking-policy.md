---
id: policy_linking
title: Linking Policy
type: policy
created: 2026-03-01T09:00:00Z
modified: 2026-03-01T09:00:00Z
author: user
---

# Linking Policy

Rules governing how agents create and manage [[wikilinks]] within the vault.

## When to Link

- **Always link** when a note directly discusses a concept that has its own note.
- **Always link** people mentioned by name if they have a `people/` note.
- **Always link** projects referenced in daily notes or captures.
- **Suggest a link** (do not auto-create) when a topic is mentioned tangentially.

## How to Link

- Use the exact note title in the wikilink: `[[graph-databases]]` not `[[Graph Databases]]`.
- Use the filename (without `.md`), not the frontmatter title.
- Place links inline within prose, not in a separate "links" section at the bottom (unless it is the Connections section of a topic note).
- Update the `links` array in frontmatter whenever adding a new wikilink to the body.

## Bidirectional Linking

- When Spider creates a forward link from Note A to Note B, it must also check whether Note B should link back to Note A.
- Backlinks are not mandatory but are strongly encouraged for topic and project notes.
- People notes should not accumulate excessive backlinks; link to them but do not add every mention back.

## Link Density Targets

- **Topic notes**: minimum 3 outgoing links.
- **Project notes**: minimum 2 outgoing links to topics or people.
- **Daily notes**: link to every project or topic worked on that day.
- **Captures**: at least 1 link to the relevant project or topic.
- **People notes**: link to projects they are involved with.

## Anti-Patterns

- Do not create circular links just for density (A -> B -> A with no semantic reason).
- Do not link to archived notes unless historically relevant.
- Do not create orphan notes. Every new note must link to at least one existing note.
