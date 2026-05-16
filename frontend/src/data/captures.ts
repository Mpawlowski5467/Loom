import type { Capture } from "./types";

export const captures: Capture[] = [
  {
    id: "cap_001",
    title: "Sigma 3 nodeReducer interpolation trick",
    folder: "captures",
    body: `From researcher synthesis:

Sigma 3 exposes a \`nodeReducer\` setting that runs per-frame. Mutating display data through the reducer (rather than the graph) means you don't have to round-trip through graphology for animation. Combined with rAF + lerp, you get free tweens.

\`\`\`js
sigma.setSetting('nodeReducer', (id, data) => {
  const p = progress;
  const target = targets.get(id);
  return { ...data, x: lerp(data.x, target.x, p), y: lerp(data.y, target.y, p) };
});
\`\`\`

Useful for orbit ↔ constellation transitions.`,
    receivedAt: "2026-05-16T08:14:00Z",
    status: "pending",
    suggestion: {
      type: "topic",
      destFolder: "topics",
      tags: ["graph", "perf", "sigma"],
      links: ["thr_t003", "thr_p002"],
      title: "Sigma reducer pattern",
    },
  },
  {
    id: "cap_002",
    title: "Cache invalidation in distributed systems",
    folder: "captures",
    body: `Read a piece on the two-generals problem applied to cache invalidation. The TL;DR is that consensus on "the cache is now wrong" is impossible without coordination, and most systems just pick a side and live with eventual consistency.

Worth a longer note. Probably belongs alongside [[Caching]].`,
    receivedAt: "2026-05-15T19:42:00Z",
    status: "processing",
    suggestion: {
      type: "topic",
      destFolder: "topics",
      tags: ["distsys", "infra"],
      links: ["thr_t001"],
      title: "Distributed cache invalidation",
    },
  },
  {
    id: "cap_003",
    title: "Plate 49 wikilink plugin notes",
    folder: "captures",
    body: `Plate 49 uses createPlatePlugin with a node spec. Old createPluginFactory is gone. For wikilinks: { isElement: true, isInline: true, isVoid: true }.

Markdown serializer doesn't ship wikilink support — write a custom rule.`,
    receivedAt: "2026-05-15T16:20:00Z",
    status: "done",
    filedAs: "thr_t002",
  },
  {
    id: "cap_004",
    title: "Standup notes: 2026-05-16",
    folder: "captures",
    body: `Morning rundown from the standup agent:

- 3 PRs open
- 1 incident yesterday — webhook retry storm, see [[Webhook retries]]
- Mira available for design review later`,
    receivedAt: "2026-05-16T07:02:00Z",
    status: "pending",
    suggestion: {
      type: "daily",
      destFolder: "daily",
      tags: [],
      links: ["thr_t006", "thr_pe001"],
      title: "2026-05-16",
    },
  },
  {
    id: "cap_005",
    title: "Random thought on graph layouts",
    folder: "captures",
    body: `What if the graph view defaulted to orbit instead of constellation? The focus-first metaphor matches how I actually navigate — start from a note and explore outward.

Counter: discovery suffers. Constellation surfaces connections you didn't know existed.`,
    receivedAt: "2026-05-14T21:15:00Z",
    status: "pending",
    suggestion: {
      type: "topic",
      destFolder: "topics",
      tags: ["graph", "ux"],
      links: ["thr_t003"],
      title: "Graph default layout debate",
    },
  },
];
