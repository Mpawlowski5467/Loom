---
id: thr_b9c0d1
title: Bob Kumar
type: person
tags: [collaborator, backend, ai, agents]
created: 2026-03-02T11:00:00Z
modified: 2026-03-14T17:00:00Z
author: user
source: manual
links:
  - loom-knowledge-graph
  - prompt-engineering
  - home-automation
status: active
history:
  - action: created
    by: user
    at: 2026-03-02T11:00:00Z
    reason: "Added collaborator profile for Bob"
  - action: edited
    by: user
    at: 2026-03-09T10:00:00Z
    reason: "Added details about prompt compiler work"
  - action: edited
    by: user
    at: 2026-03-14T17:00:00Z
    reason: "Updated after standup — agent memory management is next priority"
---

# Bob Kumar

## Role

Backend lead on the [[loom-knowledge-graph]] project. Owns the agent architecture, prompt compiler, and LanceDB integration.

## Background

- 8 years in backend engineering, last 3 focused on LLM application development
- Built production RAG pipelines at a legal tech startup
- Deep expertise in [[prompt-engineering]], token optimization, and agent orchestration
- Contributed to several open-source LLM tooling projects

## Current Focus

- Designing the Prompt Compiler pipeline (template selection, context pruning, compression, token counting)
- Implementing the read-before-write chain that all agents must follow
- Defining the two-tier agent boundary: Loom agents manage the vault, Shuttle agents produce content
- Next up: agent memory.md summarization cadence and strategy

## Side Projects

Helps me think through my [[home-automation]] setup. Recommended the BME680 sensor for air quality monitoring and suggested using MQTT for the sensor mesh network. Has a similar local-first philosophy about IoT.

## Communication Style

Direct and technical. Prefers diagrams and pseudocode over prose. Runs crisp standups — status, blockers, next steps, done in 10 minutes.

## Key Contributions

- Architected the two-tier agent system (Loom Layer + Shuttle Layer)
- Designed the prompt compiler's six-stage pipeline
- Set up the LanceDB schema for hybrid search (semantic + keyword + graph-aware boosting)
- Proposed the changelog system for agent audit trails
