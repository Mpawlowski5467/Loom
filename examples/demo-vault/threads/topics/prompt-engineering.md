---
id: thr_f3a4b5
title: Prompt Engineering
type: topic
tags: [ai, llm, prompts, agents]
created: 2026-03-04T09:45:00Z
modified: 2026-03-14T11:00:00Z
author: user
source: manual
links:
  - loom-knowledge-graph
  - bob-kumar
  - research-vector-embeddings
status: active
history:
  - action: created
    by: user
    at: 2026-03-04T09:45:00Z
    reason: "Documenting prompt engineering patterns for the agent system"
  - action: edited
    by: user
    at: 2026-03-10T15:30:00Z
    reason: "Added compiler pipeline section based on implementation progress"
  - action: edited
    by: agent:scribe
    at: 2026-03-14T11:00:00Z
    reason: "Summarized and tightened the anti-patterns section"
---

# Prompt Engineering

## Definition

Prompt engineering is the practice of designing inputs to large language models that reliably produce desired outputs. In the context of multi-agent systems like [[loom-knowledge-graph]], it extends to designing template systems, context windows, and compilation pipelines that optimize prompt quality automatically.

## Key Concepts

- **System prompts**: Persistent instructions that define an agent's role, capabilities, and constraints. In Loom, each agent (Weaver, Spider, Archivist, Scribe, Sentinel) has a dedicated system prompt template.
- **Few-shot examples**: Including 2-3 examples of desired input/output pairs dramatically improves consistency, especially for structured output like YAML frontmatter generation.
- **Chain of thought**: Asking the model to reason step-by-step before producing a final answer. Critical for complex tasks like deciding which notes to link.
- **Context window management**: With limited token budgets, deciding what context to include is as important as how to phrase the prompt. This is where the Prompt Compiler shines.

## The Prompt Compiler Pipeline

[[bob-kumar]] designed Loom's prompt compiler as a six-stage pipeline:

1. **Template selection**: Pick the right `.md` template from `prompts/<agent>/` based on the task type
2. **Context gathering**: Pull in vault.yaml, prime.md, role rules, memory.md, relevant notes via the read-before-write chain
3. **Pruning**: Remove context that is irrelevant to the current task using semantic similarity scoring against the task description
4. **Ranking**: Order remaining context by relevance so the most important information is closest to the instruction
5. **Compression**: Summarize long context items that exceed a configurable token threshold
6. **Token counting**: Final pass to ensure the assembled prompt fits within the model's context window, truncating lowest-ranked items if needed

## Anti-Patterns

- **Prompt stuffing**: Cramming every piece of context into the prompt without pruning. Leads to lost-in-the-middle effects where the model ignores important information.
- **Vague instructions**: "Make the note better" gives the model no criteria for success. Always specify what "better" means.
- **Ignoring output format**: Without explicit format instructions, models will vary their output structure across calls, breaking downstream parsers.

## Connections

This topic is central to [[loom-knowledge-graph]] since every agent interaction goes through the prompt compiler. The quality of [[research-vector-embeddings]] directly affects the pruning and ranking stages, since those use semantic similarity to decide what context to include.

## References

- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic's Claude Prompt Design](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering)
- Wei et al. — "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models"
