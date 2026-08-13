# ADR-0017: Agent Shell is the daily product

Status: accepted

Date: 2026-08-12

## Context

Coding agents increase execution capacity and coordination cost. Intent often stays in the user's head while terminals show only execution.

A permanent work tree also consumes attention. It shows many valid items that do not help the current decision.

The separate Tangent UI adds another destination for usage evidence, marks, evals, and reports. This split increases context switching.

## Decision

Agent Shell is the daily product for work with coding agents.

Its main loop is Work, Summary, Plan, Agent, and Next step.

The normal screen shows one work list. The list groups work by Waiting for you, Agents working, and Ready to start.

Selecting work opens one outcome summary. The summary restores project, requested result, progress, Julian's words, and the next action.

Every execution starts from a short plan that the user can read. Exact technical instructions stay behind a disclosure control.

Running work stays quiet. Returned work enters Waiting for you without replacing the current screen.

The terminal opens only after an explicit action. Polling cannot replace the terminal element.

The top bar keeps Summary and Stop agent visible during a live session.

Usage, marks, evals, and reports provide evidence inside Agent Shell. Tangent UI is not the daily work destination.

The existing Node server, vault, tmux bridge, native transcripts, and Git history remain the technical foundation.

## Consequences

- Agent Shell needs durable user-understanding notes and plan preview APIs.
- Attention signals must state only observable facts.
- Ending a run, changing durable knowledge, and completing an outcome remain separate actions.
- The old tree-first shell remains at `/legacy` during migration.
- Existing analysis packages can remain independent and supply data to later Agent Shell views.
- The first visual notebook remains as evidence of the rejected phase dashboard.

## Usability amendment

Julian completed the first unscripted test on 2026-08-12. The phase dashboard failed to restore context and reduced perceived control.

The amended decision removes visible phases, assignment language, split panes, source lists, and duplicate attention surfaces.

The outcome summary uses one reading column. It presents context before controls and keeps the terminal behind Open agent details.

Julian completed a second unscripted test on the same day. The context-first model restored his context and protected his attention.

The second amendment groups each status list by project and outcome hierarchy. It also adds visible outcome creation and completion actions.

`Command+Enter` submits forms that contain substantial text. Recent activity can order project groups, but it cannot define human priority.
