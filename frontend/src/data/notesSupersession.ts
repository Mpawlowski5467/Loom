import type { Note } from "./types";

/**
 * Demo-only seed: a plan that supersedes an older one, plus a related note
 * Spider suggests linking. Fictional placeholder content.
 */
export const supersessionSeed: Note[] = [
  {
    id: "thr_p101",
    title: "Cache plan v1",
    type: "project",
    folder: "projects",
    filename: "cache-plan-v1.md",
    tags: ["infra", "perf"],
    body: `First pass at the read cache: a single-region write-through cache in front of the note index, with a flat 10 minute TTL.

## Targets

- p95 read latency under 200 ms
- Cache hit rate above 70%

Replaced by [[cache-plan-v2]] once multi-region reads became a requirement.`,
    links: ["thr_p102"],
    history: [
      { action: "created", by: "you", at: "2026-04-02T09:00:00Z" },
      {
        action: "superseded",
        by: "agent:archivist",
        at: "2026-05-12T08:30:00Z",
        reason: "replaced by [[cache-plan-v2]]",
      },
    ],
    created: "2026-04-02T09:00:00Z",
    modified: "2026-05-12T08:30:00Z",
    status: "superseded",
    source: "manual",
    extra: {
      superseded_by: "[[cache-plan-v2]]",
      superseded_at: "2026-05-12",
    },
  },
  {
    id: "thr_p102",
    title: "Cache plan v2",
    type: "project",
    folder: "projects",
    filename: "cache-plan-v2.md",
    tags: ["infra", "perf", "multi-region"],
    body: `Second plan for the read cache, now covering two regions. Invalidation is event-based, fanned out by [[Webhooks]], with [[Sentinel]] checking for divergence.

## Targets

- p95 read latency under 120 ms in both regions
- Invalidation lag under 2 s

## Rollout

- [x] Shadow reads in the second region
- [ ] Switch writes to event-based invalidation
- [ ] Retire the flat TTL`,
    links: ["thr_p101", "thr_t005", "thr_a005"],
    history: [
      { action: "created", by: "you", at: "2026-05-10T10:00:00Z" },
      {
        action: "linked",
        by: "agent:spider",
        at: "2026-05-10T10:02:00Z",
        reason: "auto-linked Webhooks",
      },
      { action: "validated", by: "agent:sentinel", at: "2026-05-10T10:02:30Z" },
    ],
    created: "2026-05-10T10:00:00Z",
    modified: "2026-05-14T16:20:00Z",
    status: "active",
    source: "manual",
    author: "you",
    extra: {
      supersedes: "[[cache-plan-v1]]",
      valid_from: "2026-05-10",
      owner: "Platform",
      link_evidence: [
        {
          source_id: "thr_p102",
          target_id: "thr_t101",
          score: 0.68,
          method: "embedding",
          reason: "Both notes set p95 targets.",
          source_excerpt: "p95 read latency under 120 ms in both regions",
          target_excerpt: "Reads get a p95 budget of 120 ms",
          created: "2026-05-14T16:21:00Z",
          agent: "spider",
          state: "suggested",
        },
      ],
    },
  },
  {
    id: "thr_t101",
    title: "Latency budget",
    type: "topic",
    folder: "topics",
    filename: "latency-budget.md",
    tags: ["perf"],
    body: `How the read path spends its time. Reads get a p95 budget of 120 ms: 40 ms for the index lookup, 30 ms for ranking and the rest for rendering.`,
    links: [],
    history: [{ action: "created", by: "you", at: "2026-05-08T12:00:00Z" }],
    created: "2026-05-08T12:00:00Z",
    modified: "2026-05-08T12:00:00Z",
    status: "active",
    source: "manual",
  },
];
