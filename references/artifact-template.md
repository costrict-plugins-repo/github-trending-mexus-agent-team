# Artifact Template

This file is a copy-paste starting point for Mission artifacts. The full rules live in `references/mission-workflow.md` under `## Artifacts`.

Artifacts live at:

```text
agent-team/missions/<mission-name>/artifacts/<YYYY-MM-DD>-<slug>.md
```

Two common shapes are shown below: a research / document artifact, and a RoundTable decision record. Adapt either one — both share the same frontmatter contract.

## Required Frontmatter

Every artifact starts with a YAML block:

```md
---
title: <Short human-readable title>
author: <AgentName>
date: <YYYY-MM-DD>
related: <task-ref, rt-ref, ...>
tags: [<tag>, <tag>]
---
```

- `title`, `author`, `date` are required.
- `author` is the executing Agent's name (e.g. `Marbas`), not `Squad Lead`, unless Squad Lead actually wrote it.
- `date` matches the date in the file name.
- `related` and `tags` are optional. `related` lists task refs or RoundTable refs the artifact descends from.

## Shape 1 — Research / Document

Use this when the task asked for a scan, summary, design memo, or any document deliverable.

```md
---
title: Competitor pricing scan, Q2
author: Marbas
date: <YYYY-MM-DD>
related: <task-ref>
tags: [pricing, research]
---

# Competitor pricing scan, Q2

## Background

<Why this artifact exists. Quote the originating task or RoundTable when relevant.>

## Question

<The concrete question this artifact answers.>

## Findings

<Body. Cite sources where applicable. Tables and lists are encouraged.>

## Conclusion

<The recommendation or summary the reader should take away.>

## Follow-up

- <Open question or downstream task>
```

## Shape 2 — RoundTable Decision Record

Use this when a RoundTable proposal moves into `## Approved` in `roundtable.md`. File name: `<YYYY-MM-DD>-rt-<topic-slug>.md`.

```md
---
title: Decision — <short topic>
author: <AgentName who wrote the record>
date: <YYYY-MM-DD>
related: <rt-ref>
tags: [decision]
---

# Decision — <short topic>

## Context

<What was the question, who asked it, what constraints applied.>

## Options Considered

- <Option A>: <one-line summary>
- <Option B>: <one-line summary>
- <Option C>: <one-line summary>

## Decision

<The option that was accepted, stated plainly.>

## Reasoning

<Why this option won, in two or three sentences.>

## Rejected Options

- <Option B>: <why not>
- <Option C>: <why not>

## Votes

- <AgentName>: approve | reject | abstain — <short reason>

## Follow-up

- <Kanban task ref or "no kanban task needed">
```
