# Getting Started with Loom

Loom is a **local-first AI memory system**. Your notes live as plain Markdown
files on your own machine; a team of AI agents reads, links, and organizes them
on your behalf; and a knowledge graph lets you see how everything connects.
Nothing leaves your computer except the calls you make to your chosen AI
provider.

This guide takes you from zero to a working vault. For how Loom is *built*, see
[ARCHITECTURE.md](ARCHITECTURE.md); to contribute, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 1. Install and run

The fastest path is Docker — one command builds the UI and API into a single
container.

```bash
cp .env.example .env     # optional — add a provider key now, or skip and use onboarding
docker compose up        # first build takes a few minutes
```

Then open **<http://localhost:8000>**.

> The container's port is bound to `127.0.0.1` (this machine only). Loom ships
> **no authentication** — don't expose it to a network without a reverse proxy +
> auth. See [SECURITY.md](../SECURITY.md).

Prefer to run from source? See the **Run from source** section in the
[README](../README.md#run-from-source-for-development).

---

## 2. First-run onboarding

On first launch a four-step wizard appears. You can re-run it any time from
**Settings → About → re-run onboarding**.

1. **Welcome** — a quick orientation. Everything stays on this machine; you bring
   your own AI provider. Click **Begin →**.
2. **Pick a vault** — a vault is a folder that holds all your notes
   (`~/.loom/vaults/<name>`). Keep the default name to start. If a vault with
   that name already exists, you can **adopt** it (keep your notes), **reset** it
   (archive and start fresh), or pick a different name.
3. **Pick a look** — choose a theme. Paper (warm cream) is the default; light and
   dark variants are grouped for you. Hover to preview, click to apply. Change it
   later in **Settings → Appearance**.
4. **Hook up AI providers** — pick where Loom's intelligence comes from (see
   below). You can **Skip for now** and add a provider later — but agents,
   search, and graph linking stay offline until you do.

> **Heads up:** provider API keys are stored *unencrypted* in `config.yaml` on
> this machine. This is intentional for the current release; keep the file
> private.

### Choosing a provider

You can mix and match — your chat provider and your embedding provider can be
different. The **Finish** button unlocks once you've added a provider and a
successful **Test connection** for both chat and embeddings.

