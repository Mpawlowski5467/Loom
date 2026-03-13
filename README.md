```
                                         
  ,,                                     
`7MM                                     
  MM                                     
  MM  ,pW"Wq.   ,pW"Wq.`7MMpMMMb.pMMMb.  
  MM 6W'   `Wb 6W'   `Wb MM    MM    MM  
  MM 8M     M8 8M     M8 MM    MM    MM  
  MM YA.   ,A9 YA.   ,A9 MM    MM    MM  
.JMML.`Ybmd9'   `Ybmd9'.JMML  JMML  JMML.
```

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph.

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



### Stack

Python / FastAPI / React / Sigma.js / LanceDB / Plate (Slate.js)

### Status

In development. Architecture complete, building toward MVP.

---

More documentation coming soon.
