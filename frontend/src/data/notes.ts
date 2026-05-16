import type { Note } from "./types";

const today = "2026-05-16T09:42:00Z";
const yesterday = "2026-05-15T18:30:00Z";

export const notes: Note[] = [
  {
    id: "thr_t001",
    title: "Caching",
    type: "topic",
    folder: "topics",
    tags: ["infra", "perf"],
    body: `Cache strategies live or die by their **invalidation** story. Everything else — TTLs, eviction policies, write-through vs write-back — is downstream of *when do you know the cache is wrong*.

## Strategies

Three patterns we've used at this scale:

- **Write-through**: every mutation hits cache + store. Safe, slow.
- **Cache-aside**: app reads cache, falls back to [[Webhooks]], writes back on miss. Most common pattern.
- **Stale-while-revalidate**: serve stale, async refresh. Good for read-heavy. See [[Webhook retries]] for the retry story.

## Invalidation

Two hard ones: time-based and event-based. Time-based is easy but wrong. Event-based is right but requires a fan-out story. We use [[Sentinel]] to catch divergence.

## Open questions

- Multi-region invalidation latency budget?
- LanceDB index cache eviction — currently LRU at 256MB, untested at scale.`,
    links: ["thr_t005", "thr_t006", "thr_a005"],
    history: [
      { action: "created", by: "you", at: "2026-04-12T10:00:00Z" },
      { action: "edited", by: "you", at: "2026-04-22T14:15:00Z", reason: "added strategies section" },
      { action: "linked", by: "agent:spider", at: "2026-04-22T14:18:00Z", reason: "auto-linked Webhooks" },
      { action: "validated", by: "agent:sentinel", at: "2026-04-22T14:18:30Z" },
    ],
    created: "2026-04-12T10:00:00Z",
    modified: "2026-04-22T14:18:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t002",
    title: "Wikilinks",
    type: "topic",
    folder: "topics",
    tags: ["editor", "graph"],
    body: `Wikilinks (\`[[Title]]\`) are the lowest-friction way to connect notes. Atomic, no path baggage, resolved at render-time.

## Resolution

Title-keyed lookup. Case-insensitive. Collisions are forbidden — [[Sentinel]] flags duplicate titles on save.

## Why not paths

Paths bake in folder structure. The graph should be navigable independent of where files live. See [[Vault structure]].`,
    links: ["thr_a005", "thr_t009"],
    history: [
      { action: "created", by: "you", at: "2026-04-10T11:00:00Z" },
    ],
    created: "2026-04-10T11:00:00Z",
    modified: "2026-04-10T11:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t003",
    title: "Graph layouts",
    type: "topic",
    folder: "topics",
    tags: ["graph", "ui"],
    body: `## Constellation

Force-directed by default — graphology's ForceAtlas2. Good for "what's connected to what."

## Orbit

Concentric rings keyed on hop-distance from a focus node. Better for "what's *near* this one."

## Strata

Tried time-bands — failed. Notes don't cluster temporally enough to make horizontal stripes informative.`,
    links: ["thr_t001", "thr_p001"],
    history: [
      { action: "created", by: "you", at: "2026-04-15T16:00:00Z" },
    ],
    created: "2026-04-15T16:00:00Z",
    modified: "2026-04-15T16:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t004",
    title: "Agents",
    type: "topic",
    folder: "topics",
    tags: ["arch"],
    body: `Two tiers: **Loom Layer** (vault-internal) and **Shuttle Layer** (task-outbound).

## Loom Layer

- [[Weaver]] — creates notes from captures
- [[Spider]] — auto-links
- [[Archivist]] — folders + cleanup
- [[Scribe]] — summaries
- [[Sentinel]] — validation

## Shuttle Layer

- [[Researcher]] — query + synthesize
- [[Standup]] — daily recap`,
    links: ["thr_a001", "thr_a002", "thr_a003", "thr_a004", "thr_a005", "thr_a006", "thr_a007"],
    history: [
      { action: "created", by: "you", at: "2026-04-08T09:00:00Z" },
    ],
    created: "2026-04-08T09:00:00Z",
    modified: "2026-04-08T09:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t005",
    title: "Webhooks",
    type: "topic",
    folder: "topics",
    tags: ["infra"],
    body: `Webhook delivery semantics. At-least-once is the only sane guarantee.

## Idempotency

Consumers must dedupe by event id. We use a Redis set with 24h TTL.

## See also

- [[Webhook retries]]
- [[Caching]]`,
    links: ["thr_t006", "thr_t001"],
    history: [
      { action: "created", by: "you", at: "2026-03-20T15:00:00Z" },
      { action: "linked", by: "agent:spider", at: "2026-04-22T14:18:00Z" },
    ],
    created: "2026-03-20T15:00:00Z",
    modified: "2026-04-22T14:18:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t006",
    title: "Webhook retries",
    type: "topic",
    folder: "topics",
    tags: ["infra"],
    body: `Exponential backoff with jitter. 1s, 2s, 4s, 8s, ... cap at 60s.

## Dead-letter queue

After 24h we shelf to DLQ and flag for manual replay.`,
    links: ["thr_t005"],
    history: [
      { action: "created", by: "you", at: "2026-03-21T10:00:00Z" },
    ],
    created: "2026-03-21T10:00:00Z",
    modified: "2026-03-21T10:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t007",
    title: "Markdown",
    type: "topic",
    folder: "topics",
    tags: ["editor"],
    body: `Plate (Slate.js) for editing. Custom plugin for [[Wikilinks]]. Front-matter is YAML at top of file.

## Why not CommonMark strict

We need extensions — wikilinks, frontmatter, callouts. CommonMark plus is the practical baseline.`,
    links: ["thr_t002"],
    history: [
      { action: "created", by: "you", at: "2026-04-02T12:00:00Z" },
    ],
    created: "2026-04-02T12:00:00Z",
    modified: "2026-04-02T12:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t008",
    title: "Embeddings",
    type: "topic",
    folder: "topics",
    tags: ["ml"],
    body: `nomic-embed-text via Ollama. 768-dim. Local.

## Chunking

By \`##\` header. Prepend title + tags before embedding so the chunk carries metadata context.`,
    links: ["thr_a005"],
    history: [
      { action: "created", by: "you", at: "2026-04-05T14:00:00Z" },
    ],
    created: "2026-04-05T14:00:00Z",
    modified: "2026-04-05T14:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t009",
    title: "Vault structure",
    type: "topic",
    folder: "topics",
    tags: ["arch"],
    body: `Five core folders (daily, projects, topics, people, captures) + user custom. Configurable via vault.yaml. See [[Loom MVP]] for current scope.`,
    links: ["thr_p001"],
    history: [{ action: "created", by: "you", at: "2026-03-30T11:00:00Z" }],
    created: "2026-03-30T11:00:00Z",
    modified: "2026-03-30T11:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_t010",
    title: "Provider matrix",
    type: "topic",
    folder: "topics",
    tags: ["ml", "ops"],
    body: `OpenAI, Anthropic, xAI, Ollama. Embed and chat models are independent.

Default: Ollama for local-only mode. [[Embeddings]] uses nomic-embed-text.`,
    links: ["thr_t008"],
    history: [{ action: "created", by: "you", at: "2026-04-18T13:00:00Z" }],
    created: "2026-04-18T13:00:00Z",
    modified: "2026-04-18T13:00:00Z",
    status: "active",
    source: "manual",
  },

  // Projects
  {
    id: "thr_p001",
    title: "Loom MVP",
    type: "project",
    folder: "projects",
    tags: ["loom"],
    body: `## Goals

Local-first AI knowledge system. Markdown + agents + graph UI.

## Status

- [x] Backend skeleton
- [x] Frontend skeleton
- [ ] Paper theme port (in progress)
- [ ] Agent integration

## Related

[[Vault structure]], [[Agents]], [[Graph layouts]], [[Caching]].`,
    links: ["thr_t009", "thr_t004", "thr_t003", "thr_t001"],
    history: [
      { action: "created", by: "you", at: "2026-03-01T09:00:00Z" },
      { action: "edited", by: "you", at: "2026-05-10T11:00:00Z", reason: "progress update" },
    ],
    created: "2026-03-01T09:00:00Z",
    modified: "2026-05-10T11:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_p002",
    title: "Sigma migration",
    type: "project",
    folder: "projects",
    tags: ["graph"],
    body: `Migrate from D3 force-graph to Sigma.js 3.x for the graph view. Reasons: WebGL rendering, better label density handling, native zoom/pan.

See [[Graph layouts]].`,
    links: ["thr_t003"],
    history: [{ action: "created", by: "you", at: "2026-04-01T10:00:00Z" }],
    created: "2026-04-01T10:00:00Z",
    modified: "2026-04-01T10:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_p003",
    title: "Vault redesign",
    type: "project",
    folder: "projects",
    tags: ["arch"],
    body: `Rework the vault folder convention. Currently flat per type; considering nested by date for daily.

Blocked on input from [[Mira]].`,
    links: ["thr_pe001"],
    history: [{ action: "created", by: "you", at: "2026-04-20T15:00:00Z" }],
    created: "2026-04-20T15:00:00Z",
    modified: "2026-04-20T15:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_p004",
    title: "Onboarding flow",
    type: "project",
    folder: "projects",
    tags: ["ux"],
    body: `First-run experience. Splash → vault picker → sample notes → agent intro.`,
    links: [],
    history: [{ action: "created", by: "you", at: "2026-05-01T09:00:00Z" }],
    created: "2026-05-01T09:00:00Z",
    modified: "2026-05-01T09:00:00Z",
    status: "active",
    source: "manual",
  },

  // Agents (as notes — referenced by other notes)
  {
    id: "thr_a001",
    title: "Weaver",
    type: "people",
    folder: "agents",
    tags: ["agent", "loom-layer"],
    body: `Creates notes from captures. Reads vault → prime → role → memory → target folder _index → linked notes before writing.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:weaver", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-15T18:30:00Z",
    status: "active",
    source: "agent:weaver",
  },
  {
    id: "thr_a002",
    title: "Spider",
    type: "people",
    folder: "agents",
    tags: ["agent", "loom-layer"],
    body: `Auto-links across the vault. Suggests connections; user confirms.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:spider", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: yesterday,
    status: "active",
    source: "agent:spider",
  },
  {
    id: "thr_a003",
    title: "Archivist",
    type: "people",
    folder: "agents",
    tags: ["agent", "loom-layer"],
    body: `Folder hygiene. Moves notes, archives stale captures, prunes empty folders.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:archivist", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-14T10:00:00Z",
    status: "active",
    source: "agent:archivist",
  },
  {
    id: "thr_a004",
    title: "Scribe",
    type: "people",
    folder: "agents",
    tags: ["agent", "loom-layer"],
    body: `Generates summaries. Runs over notes longer than 800 words or marked \`needs-summary\`.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:scribe", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-12T14:00:00Z",
    status: "active",
    source: "agent:scribe",
  },
  {
    id: "thr_a005",
    title: "Sentinel",
    type: "people",
    folder: "agents",
    tags: ["agent", "loom-layer"],
    body: `Validation. Blocks invalid frontmatter, broken wikilinks, duplicate titles. Logs verdicts to changelog.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:sentinel", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-16T08:00:00Z",
    status: "active",
    source: "agent:sentinel",
  },
  {
    id: "thr_a006",
    title: "Researcher",
    type: "people",
    folder: "agents",
    tags: ["agent", "shuttle-layer"],
    body: `Query + synthesize. Writes results into \`captures/\`. Loom layer files them.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:researcher", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-15T17:00:00Z",
    status: "active",
    source: "agent:researcher",
  },
  {
    id: "thr_a007",
    title: "Standup",
    type: "people",
    folder: "agents",
    tags: ["agent", "shuttle-layer"],
    body: `Daily recap. Pulls calendar + git + slack signals, writes a capture each morning.`,
    links: ["thr_t004"],
    history: [{ action: "created", by: "agent:standup", at: "2026-03-01T00:00:00Z" }],
    created: "2026-03-01T00:00:00Z",
    modified: "2026-05-16T07:00:00Z",
    status: "active",
    source: "agent:standup",
  },

  // People
  {
    id: "thr_pe001",
    title: "Mira",
    type: "people",
    folder: "people",
    tags: ["collab"],
    body: `Design partner. Reviewing [[Vault redesign]].`,
    links: ["thr_p003"],
    history: [{ action: "created", by: "you", at: "2026-03-15T10:00:00Z" }],
    created: "2026-03-15T10:00:00Z",
    modified: "2026-03-15T10:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_pe002",
    title: "Theo",
    type: "people",
    folder: "people",
    tags: ["collab"],
    body: `Backend collab. Owns the Sentinel rule engine.`,
    links: ["thr_a005"],
    history: [{ action: "created", by: "you", at: "2026-03-18T14:00:00Z" }],
    created: "2026-03-18T14:00:00Z",
    modified: "2026-03-18T14:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_pe003",
    title: "Nadia",
    type: "people",
    folder: "people",
    tags: ["collab"],
    body: `Product. Owns the agent UX brief.`,
    links: [],
    history: [{ action: "created", by: "you", at: "2026-03-20T11:00:00Z" }],
    created: "2026-03-20T11:00:00Z",
    modified: "2026-03-20T11:00:00Z",
    status: "active",
    source: "manual",
  },

  // Daily logs
  {
    id: "thr_d001",
    title: "2026-05-16",
    type: "daily",
    folder: "daily",
    tags: [],
    body: `## morning

Reviewing the [[Paper theme]] port plan.

## afternoon

Cache invalidation deep dive — see [[Caching]].`,
    links: ["thr_t001", "thr_c001"],
    history: [{ action: "created", by: "agent:standup", at: "2026-05-16T07:00:00Z" }],
    created: "2026-05-16T07:00:00Z",
    modified: today,
    status: "active",
    source: "agent:standup",
  },
  {
    id: "thr_d002",
    title: "2026-05-15",
    type: "daily",
    folder: "daily",
    tags: [],
    body: `## wins

- [[Sigma migration]] notes structured
- Talked with [[Theo]] about Sentinel verdicts

## blockers

- Plate React 19 compat — resolved with v49`,
    links: ["thr_p002", "thr_pe002"],
    history: [{ action: "created", by: "agent:standup", at: "2026-05-15T07:00:00Z" }],
    created: "2026-05-15T07:00:00Z",
    modified: yesterday,
    status: "active",
    source: "agent:standup",
  },
  {
    id: "thr_d003",
    title: "2026-05-14",
    type: "daily",
    folder: "daily",
    tags: [],
    body: `Quiet day. Refactored captures handling.`,
    links: [],
    history: [{ action: "created", by: "agent:standup", at: "2026-05-14T07:00:00Z" }],
    created: "2026-05-14T07:00:00Z",
    modified: "2026-05-14T07:00:00Z",
    status: "active",
    source: "agent:standup",
  },
  {
    id: "thr_d004",
    title: "2026-05-13",
    type: "daily",
    folder: "daily",
    tags: [],
    body: `[[Researcher]] dumped 3 captures into the inbox. Filed two; one rejected.`,
    links: ["thr_a006"],
    history: [{ action: "created", by: "agent:standup", at: "2026-05-13T07:00:00Z" }],
    created: "2026-05-13T07:00:00Z",
    modified: "2026-05-13T07:00:00Z",
    status: "active",
    source: "agent:standup",
  },
  {
    id: "thr_d005",
    title: "2026-05-12",
    type: "daily",
    folder: "daily",
    tags: [],
    body: `[[Scribe]] summarized [[Caching]] into a 200-word abstract. Useful.`,
    links: ["thr_a004", "thr_t001"],
    history: [{ action: "created", by: "agent:standup", at: "2026-05-12T07:00:00Z" }],
    created: "2026-05-12T07:00:00Z",
    modified: "2026-05-12T07:00:00Z",
    status: "active",
    source: "agent:standup",
  },

  // Captures
  {
    id: "thr_c001",
    title: "Paper theme",
    type: "capture",
    folder: "captures",
    tags: [],
    body: `Notes on the warm-paper aesthetic. Inter + Fraunces + JetBrains Mono. Brick red for user, ink blue for agents.`,
    links: [],
    history: [{ action: "created", by: "you", at: "2026-05-16T09:00:00Z" }],
    created: "2026-05-16T09:00:00Z",
    modified: today,
    status: "active",
    source: "manual",
  },

  // Custom
  {
    id: "thr_cu001",
    title: "Reading list",
    type: "custom",
    folder: "reading",
    tags: ["books"],
    body: `## In progress

- *Designing Data-Intensive Applications*
- *The Pragmatic Programmer* (re-read)

## Queue

- *Mindset*
- *A Philosophy of Software Design*`,
    links: [],
    history: [{ action: "created", by: "you", at: "2026-02-10T20:00:00Z" }],
    created: "2026-02-10T20:00:00Z",
    modified: "2026-04-15T19:00:00Z",
    status: "active",
    source: "manual",
  },
  {
    id: "thr_cu002",
    title: "Workshop ideas",
    type: "custom",
    folder: "scratch",
    tags: [],
    body: `Brainstorm. Mostly junk; occasional gem. See [[Loom MVP]].`,
    links: ["thr_p001"],
    history: [{ action: "created", by: "you", at: "2026-04-25T22:00:00Z" }],
    created: "2026-04-25T22:00:00Z",
    modified: "2026-04-25T22:00:00Z",
    status: "active",
    source: "manual",
  },
];

export function noteById(id: string): Note | undefined {
  return notes.find((n) => n.id === id);
}

export function backlinksFor(id: string): string[] {
  return notes.filter((n) => n.links.includes(id)).map((n) => n.id);
}