| Provider | API key? | Notes |
|----------|----------|-------|
| **Ollama (local)** | **No key** | Runs entirely on your machine — the free option. Install [Ollama](https://ollama.com), then `ollama pull llama3`. Host defaults to `http://localhost:11434`. |
| **OpenAI** | Yes | Defaults: chat `gpt-4o-mini`, embed `text-embedding-3-small`. |
| **Anthropic** | Yes | Defaults: chat `claude-sonnet-4-6`. Chat only. |
| **xAI** | Yes | Defaults: chat `grok-2-latest`. Chat only. |
| **OpenRouter** | Yes | One key, many models. Default chat `openai/gpt-4o-mini`. |

**No budget? Use Ollama** — it needs no key and runs locally. If you skip
providers entirely, Loom still opens and you can read/write notes by hand;
search falls back to keyword matching and the agents stay idle.

---

## 3. The big idea: capture → note → graph

Loom's core loop is **capture, then triage, then connect**:

1. **Something arrives as a capture** — a raw scrap in your Inbox. You create it
   yourself, an agent produces it, or you drop a `.md` file into
   `~/.loom/vaults/<name>/threads/captures/`.
2. **You triage it in the Inbox** — Loom's **Weaver** agent reads the capture and
   proposes how to file it (a type, a folder, a title, tags, and links to related
   notes). You accept, edit, or skip.
3. **It becomes a connected note** — once filed, **Spider** links it to related
   notes and **Sentinel** validates it. The note shows up in your graph, wired to
   its neighbors.

You don't have to use captures — you can also create finished notes directly
(below). But the capture flow is where Loom's agents earn their keep.

---

## 4. The four views

Loom has four main views, switched from the top nav: **Graph**, **Board**, and
**Inbox**, with a **Thread** reader that slides in when you open a note.

### Graph — see your knowledge

An interactive map of your vault. Nodes are notes (colored by type: project,
topic, people, daily, capture, custom); edges are `[[wikilinks]]`.

- **Pan** by dragging, **zoom** by scrolling, **hover** to highlight a node and
  its neighbors, **click** a node to open it in the Thread reader.
- Two layouts: **constellation** (force-directed, everything in view) and
  **orbit** (focus a node and let the camera circle it).
- **Filter** by type with the toolbar buttons; tune labels, sizes, spacing, and
  motion (breathing, edge "travelers") from the **⚙ display** panel — settings
  persist locally.
- **Export** the current view as PNG, SVG, or JSON.

Empty vault? You'll see *"Your graph is empty — capture a note to start
weaving."*

### Inbox — triage captures

Where raw captures become notes.

- The left panel lists pending captures with a search box and bulk
  **Process** / **Skip** actions.
- Select a capture to see its content and **Weaver's suggestion** on the right:
  the proposed type, folder, title, tags, and links.
- **Accept** files it (and triggers Spider + Sentinel), **Edit** lets you tweak
  the suggestion first, **Skip** discards it.
- Keyboard: **j/k** to move between captures, **e** to edit, **Enter** to accept.

### Board — watch (and run) the agents

A live view of Loom's agent activity.

- **Loom Layer** cards (Weaver, Spider, Archivist, Scribe, Sentinel) manage your
  vault. Each card shows run counts and its last action; **Run** triggers it.
- **Shuttle Layer** is where your **custom agents** live. Click **Add agent** to
  define one (name, role, icon, and a system prompt). Running a custom agent
  gathers vault context, calls your chat provider with that prompt, and writes a
  capture to your Inbox for triage.
- **Recent activity** is a timeline of every agent action, with Sentinel's
  verdict (✓ / ⚠ / ✕).
- Toggle to **pulse** mode for a heartbeat-style view of agent activity.
- The right side hosts the **Loom Council** chat (below).

### Thread — read and edit a note

Opens when you click a note in the graph, the file tree, or search.

- Read rendered Markdown with clickable `[[wikilinks]]`.
- Click **✎ edit** for a split source/preview editor; **Cmd/Ctrl+S** saves.
- **details** shows edit history, backlinks, and tags; **context** shows a 1-hop
  local graph, the heading outline, and related notes.
- The trash icon **archives** the note (it moves to `threads/.archive/` — Loom
  never hard-deletes).

---

## 5. Creating notes directly

Press **Cmd/Ctrl+N** anywhere to open the **new note** modal: give it a title,
pick a type (topic / project / person / daily / capture) and folder, add optional
comma-separated tags, and **Create note**. Weaver files it through the
read-before-write chain and opens it in the editor, ready to type.

---

## 6. Searching

Press **Cmd/Ctrl+K** for the search palette. Type a query and Loom runs **hybrid
search** — semantic (vector) + keyword + graph-aware boosting (it falls back to
keyword-only if you haven't configured an embedding provider).

- **Arrow keys** to move through results, **Enter** to open a note.
- **Alt+Enter** to *reveal in graph* — the camera flies to that node.

---

## 7. Talking to the Council

The **Loom Council** chat (on the Board view) lets you address all five Loom
agents at once. Ask about your vault ("what projects mention deployment?"),
request actions, or ask for a summary. The agents respond in a transparent,
streamed thread — and each reply has a **raw call** link that opens the exact
provider request/response, so nothing is a black box.

For one-on-one work, the Shuttle agents (Researcher, Standup) have their own
1:1 chats.

---

## 8. Where your data lives

Everything is plain files under `~/.loom/`:

```
~/.loom/
├── config.yaml                  # global config + provider keys (plaintext)
└── vaults/<name>/
    └── threads/
        ├── topics/  projects/  people/  daily/   # your notes, by type
        ├── captures/                              # the Inbox
        └── .archive/                              # archived ("deleted") notes
```

Notes are Markdown with YAML frontmatter and `[[wikilinks]]`. You can edit them
in any editor — Loom's file watcher picks up changes and re-indexes them. To back
up or move your knowledge, copy the folder.

### Try the demo vault

```bash
cp -r examples/demo-vault ~/.loom/vaults/demo
```

Then switch to it by re-running onboarding with `demo` as the vault name (or
`PUT /api/vaults/active` with `{"name": "demo"}`).

---

## Next steps

- **Contributing or running tests?** → [CONTRIBUTING.md](../CONTRIBUTING.md)
- **How it all works under the hood?** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **Security & deployment boundaries?** → [SECURITY.md](../SECURITY.md)
