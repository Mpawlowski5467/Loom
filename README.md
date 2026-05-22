<p align="center">
  <img src="docs/assets/logo.svg" alt="Loom" width="320" />
</p>

<p align="center">
  A local-first AI memory system with a multi-agent backbone and a visual knowledge graph.
</p>

---

Loom is a privacy-respecting knowledge base that runs entirely on your machine. Write notes in markdown, and a system of specialized AI agents will organize, link, and maintain them for you. Everything is visualized as an interactive knowledge graph you can explore, search, and interact with.

### Core Ideas

- Plain markdown files as the source of truth — portable, readable, git-friendly
- Two-tier agent system that processes, links, and audits your knowledge automatically
- Force-directed knowledge graph rendered in WebGL
- Provider-agnostic AI — bring OpenAI, Anthropic, xAI, Ollama, or go fully offline
- A user-owned constitution (prime.md) that every agent must follow
- Full transparency — every agent action is logged with who, when, and why

### The Agent System

Loom uses a two-tier agent architecture. The tiers have distinct responsibilities and a strict boundary between them.

**Loom Layer** — system agents that manage the vault. They run in the background, follow the rules engine, and maintain the integrity of your knowledge.

- **Weaver** — takes raw captures and creates properly formatted, linked notes following your schemas
- **Spider** — scans the vault for connections between notes, adds wikilinks, and grows the knowledge graph organically
- **Archivist** — audits for stale notes, duplicates, missing metadata, and broken links
- **Scribe** — maintains folder summaries, generates daily logs, and creates rollups over time
- **Sentinel** — validates every action from every agent against your constitution and rules

**Shuttle Layer** — task agents that do user-facing work. They produce content into the captures inbox, and Loom Layer agents process it from there.

- **Researcher** — ask a question and it searches your vault (and optionally the web), synthesizes an answer, and saves the findings
- **Standup** — generates a daily summary of what changed across your projects

You can chat with Shuttle agents individually. For the Loom Layer, you talk to the **Loom Council** — all five system agents discuss your question transparently, and you see the full back-and-forth before a final answer.

Every agent follows a mandatory read chain before acting: vault config, constitution, role rules, its own memory, folder context, and related notes. No agent writes anything without reading first.

### Roadmap

**MVP — "See the Web"**
Vault initialization, file explorer, Sigma.js knowledge graph, rich markdown editor, keyword search, and the full dark UI. Manually write notes and watch your graph come to life.

**v1 — "Think and Weave"**
AI-powered indexing and semantic search. All five Loom Layer agents running with the read-before-write protocol. Prompt compiler with optimized templates. Loom Council chat and Shuttle agent chat. Agent memory, changelogs, and full action transparency.

**v2 — "Connect and Grow"**
GitHub, calendar, and email integrations. Plugin architecture for community integrations. Custom user-defined Shuttle agents. Full documentation and open-source launch.

**Future**
Multi-file support (images, PDFs, spreadsheets), light theme, team vaults with sync, web clipper extension, mobile app, Obsidian import.

### Stack

Python / FastAPI / React / Sigma.js / LanceDB / Plate (Slate.js)

### Status

In development. Architecture complete, building toward MVP.

---

### Wireframes

Early sketches of the visual language and view models. These are *wireframes, not the final UI* — the real product renders in ink-blue + brick-red duotone on warm cream paper, with serif typography from the design language.

<p align="center">
  <img src="wireframes/wireframe.png" alt="Visual vocabulary — color split, node types, views overview" width="720" />
</p>

#### Views

<table>
  <tr>
    <td align="center" width="50%">
      <img src="wireframes/graphview.png" alt="Graph view — constellation map" width="100%" /><br />
      <sub><b>Graph</b> — constellation map with type-colored nodes, hub sizing, hover-highlighted neighborhoods</sub>
    </td>
    <td align="center" width="50%">
      <img src="wireframes/orbitview.png" alt="Orbit view — focus-first concentric rings" width="100%" /><br />
      <sub><b>Orbit</b> — focus-first concentric rings around a selected note</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="wireframes/threadview.png" alt="Thread view — markdown reader with edit history and backlinks" width="100%" /><br />
      <sub><b>Thread</b> — serif-led note reader with edit history, backlinks, and local graph</sub>
    </td>
    <td align="center">
      <img src="wireframes/editorview.png" alt="Editor view — split source and rendered preview" width="100%" /><br />
      <sub><b>Editor</b> — split source/preview writing experience with wikilink autocomplete</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="wireframes/inboxview.png" alt="Inbox view — captures with Weaver suggestions" width="100%" /><br />
      <sub><b>Inbox</b> — capture-to-note flow with Weaver suggestions for type, folder, tags, and links</sub>
    </td>
    <td align="center">
      <img src="wireframes/boardview.png" alt="Board view — agent cards and activity log" width="100%" /><br />
      <sub><b>Board</b> — agent presence: cards, round-table, and pulse modes with a live changelog</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="wireframes/councilview.png" alt="Council view — transparent multi-agent chat" width="100%" /><br />
      <sub><b>Council</b> — transparent multi-agent thread where all five Loom Layer agents answer together</sub>
    </td>
    <td align="center">
      <img src="wireframes/pulseview.png" alt="Pulse view — live ECG-style agent vitals" width="100%" /><br />
      <sub><b>Pulse</b> — live ECG-style heartbeats showing each agent's running / queued / idle state</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="wireframes/searchview.png" alt="Search palette — hybrid semantic + keyword find" width="60%" /><br />
      <sub><b>Search</b> — Cmd/Ctrl-K palette with hybrid semantic + keyword scoring across the vault</sub>
    </td>
  </tr>
</table>

---

More documentation coming soon.
