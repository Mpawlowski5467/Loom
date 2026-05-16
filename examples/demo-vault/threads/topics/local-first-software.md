---
id: thr_c0d1e2
title: Local-First Software
type: topic
tags: [local-first, architecture, privacy, crdt]
created: 2026-03-03T14:15:00Z
modified: 2026-03-11T08:30:00Z
author: user
source: manual
links:
  - loom-knowledge-graph
  - home-automation
  - graph-databases
  - alice-chen
status: active
history:
  - action: created
    by: user
    at: 2026-03-03T14:15:00Z
    reason: "Core philosophy note for both Loom and home automation projects"
  - action: edited
    by: user
    at: 2026-03-07T16:00:00Z
    reason: "Added CRDT section after reading the Ink & Switch paper"
  - action: linked
    by: agent:spider
    at: 2026-03-11T08:30:00Z
    reason: "Added connections to home-automation and alice-chen"
---

# Local-First Software

## Definition

Local-first software stores data on the user's device as the primary copy, treating cloud services as optional replicas rather than the source of truth. The user owns their data, the software works offline, and collaboration happens through synchronization rather than centralized servers.

## Key Concepts

- **Ownership**: Your data lives on your machine in open formats. No vendor can revoke access, change pricing, or shut down and take your data with them.
- **Offline-first**: The application must be fully functional without a network connection. Sync happens when connectivity is available.
- **CRDTs (Conflict-free Replicated Data Types)**: Data structures that allow concurrent edits from multiple devices to merge automatically without conflicts. [[alice-chen]] has been exploring Automerge and Yjs for potential use in collaborative vault editing.
- **Open formats**: Prefer plain text, markdown, JSON, SQLite — formats that will be readable in 20 years without special software.
- **End-to-end encryption**: When data does sync to a server, it should be encrypted such that the server operator cannot read it.

## Connections

This philosophy is the bedrock of the [[loom-knowledge-graph]] project. Every design decision in Loom is filtered through the local-first lens: LanceDB instead of Pinecone, markdown files instead of a proprietary database, Sigma.js rendering a local JSON graph instead of querying a cloud API.

The [[home-automation]] project shares this philosophy. Home Assistant runs locally, sensor data stays on the local network, and automations execute without internet access.

[[graph-databases]] are relevant here because most production graph DBs assume a server model. Finding local-first alternatives for graph storage and query is an active challenge.

## The Ink & Switch Principles

From the foundational paper "Local-First Software: You Own Your Data":

1. No spinners — the app works instantly from local data
2. Your work is not trapped on one device
3. The network is optional
4. Seamless collaboration with others
5. The Long Now — your data outlives the application
6. Security and privacy by default
7. You retain ultimate ownership and control

## References

- [Ink & Switch — Local-First Software](https://www.inkandswitch.com/local-first/)
- [Automerge CRDT library](https://automerge.org/)
- [CRDTs: The Hard Parts (Martin Kleppmann)](https://www.youtube.com/watch?v=x7drE24geUw)
