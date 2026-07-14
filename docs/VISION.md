# Loom — Vision & Roadmap

> A self-organizing AI memory system with a multi-agent backbone and a visual knowledge graph.

This is Loom's **north-star design**: subsystems and capabilities that are **planned, not yet built**, framed as future direction / RFC. For what ships today, see [ARCHITECTURE.md](ARCHITECTURE.md).

These sections were moved verbatim out of the architecture document so that document can describe only what exists. Each retains its original 🔭 *planned — not yet built* callout.

## Table of Contents

1. [Layer 6: The Bridge](#layer-6-the-bridge)
2. [Layer 7: The Prompt Compiler](#layer-7-the-prompt-compiler)
3. [File Support](#file-support)
4. [Roadmap: Beyond v1](#roadmap-beyond-v1)

---

## Layer 6: The Bridge

> 🌓 **Partially shipped.** The connector contract is still evolving, but the
> first vertical slice now lives in `backend/bridge/`: a bounded, read-only
> iCalendar adapter with recurrence/timezone support, encrypted private URL,
> Standup context, and idempotent Inbox sync. GitHub, Email, provider-specific
> Calendar OAuth, and community plugins remain design targets.

The Bridge is how Loom connects to the outside world. All integrations follow the same flow: external data lands in `captures/`, and Loom agents process it from there.

### 7.1 Key Decisions

- **v1 integrations** (hardcoded into core): GitHub, Email, Calendar
- **v2**: refactor into a plugin system with a standard interface for community-built integrations (Slack, Notion, web clipper, etc.)

### 7.2 v1 Integrations

**GitHub**: polls repos or uses webhooks. Pulls commits, issues, and PRs as capture notes with metadata (repo, author, labels, timestamp). Weaver files them under the right project.

**Email**: local IMAP listener or forwarding address. Receives emails, parses them into markdown captures with sender, subject, date, and body.

**Calendar**: private iCalendar feeds are shipped. They pull a selected day's
expanded occurrences into Standup context and optionally create Inbox captures
with stable event provenance. Native Google/Outlook OAuth and multi-calendar
selection remain planned.

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

## Layer 7: The Prompt Compiler

> 🔭 **Planned — not yet built.** There is no `backend/compiler/` today. Agents currently assemble prompts directly and call the provider registry (which traces every call — see [ARCHITECTURE.md §3.3](ARCHITECTURE.md#33-provider-tracing)). The optimization pipeline below is the intended evolution, not current behavior.

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

## File Support

> 🔭 **Planned — not yet built.** Loom is markdown-only today. The attachments model below is a future direction.

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

## Roadmap: Beyond v1

These milestones extend the shipped MVP and v1 roadmap (see [ARCHITECTURE.md §12](ARCHITECTURE.md#12-roadmap)).

### v2 — "Connect and Grow"

- GitHub integration (commits, issues, PRs → captures)
- Calendar integration (read-only iCalendar → Standup/Inbox shipped; OAuth adapters remain)
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
