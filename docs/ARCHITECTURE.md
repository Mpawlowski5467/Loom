# Loom — Complete Architecture Document

> A self-organizing AI memory system with a multi-agent backbone and a visual knowledge graph.

Loom is a local-first, privacy-respecting AI knowledge base that lives on your machine. You point it at your notes, documents, and data — and it indexes, organizes, links, and maintains everything through a system of specialized AI agents. Your knowledge is stored as plain markdown files, visualized as an interactive graph, and searchable through natural language.

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Layer 1: The Vault](#2-layer-1-the-vault)
3. [Layer 2: The Index](#3-layer-2-the-index)
4. [Layer 3: The Agent Board](#4-layer-3-the-agent-board)
5. [Layer 4: The Rules Engine](#5-layer-4-the-rules-engine)
6. [Layer 5: The Graph UI](#6-layer-5-the-graph-ui)
7. [Layer 6: The Bridge](#7-layer-6-the-bridge)
8. [Layer 7: The Prompt Compiler](#8-layer-7-the-prompt-compiler)
9. [File Support (Future)](#9-file-support-future)
10. [Tech Stack](#10-tech-stack)
11. [Repo Structure](#11-repo-structure)
12. [Roadmap](#12-roadmap)

---

## 1. Core Principles

- **Local-first**: everything runs on your machine. No cloud required.
- **Privacy-respecting**: nothing leaves your system unless you explicitly configure a cloud AI provider.
- **Human-readable**: all knowledge is stored as plain markdown files you can open, edit, and version control.
- **Git-friendly**: the entire vault is a folder you can track with git.
- **Provider-agnostic**: bring your own AI — OpenAI, Anthropic, xAI/Grok, Azure/Copilot, or fully local with Ollama.
- **Transparent**: every agent action is logged with who, when, and why. Nothing happens silently.
- **Cross-platform**: runs on macOS, Linux, and Windows.

---

## 2. Layer 1: The Vault

The Vault is Loom's foundation — a structured filesystem of markdown files that represents all of the system's knowledge. It is the single source of truth.

### 2.1 Key Decisions

- **Hybrid folder structure**: fixed core folders that Loom always creates (daily, projects, topics, people, captures), plus user-defined custom folders alongside them. Fixed folders guarantee agents always know where to put things. Custom folders give power users freedom.
- **Wikilinks**: all inter-note links use `[[note-name]]` syntax (Obsidian-style). Simple, widely supported, and makes graph construction easy — every `[[link]]` is an edge.
- **Multi-vault**: each vault is fully self-contained with its own config, index, agents, and rules. Switch between vaults (e.g., personal, work) freely. Each vault can be its own git repo, enabling team-shared vaults.
- **Optional auto-git**: off by default. User can enable automatic commits in config on a schedule or after agent actions.
- **Archive-based deletion**: notes are never truly destroyed. "Deleting" moves them to `threads/.archive/` with a deletion timestamp.

### 2.2 Folder Structure

```
~/.loom/
├── config.yaml                # global config (active vault, model settings, API keys)
├── vaults/
│   ├── personal/
│   │   ├── vault.yaml         # vault-specific config & custom folder definitions
│   │   ├── threads/
│   │   │   ├── daily/         # auto-generated daily logs
│   │   │   ├── projects/      # project-specific knowledge
│   │   │   ├── topics/        # cross-project knowledge by subject
│   │   │   ├── people/        # context about collaborators
│   │   │   ├── captures/      # raw inbox before agent processing
│   │   │   ├── .archive/      # archived (deleted) notes with timestamps
│   │   │   └── <custom>/      # user-defined folders (e.g., recipes, clients)
│   │   ├── agents/            # per-agent config, state, logs (see Layer 3)
│   │   ├── rules/             # schemas, policies, workflows, prime.md (see Layer 4)
│   │   └── .loom/             # internal state (not user-facing)
│   │       ├── index.db       # LanceDB vector index
│   │       ├── graph.json     # relationship map for the UI
│   │       ├── history.log    # agent action audit trail
│   │       └── changelog/     # per-agent-per-day action logs (see 4.11)
│   └── work/
│       ├── vault.yaml
│       ├── threads/
│       │   ├── daily/
│       │   ├── projects/
│       │   ├── topics/
│       │   ├── people/
│       │   ├── captures/
│       │   ├── .archive/
│       │   └── <custom>/
│       ├── agents/
│       ├── rules/
│       └── .loom/
```

### 2.3 Note Format

Every note uses YAML frontmatter for metadata, followed by markdown content with `[[wikilinks]]`.

```markdown
---
id: thr_a7f3b2
title: OAuth Token Refresh Strategy
type: topic
tags: [oauth, authentication, tokens, security]
created: 2026-03-11T10:30:00
modified: 2026-03-11T14:22:00
author: agent:weaver
source: capture:email-import-032026
links: []
status: active
history:
  - action: created
    by: agent:weaver
    at: 2026-03-11T10:30:00
    reason: "Extracted from email capture"
  - action: edited
    by: user
    at: 2026-03-11T12:00:00
    reason: "Added open questions section"
  - action: linked
    by: agent:spider
    at: 2026-03-11T14:22:00
    reason: "Connected to [[api-gateway]] based on shared tags"
---

# OAuth Token Refresh Strategy

Summary of the implementation approach...

## Key Decisions
- Silent acquisition with fallback to interactive login
- Refresh tokens stored in HttpOnly cookies

## Open Questions
- Session management across multiple tabs
- Redis failover strategy for token cache

## Related
- [[api-gateway]]
- [[session-management]]
```

### 2.4 Edit History

Every mutation to a note is logged in the frontmatter `history` array with:
- **action**: what happened (created, edited, linked, archived, etc.)
- **by**: who did it (user or agent:name)
- **at**: ISO timestamp
- **reason**: why it happened

Agents should never silently delete or overwrite content. This history provides full transparency and trust.

### 2.5 `_index.md` Files

Every folder can have an `_index.md` — a living, auto-generated summary of what's inside that folder. Maintained by the Scribe agent and kept up to date as notes change. Serves as both a human-readable overview and context for agents operating in that folder.

### 2.6 `captures/` Inbox

Raw information lands here through three paths:
1. **Manually**: user drops a note or text file in
2. **Via integrations**: Bridge layer dumps external data (emails, GitHub events, calendar)
3. **From Shuttle agents**: task agents output their work here

Loom Layer agents process captures, break them apart, and file them into the right places according to the rules engine. The raw capture stays in `.archive/` as a reference.

---

## 3. Layer 2: The Index

The Index is the search brain that makes the vault queryable beyond filenames and tags. It converts notes into vector embeddings, stores them locally, and enables natural language queries.

### 3.1 Key Decisions

- **Vector database**: LanceDB — lightweight, serverless, built for AI workloads. No infrastructure to manage.
- **Provider-agnostic models**: unified interface supporting OpenAI, Anthropic, xAI/Grok, Azure/Copilot, and local models via Ollama. Embedding and chat models are configured independently.
- **Smart chunking**: notes are split by `##` markdown headers. Each section is embedded individually with a reference back to its parent note. Keeps chunks semantically meaningful while enabling precise retrieval.
- **Hybrid + graph-aware search**: three-layer search strategy:
  1. **Semantic similarity**: embeddings via LanceDB for natural language matching
  2. **Keyword/tag filtering**: structured filters for precision (type, tags, date, author)
  3. **Graph-aware boosting**: results connected via `[[wikilinks]]` to already-relevant notes get a score boost
- **Frontmatter hybrid**: tags and title are embedded alongside content for richer semantic matching. Other metadata (dates, author, status) stays as structured filters only.
- **Hybrid indexing**: real-time file watcher for small edits (single note changed), scheduled batch re-index for heavy operations (bulk imports, schema changes).

### 3.2 Provider Configuration

```yaml
# config.yaml or vault.yaml
providers:
  default: openai

  openai:
    api_key: ${OPENAI_API_KEY}
    embed_model: text-embedding-3-small
    chat_model: gpt-4o

  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    chat_model: claude-sonnet-4-20250514

  ollama:
    host: http://localhost:11434
    embed_model: nomic-embed-text
    chat_model: llama3

  xai:
    api_key: ${XAI_API_KEY}
    chat_model: grok-2
```

**Key insight**: embedding and chat are separate concerns. You might use cheap local embeddings via Ollama for indexing (runs constantly) but route agent chat/reasoning through Claude or GPT for quality. Mix and match freely.

---

## 4. Layer 3: The Agent Board

The Agent Board is a two-tier system of specialized AI agents that read, write, organize, and maintain the vault.

### 4.1 Two-Tier Architecture

```
┌─────────────────────────────────────────────────┐
│           SHUTTLE LAYER (Task Agents)            │
│              Researcher · Standup                │
│           ↓ produce content ↓                    │
├─────────────────────────────────────────────────┤
│            LOOM LAYER (System Agents)            │
│  Weaver · Spider · Archivist · Scribe · Sentinel │
│           ↓ manage the vault ↓                   │
├─────────────────────────────────────────────────┤
│                 THE VAULT                        │
│           threads / index / graph                │
└─────────────────────────────────────────────────┘
```

**Shuttle agents produce content. Loom agents manage it.** A Shuttle agent never writes directly to the vault — it passes output into `captures/`, where Loom agents pick it up and process it through the read chain. This clean separation means the vault's integrity is always maintained by the system layer.

### 4.2 Loom Layer (System Agents)

Infrastructure agents that manage the vault. Run in the background, triggered by events and schedules.

| Agent | Role | Description |
|-------|------|-------------|
| **Weaver** | Creator | Takes raw captures and creates properly formatted, linked notes following schemas |
| **Spider** | Linker | Scans the vault for connections. Adds `[[wikilinks]]` and grows the graph organically |
| **Archivist** | Organizer | Audits for stale notes, duplicates, missing frontmatter, broken links. Proposes cleanups |
| **Scribe** | Summarizer | Maintains `_index.md` files, generates daily logs, creates rollup summaries over time |
| **Sentinel** | Reviewer | Validates agent work against `prime.md` and rules engine. Quality control for all actions |

### 4.3 Shuttle Layer (Task Agents)

User-facing agents that do specific jobs. Sit on top of the Loom layer.

**v1 ships with:**

| Agent | Role | Description |
|-------|------|-------------|
| **Researcher** | Query & Synthesize | Ask a question — searches vault (and optionally web), synthesizes answer, saves findings |
| **Standup** | Daily Recap | Generates a summary of what changed across projects. Morning briefing |

**Future Shuttle agents**: Reviewer (feedback on docs/code), Planner (project breakdown/tracking), Digest (integration summaries).

### 4.4 Read-Before-Write Protocol

Before any agent writes to the vault, it must follow a mandatory reading chain:

```
1. Read: vault.yaml              → vault-level rules, boundaries, identity
2. Read: rules/prime.md          → the "constitution" — core principles all agents follow
3. Read: rules/<agent-role>.md   → role-specific rules for this agent type
4. Read: agents/<self>/memory.md → agent's own summarized memory and learned context
5. Read: _index.md of target     → understand what already exists where it's writing
6. Read: related [[linked]] notes → understand surrounding context
7. THEN: perform the action
```

This ensures every agent action is contextually aware and rule-compliant.

### 4.5 `prime.md` — The Constitution

The most important file in the system. User-defined core principles that every agent reads every time, no exceptions. Example rules:
- "Never delete a note without archiving it first"
- "Always add a source field when creating from external data"
- "Keep notes atomic — one concept per file"
- "Always link to related existing notes before creating duplicates"
- "Use descriptive filenames, never generic ones"

**Immutability rules:**
- `prime.md` is user-owned and immutable to agents by default
- Agents can suggest changes only through the chat interface (never directly edit)
- User must make changes manually
- Auto-updates by agents can be explicitly enabled in config, but are off by default

### 4.6 Chain Failure Handling

- **Hard block by default**: if an agent fails to complete the read chain, the action is rejected and logged
- **Soft warning available for trusted agents**: configurable per-agent in the agent's config
- All failures are logged in the agent's log folder and the vault's `history.log`

### 4.7 Agent Configuration

Each agent gets its own folder with config, state, memory, chat history, and logs:

```
agents/
├── weaver/
│   ├── config.yaml        # role, trust level, provider, autonomy settings
│   ├── state.json         # runtime state, last run, queue
│   ├── memory.md          # summarized memory of past actions and context
│   └── logs/              # timestamped action history
├── spider/
│   ├── config.yaml
│   ├── state.json
│   ├── memory.md
│   └── logs/
├── archivist/
│   ├── config.yaml
│   ├── memory.md
│   └── logs/
├── scribe/
│   ├── config.yaml
│   ├── memory.md
│   └── logs/
├── sentinel/
│   ├── config.yaml
│   ├── memory.md
│   └── logs/
├── researcher/
│   ├── config.yaml
│   ├── memory.md
│   ├── chat/              # saved 1:1 chat history
│   └── logs/
├── standup/
│   ├── config.yaml
│   ├── memory.md
│   ├── chat/              # saved 1:1 chat history
│   └── logs/
└── _council/
    └── chat/              # saved Loom Council chat history
```

### 4.8 Agent Autonomy

Configurable per agent with the read chain as the non-negotiable baseline:
- Some agents auto-write (with read chain enforced)
- Others require user approval before actions execute
- Trust levels determine hard-block vs soft-warning behavior
- All actions are logged regardless of autonomy level

### 4.9 Coordination

Agents coordinate through two mechanisms:
- **Pipelines** for complex workflows: capture arrives → Weaver creates note → Spider links it → Scribe updates index → Sentinel validates
- **Event-driven** for real-time reactions: file modified → re-index, new capture detected → trigger Weaver

### 4.10 Custom Agents (Future)

Custom Shuttle agents will come in a later version. Users will drop a new folder into `agents/` with a config file, and the system picks it up. Custom agents are always Shuttle-tier — the Loom layer is locked down and protected.

### 4.11 Global Changelog

A vault-wide timeline of every action taken by every agent. Stored as append-only markdown log files organized per agent per day:

```
.loom/
└── changelog/
    ├── weaver/
    │   ├── 2026-03-11.md
    │   └── 2026-03-12.md
    ├── spider/
    │   ├── 2026-03-11.md
    │   └── 2026-03-12.md
    ├── archivist/
    │   └── 2026-03-12.md
    ├── scribe/
    │   └── 2026-03-12.md
    ├── sentinel/
    │   └── 2026-03-12.md
    ├── researcher/
    │   └── 2026-03-12.md
    └── standup/
        └── 2026-03-12.md
```

Each log entry in a daily file looks like:

```markdown
## 14:22:00 — linked

- **target**: [[api-gateway]]
- **action**: Added wikilink to [[session-management]] based on shared tags
- **read chain**: ✓ passed (vault.yaml → prime.md → linking.md → _index.md)
- **validated by**: sentinel (✓ passed)
```

This gives you a full, human-readable, git-trackable history of everything that happened in the vault. You can browse by agent, by date, or search across all logs.

### 4.12 Agent Memory

Each agent maintains a `memory.md` file in its folder — a summarized record of its past actions, patterns, and learned context. This is what gives agents continuity across sessions.

**How it works:**
- After every N actions (default: 20, configurable per agent), the agent summarizes its recent action history and updates `memory.md`
- `memory.md` is part of the read chain — agents read it alongside their role rules before acting
- The summary is cumulative: new summaries incorporate and condense previous ones, so the file stays manageable over time
- Memory captures patterns, not just actions: "I've linked 12 notes to [[api-gateway]] this week — it's becoming a hub" or "User frequently edits notes I create in topics/ to add more detail to the Open Questions section"

**Example `memory.md`:**

```markdown
# Spider — Memory

## Summary (updated after action #140)

### Linking Patterns
- The vault has 3 major hub notes: [[atlas-dashboard]], [[api-gateway]], [[deploy-pipeline]]
- Notes in topics/ tend to connect to multiple projects. Cross-linking between topics/ and projects/ is high-value.
- User has pinned [[atlas-dashboard]] in the graph — this is likely an important node to keep well-connected.

### Recent Activity
- Created 6 new links in the last batch, mostly connecting new captures from GitHub to existing project notes.
- Sentinel flagged one link as low-confidence ([[meeting-notes]] → [[docker-setup]]). Will be more conservative with meeting note connections.

### Learned Preferences
- User tends to approve links between topics and projects but rejects links between daily notes and people notes.
- Archival policy suggests notes untouched for 30+ days are stale, but user overrode this for reference notes in topics/.
```

### 4.13 Chat System

Loom has two distinct chat interfaces:

#### 4.13.1 Loom Council Chat

A single chat interface for talking to the Loom Layer as a collective. When you ask a question, all five system agents (Weaver, Spider, Archivist, Scribe, Sentinel) discuss it internally — and you see the full transparent thread.

**How it works:**
1. User asks a question (e.g., "Why did this note get linked to that one?")
2. The question is routed to all Loom Layer agents
3. Agents discuss internally — Spider explains the link, Sentinel confirms it passed validation, Archivist notes there's a related duplicate
4. You see the full back-and-forth, labeled by agent, followed by a final consolidated answer
5. Conversation is saved in `agents/_council/chat/`

**Example thread:**

```
You: Why was [[session-management]] linked to [[api-gateway]]?

🕷 Spider: I linked them because they share 3 tags (oauth, tokens, security)
   and [[api-gateway]] references token handling which is the core topic
   of [[session-management]].

🛡 Sentinel: I validated this link. Both notes passed the read chain and
   the link is consistent with linking.md policy (shared tags ≥ 2).

🗃 Archivist: Note — there's also a [[token-caching]] note that covers
   similar ground to [[session-management]]. You may want to merge or
   cross-link them.

━━━ Summary: The link was created based on 3 shared tags and topical
overlap around token handling. Sentinel confirmed it's valid. Archivist
suggests reviewing [[token-caching]] for potential overlap.
```

**Use cases:**
- Understanding why agents made certain decisions
- Asking about vault health and status
- Requesting agents to perform actions (which they'll execute through the normal pipeline)
- Getting a holistic view that spans multiple agent perspectives

#### 4.13.2 Shuttle Agent Chat

Individual 1:1 conversations with each Shuttle agent. Each agent has its own chat history and draws on its `memory.md` for context.

**How it works:**
1. User selects a Shuttle agent (Researcher or Standup) in the Board View
2. Chat is direct — you talk to that agent alone
3. Agent reads its `memory.md` before responding for continuity
4. Chat history is saved in the agent's `chat/` folder
5. Agent remembers past conversations and findings

**Example (Researcher):**

```
You: What did you find last time about caching strategies?

🔬 Researcher: In our last conversation (Mar 10), I searched the vault
   and found 3 relevant notes: [[token-caching]], [[redis-patterns]],
   and [[api-gateway]]. The main finding was that your vault leans toward
   Redis-based caching with HttpOnly cookies for session tokens. I saved
   a summary to topics/caching-strategies.md. Want me to dig deeper into
   any of those?
```

#### 4.13.3 Chat History Persistence

All conversations are saved as markdown files:

```
agents/
├── _council/
│   └── chat/
│       ├── 2026-03-11.md      # council conversations by date
│       └── 2026-03-12.md
├── researcher/
│   └── chat/
│       ├── 2026-03-10.md      # 1:1 conversations by date
│       └── 2026-03-12.md
└── standup/
    └── chat/
        └── 2026-03-12.md
```

Chat history is markdown (consistent with everything else), human-readable, and git-trackable. Agents read recent chat history as part of their context when responding to give continuity across sessions.

---

## 5. Layer 4: The Rules Engine

The Rules Engine is the DNA of the vault. It tells agents how to behave beyond what's in `prime.md`. While `prime.md` is the constitution (universal principles), the Rules Engine provides specific playbooks.

### 5.1 Key Decisions

- **All markdown**: schemas, policies, and workflows are `.md` files. Consistent with everything else in the vault. Agents parse them naturally.
- **Lenient enforcement**: schemas are guidelines, not gates. Agents do their best to follow them but won't block on mismatches. Sentinel flags issues for review rather than rejecting outright.
- **Full defaults + examples**: Loom ships with working schemas for every note type, sensible policies for all agents, starter workflows for common pipelines, plus an `examples/` folder showing how to customize.

### 5.2 Structure

```
rules/
├── prime.md                    # the constitution (user-owned, immutable to agents)
├── schemas/
│   ├── project.md              # template for project notes
│   ├── topic.md                # template for topic notes
│   ├── person.md               # template for people notes
│   ├── daily.md                # template for daily logs
│   └── capture.md              # template for raw captures
├── policies/
│   ├── linking.md              # rules for how Spider creates links
│   ├── archival.md             # rules for when Archivist archives stale notes
│   ├── summarization.md        # rules for how Scribe writes summaries
│   └── naming.md               # file naming conventions
└── workflows/
    ├── capture-to-thread.md    # pipeline: how a capture becomes a proper note
    └── daily-standup.md        # pipeline: how Standup generates the morning recap
```

### 5.3 Rule Types

**Schemas** define what a note of each type should look like:
- Required frontmatter fields
- Expected markdown sections and their order
- Formatting rules and constraints
- Example note for reference

**Policies** are behavioral rules for specific agents:
- How aggressive Spider should be with linking (conservative vs exploratory)
- How old a note must be before Archivist flags it as stale
- What counts as a "duplicate" vs a "related" note
- File naming conventions and slug formatting

**Workflows** are multi-step pipelines:
- Which agents are involved and in what order
- What triggers the workflow (event, schedule, manual)
- Success/failure conditions and fallbacks

---

## 6. Layer 5: The Graph UI

The Graph UI is the visual interface where users see and interact with their knowledge. It is the face of Loom.

### 6.1 Platform & Rendering

- **Web-based (localhost)**: runs a local FastAPI server, opens in browser. Cross-platform for free — no packaging headaches on macOS, Linux, or Windows.
- **Sigma.js**: WebGL-powered graph rendering. Handles thousands of nodes performantly without frame drops.
- **Plate (Slate.js)**: rich WYSIWYG markdown editor. Built on Slate.js, highly customizable, React-native.
- **Dark theme only** for v1.

### 6.2 Layout

Two-panel base layout with a contextual right sidebar that slides in when a note is selected:

```
┌──────────────────────────────────────────────────────────────┐
│  🕸 Loom       [Graph] [Board] [Inbox]     🔍 Search   ⚙     │
├──────────┬───────────────────────────┬───────────────────────┤
│          │                           │                       │
│ FILE     │      MAIN AREA            │   RIGHT SIDEBAR       │
│ TREE     │   (Graph / Board / Inbox) │   (slides in when     │
│          │                           │    note is selected)  │
│ Always   │                           │   Thread View or      │
│ visible  │                           │   Rich Editor         │
│          │                           │                       │
│          │                           │                       │
│          │                           │                       │
└──────────┴───────────────────────────┴───────────────────────┘
```

- **Base state**: file tree (left) + main area (full remaining width)
- **Note selected**: right sidebar slides in with Thread View (rendered markdown, backlinks, history)
- **Editing**: right sidebar switches to rich editor with toolbar
- **Sidebar closes**: back to two panels
- **Panels are fixed width** — no resizable panels, keeps it simple

### 6.3 Navigation

- **Top navigation bar** across full width with view tabs: Graph, Board, Inbox
- **Global search bar** in the top nav (searches filenames, content, tags)
- **Separate filter bar** inside the file tree for filtering the tree only
- **Settings gear** in the top nav
- **Mouse-first** interaction. Keyboard shortcuts are nice-to-have, not required.

### 6.4 Views

All four views ship in v1:

#### 6.4.1 Graph View
The main knowledge graph. Nodes are notes, edges are `[[wikilinks]]`.
- Nodes are dots with floating labels (minimal, Obsidian-style)
- Color-coded by note type
- Size scaled by number of connections (hub nodes are larger)
- Click a node → right sidebar opens with Thread View
- Graph and file tree stay in sync bidirectionally (click a node → highlights in tree, click a file → zooms to node in graph)

#### 6.4.2 Board View
The agent dashboard showing both Loom and Shuttle layer agents.
- Agent cards with status (idle/running/queued), stats, and recent actions
- **Loom Council Chat**: a single chat interface where you talk to all Loom Layer agents as a group. You see the transparent back-and-forth between agents, then a final answer.
- **Shuttle Agent Chat**: individual 1:1 chat interfaces for Researcher, Standup, and future Shuttle agents. Each has its own history and memory.
- Activity log showing all recent agent actions with timestamps and validation status

#### 6.4.3 Captures Inbox
Queue-style view of everything in `captures/` waiting to be processed.
- Cards showing source (email/github/manual), preview text, status
- Filter tabs: All, Pending, Processing, Done, by source
- Action buttons: Process (trigger Weaver), Preview, Archive
- Right sidebar shows raw capture preview with Weaver's suggested filing

#### 6.4.4 Thread View (in right sidebar)
Rendered markdown view of a specific note when selected from graph or file tree.
- Rendered content with clickable `[[wikilinks]]`
- Frontmatter metadata display (type, tags)
- Backlinks section (what links TO this note)
- Edit history section (who changed what, when, why — color-coded amber for user, purple for agent)
- View/Edit toggle buttons

### 6.5 File Explorer

Always-visible left sidebar showing the vault as a traditional file tree (VS Code-style).

**Capabilities:**
- Browse folders and files as a collapsible tree
- Click a file to open it in the Thread View sidebar
- Edit notes directly via the rich editor
- Create new notes and folders
- Rename and move files via drag and drop
- Delete (archive) notes
- Search/filter the file tree with a dedicated filter input
- See file metadata at a glance: colored dot for type, connection count, last modified

### 6.6 Rich Editor

When editing a note, the right sidebar becomes a WYSIWYG editor powered by Plate (Slate.js).

**Toolbar:**
- Text formatting: Bold, Italic, Strikethrough, Code
- Headings: H1, H2, H3
- Lists: Bullet, Numbered, Checkbox
- Special: Insert `[[wikilink]]` button

**Meta section above editor:**
- Type selector (dropdown: topic, project, person, daily)
- Tags (chips with add/remove)
- Folder selector (dropdown)

**Editor body:**
- WYSIWYG rendering of markdown
- `[[wikilinks]]` rendered as clickable purple chips
- Live cursor line highlighting
- Standard keyboard shortcuts for formatting

### 6.7 Create Note Modal

When creating a new note from the UI, a modal dialog appears over the current view.

**Fields:**
- Title (text input)
- Type (dropdown: topic, project, person, daily)
- Folder (dropdown: threads/topics, threads/projects, etc.)
- Tags (text input with chip display, add/remove)
- Initial content (optional)

**Key behavior**: the request goes to Weaver. The agent runs the full read chain (vault.yaml → prime.md → schema → _index.md), applies the appropriate schema, and creates the note properly.

Modal footer shows: "🕸 Weaver will read prime.md → apply schema → create note"

### 6.8 Graph Interactivity

| Feature | Description |
|---------|-------------|
| **Drag nodes** | Reposition any node by dragging. Smooth physics response. |
| **Zoom and pan** | Scroll to zoom, click-drag background to pan. |
| **Hover highlight** | Hovering a node highlights all its direct connections and dims everything else. |
| **Pin nodes** | Pin a node in place so it doesn't move with physics. Useful for anchoring key hubs. |
| **Live filtering** | Filter chips at top of graph: by type (project, topic, person, daily), tag, date, agent author. Filters apply instantly. |

**Layout**: force-directed (physics-based). Nodes push and pull organically. Natural clustering emerges from link density.

**Animations**: subtle. Smooth transitions when filtering, adding, or removing nodes. Not flashy.

### 6.9 Graph Visuals

| Element | Style |
|---------|-------|
| **Nodes** | Dots with floating labels (minimal, Obsidian-style) |
| **Node size** | Scaled by number of connections. Hub nodes are noticeably larger. |
| **Node color** | Color-coded by note type (see Color System) |
| **Node glow** | Glow effect only on hover or when active/selected. No persistent glow. |
| **Edges** | Lines that get thicker based on connection density between areas |
| **Edge color** | Muted purple for thick connections, subtle gray for thin |

### 6.10 Notifications & Real-Time

- **Toast notifications**: small popups in the bottom-right corner that fade away. Purple border for agent actions. Shown for note creation, linking, issue flagging.
- **Auto-refresh**: graph updates on a short interval (every 5-10 seconds) as agents work. No manual reload required.

### 6.11 Color System

Loom uses a dark color palette with amber for user actions and purple for agent/system actions. This split provides instant visual distinction between "I did this" and "an agent did this."

#### Base Colors

| Role | Hex |
|------|-----|
| Background (base) | `#0f172a` |
| Background (surface) | `#1e293b` |
| Background (elevated) | `#334155` |
| Text (primary) | `#e2e8f0` |
| Text (secondary) | `#94a3b8` |

#### Accent Colors (Split by Context)

| Role | Hex | Usage |
|------|-----|-------|
| User accent (amber) | `#f59e0b` | Buttons, edits, create actions, user history dots, active tabs |
| Agent accent (purple) | `#a78bfa` | Agent badges, graph edges, system actions, wikilinks, toast borders |

#### Node Colors (Muted Jewel Tones)

| Note Type | Hex |
|-----------|-----|
| Project | `#60a5fa` |
| Topic | `#4ade80` |
| Person | `#c084fc` |
| Daily | `#94a3b8` |
| Capture | `#fbbf24` |
| Custom | `#2dd4bf` |

#### Status Colors

| Role | Hex |
|------|-----|
| Danger / archive | `#f87171` |
| Success / toast | `#34d399` |

#### Typography

| Role | Font |
|------|------|
| UI / headings / body | Sora |
| Code / timestamps / monospace | JetBrains Mono |

#### Logo

Amber-to-purple gradient (`#f59e0b` → `#a78bfa`), representing the user-agent duality.

---

## 7. Layer 6: The Bridge

The Bridge is how Loom connects to the outside world. All integrations follow the same flow: external data lands in `captures/`, and Loom agents process it from there.

### 7.1 Key Decisions

- **v1 integrations** (hardcoded into core): GitHub, Email, Calendar
- **v2**: refactor into a plugin system with a standard interface for community-built integrations (Slack, Notion, web clipper, etc.)

### 7.2 v1 Integrations

**GitHub**: polls repos or uses webhooks. Pulls commits, issues, and PRs as capture notes with metadata (repo, author, labels, timestamp). Weaver files them under the right project.

**Email**: local IMAP listener or forwarding address. Receives emails, parses them into markdown captures with sender, subject, date, and body.

**Calendar**: connects to Google Calendar or iCal. Pulls today's events, auto-seeds the daily log with meeting blocks (time, title, attendees). Scribe enriches after user adds notes.

### 7.3 Integration Data Flow

```
External Source (GitHub / Email / Calendar)
    ↓
Bridge adapter parses data → markdown
    ↓
Drops into captures/ as .md file
    ↓
Loom agents detect new capture (event-driven)
    ↓
Weaver runs read chain → creates proper note
    ↓
Spider links it → Scribe updates indexes → Sentinel validates
```

---

## 8. Layer 7: The Prompt Compiler

The Prompt Compiler is the system that sits between agents and the LLM. Every prompt passes through it before being sent. Its job is to produce token-efficient, well-structured, high-quality prompts every time.

### 8.1 Architecture

Two-part system: a centralized compiler with shared optimization logic, plus per-agent templates for role-specific prompts.

```
Agent wants to act
    ↓
Reads context via read chain (vault.yaml, prime.md, role rules, memory.md, _index.md, related notes)
    ↓
Passes raw context + intent to Prompt Compiler
    ↓
Compiler: selects template → prunes context → compresses → ranks priority → counts tokens → assembles final prompt
    ↓
Sends to LLM provider
    ↓
Response returns to agent
```

### 8.2 Optimizations

The compiler applies six optimization steps in order:

| Step | What it does |
|------|-------------|
| **1. Prompt templates** | Selects the right reusable, well-tested template for this action (create note, link, summarize, etc.). Templates define the prompt skeleton with `{{variable}}` slots. |
| **2. Context pruning** | Trims irrelevant context from the read chain. If the agent is linking two notes about API design, it doesn't need the full contents of the daily log or unrelated people notes. |
| **3. Priority ranking** | Ranks remaining context items by relevance to the current task. The most relevant items get included first within the token budget. Lower-priority items get dropped. |
| **4. Context compression** | For context items that are important but long, summarizes them before inclusion rather than sending full text. A 2000-word note becomes a 200-word summary if that's sufficient for the task. |
| **5. Token counting** | Measures the assembled prompt's token count before sending. If over budget, triggers further pruning or compression. Warns in the agent log if a prompt is consistently near the limit. |
| **6. Prompt versioning** | Tags every outgoing prompt with a version number from its template. Logs which version was used for each action so you can track which prompt changes improved results over time. |

### 8.3 Prompt Templates

Templates are markdown files with YAML frontmatter, stored in a dedicated `prompts/` directory. Consistent with the vault philosophy — human-readable, git-trackable, editable by the user.

```
prompts/
├── _compiler.yaml             # global compiler config (token budgets, compression thresholds)
├── shared/
│   ├── system-preamble.md     # shared system prompt all agents use
│   └── output-format.md       # shared output formatting instructions
├── weaver/
│   ├── create-note.md         # template for creating a new note from a capture
│   ├── classify-capture.md    # template for classifying an incoming capture
│   └── apply-schema.md        # template for applying a schema to raw content
├── spider/
│   ├── find-connections.md    # template for discovering links between notes
│   └── validate-link.md       # template for checking if a proposed link is meaningful
├── archivist/
│   ├── audit-note.md          # template for auditing a note for issues
│   └── detect-duplicates.md   # template for finding duplicate content
├── scribe/
│   ├── summarize-folder.md    # template for generating _index.md
│   └── daily-log.md           # template for generating daily logs
├── sentinel/
│   └── validate-action.md     # template for validating an agent's proposed action
├── researcher/
│   ├── search-vault.md        # template for querying the vault
│   └── synthesize-answer.md   # template for synthesizing findings into a response
└── standup/
    └── generate-recap.md      # template for generating the daily standup
```

### 8.4 Template Format

Each template is a markdown file with YAML frontmatter defining metadata and variables:

```markdown
---
id: weaver/create-note
version: 3
token_budget: 4000
required_context:
  - prime.md
  - schema (matching type)
  - _index.md (target folder)
optional_context:
  - related notes (max 3)
  - memory.md
variables:
  - capture_content
  - target_type
  - target_folder
---

# System

You are Weaver, a note creation agent in the Loom knowledge system.

{{system-preamble}}

# Rules

{{prime.md}}
{{schema}}

# Context

Current folder index:
{{_index.md}}

Related notes (if any):
{{related_notes}}

# Task

Create a new {{target_type}} note from the following capture.
File it in {{target_folder}}.
Follow the schema exactly. Add appropriate [[wikilinks]] to related existing notes.

# Capture Content

{{capture_content}}

# Output

Respond with the complete markdown file including YAML frontmatter.
{{output-format}}
```

The compiler reads the template, fills in the variables, applies the optimization pipeline (prune, rank, compress, count), and sends the final assembled prompt to the LLM.

### 8.5 Compiler Configuration

```yaml
# prompts/_compiler.yaml
defaults:
  token_budget: 4000          # default max tokens per prompt
  compression_threshold: 500   # compress context items longer than this (in tokens)
  max_context_items: 10        # max number of context items to include
  priority_decay: 0.8          # how much less important each additional context item is

per_agent:
  weaver:
    token_budget: 6000         # Weaver needs more context for note creation
  spider:
    token_budget: 3000         # Spider's prompts are simpler
  researcher:
    token_budget: 8000         # Researcher may need extensive vault context
```

### 8.6 Versioning & Improvement

Every prompt sent to the LLM is logged with:
- Template ID and version number
- Token count (before and after optimization)
- Context items included (and which were pruned)
- Agent action result (success/failure, Sentinel validation)

This creates a feedback loop. Over time you can see which template versions produce better results, which context items are most useful, and where token budgets need adjusting.

---

## 9. File Support (Future)

Loom's vault is markdown-first, but will support additional file types in a future version.

### 9.1 Supported File Types

| Category | Extensions |
|----------|-----------|
| Images | `.png`, `.jpg`, `.gif`, `.svg` |
| Documents | `.pdf`, `.docx` |
| Spreadsheets | `.xlsx`, `.csv` |
| Code | `.py`, `.js`, `.ts`, `.go`, `.rs`, etc. |
| Plain text | `.txt`, `.log` |

### 9.2 Attachments Model

Non-markdown files are **attachments** — they attach to a parent `.md` note. The note is always the primary entity, and files are linked assets.

```
threads/projects/atlas-dashboard/
├── atlas-dashboard.md          # the primary note
└── _attachments/
    ├── architecture-diagram.png
    ├── requirements.pdf
    └── data-export.csv
```

Files are referenced from the parent note using a standard syntax:

```markdown
## Architecture
See the diagram: ![[architecture-diagram.png]]

## Requirements
Full spec: ![[requirements.pdf]]
```

### 9.3 Smart Extraction for Indexing

When indexing attachments, the system uses smart extraction:

| File type | Extraction method |
|-----------|------------------|
| PDF | Extract text via parser, embed alongside parent note |
| Word (.docx) | Extract text, embed alongside parent note |
| Spreadsheet (.xlsx, .csv) | Extract headers + sample rows, embed as structured summary |
| Code files | Extract full text, embed with language metadata |
| Plain text | Extract full text, embed directly |
| Images | Metadata only (filename, tags, user description). No content extraction unless vision model is configured. |

Extracted text gets chunked and embedded in LanceDB just like markdown sections, with a reference back to both the attachment file and its parent note.

### 9.4 Graph Representation

Attachments appear as smaller secondary nodes connected to their parent note, visually distinct from regular notes (different shape or icon). They don't clutter the graph but are visible when you zoom into a specific note's neighborhood.

---

## 10. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python + FastAPI |
| Frontend | React + Sigma.js |
| Rich Editor | Plate (Slate.js) |
| Vector DB | LanceDB |
| Storage | Markdown files + YAML frontmatter |
| AI Models | Provider-agnostic (OpenAI, Anthropic, xAI, Ollama) |
| Prompt Compiler | Markdown templates + Python optimization pipeline |
| Theme | Dark only (v1) |
| Delivery | Localhost web app (browser-based) |
| Repo | Monorepo |

---

## 11. Repo Structure

```
loom/
├── backend/                # Python — FastAPI, agents, index, rules engine
│   ├── api/                # FastAPI routes (vault, search, agents, graph data)
│   ├── agents/             # Agent logic
│   │   ├── loom/           # Weaver, Spider, Archivist, Scribe, Sentinel
│   │   └── shuttle/        # Researcher, Standup
│   ├── compiler/           # Prompt Compiler (optimization pipeline)
│   ├── index/              # LanceDB, embeddings, smart chunking, hybrid search
│   ├── rules/              # Rules engine parser (schemas, policies, workflows)
│   ├── bridge/             # GitHub, Email, Calendar integrations
│   └── core/               # Vault management, file watcher, config, read chain
├── frontend/               # React — Graph UI
│   ├── views/              # Graph, Board, Thread, Inbox
│   ├── components/         # Sidebar, search bar, agent cards, file tree, editor
│   └── lib/                # Sigma.js graph logic, Plate editor config
├── docs/                   # Documentation
├── examples/               # Example vaults, custom rules, workflows
└── pyproject.toml
```

---

## 12. Roadmap

### MVP — "See the Web"

- Scaffold the monorepo (backend, frontend, docs, examples)
- `vault.yaml`, `prime.md`, default folder structure and schemas
- FastAPI server that reads the vault and serves note data as JSON
- React app with dark theme, two-panel layout, top nav
- File explorer (left sidebar): browse, click to view, create, rename, drag-to-move, delete, filter
- Sigma.js graph rendering: nodes from `.md` files, edges from `[[wikilinks]]`
- Force-directed layout with drag, zoom, pan, hover highlight, pin nodes
- Color-coded nodes by type, size scaled by connections
- Live filtering by type, tag, date
- Click a node → right sidebar with rendered markdown, backlinks, frontmatter
- Bidirectional sync between file tree and graph
- Basic keyword search (global + file tree filter)
- Create note modal (sends request to Weaver pipeline, works manually before agents exist)
- Rich editor (Plate) in right sidebar with toolbar and meta fields
- Toast notifications placeholder
- Auto-refresh graph on short interval
- **Goal**: manually write notes, open the UI, see your knowledge graph, browse and edit from the file explorer

### v1 — "Think and Weave"

- Provider-agnostic AI config (OpenAI, Anthropic, xAI, Ollama)
- LanceDB indexing with smart chunking by `##` headers
- Hybrid + graph-aware semantic search in the UI
- File watcher: real-time for small changes, batch on schedule
- Prompt Compiler: centralized optimization pipeline with per-agent templates
- Prompt templates for all agent actions (create, link, summarize, audit, validate)
- Token counting, context pruning, priority ranking, context compression
- Prompt versioning and logging
- Read-Before-Write protocol fully implemented and enforced (including memory.md in chain)
- All five Loom Layer agents: Weaver, Spider, Archivist, Scribe, Sentinel
- Agent folder structure with per-agent config, state, memory.md, and logs
- Agent memory: summarized every N actions (default 20, configurable)
- Hard block on chain failure (soft warning for trusted agents)
- Edit history tracking in frontmatter (who, when, why)
- Global changelog: per-agent-per-day markdown logs
- Board View: agent cards with status, stats, recent actions, activity log
- Loom Council Chat: transparent multi-agent discussion threads
- Captures Inbox view: queue with source badges, preview, process/archive actions
- Researcher and Standup shuttle agents with individual chat interfaces
- Chat history saved per agent + council shared history
- Create note modal routes through Weaver agent
- Toast notifications for agent actions
- `prime.md` immutability enforced (suggestions via chat only)
- **Goal**: Loom is alive — agents process captures, link knowledge, maintain the vault, and you interact with them through the UI

### v2 — "Connect and Grow"

- GitHub integration (commits, issues, PRs → captures)
- Calendar integration (events → daily notes)
- Email integration (IMAP/forwarding → captures)
- Plugin architecture for community integrations
- Custom Shuttle agents (user-defined via config folders)
- Example vaults with demo data
- Full documentation (README, getting started, architecture, contributing guide)
- Cross-platform testing (macOS, Linux, Windows)
- CI/CD with GitHub Actions
- License decision (MIT or Apache 2.0)
- Open source launch
- **Goal**: Loom connects to your real workflow and is ready for the world

### Future

- Multi-file support (images, PDFs, docx, xlsx, csv, code files) via attachments model
- Smart extraction for indexing attachments (text from PDFs/docs, metadata for images)
- Attachment nodes in the graph (secondary nodes linked to parent notes)
- Light theme option
- Team vaults with sync
- Web clipper browser extension
- Mobile companion app
- Obsidian vault import tool
- Additional Shuttle agents (Reviewer, Planner, Digest)
