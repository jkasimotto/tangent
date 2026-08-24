# ADR-0030: Area triggers launch bounded unattended agents

Date: 2026-08-24

Status: Accepted

## Context

Area Programs can keep a process running or run a command on demand. Several maintenance tasks instead need a cheap condition checked periodically and an agent launched only when the condition reports work. Agent Shell may be closed, and repeated identical conditions must not create overlapping workers or notification spam.

The removed Threads recurrence feature had a separate definition, registry, and dispatcher. Restoring that product would conflict with ADR-0029's deletion of Threads and duplicate the current Programs model.

## Decision

Add `triggers` to Area-local `.processes.json` manifests. A trigger declares a fixed interval, a probe command, an instructions file, and an optional working directory. Probes return a structured `idle`, `work`, or `attention` result with stable condition keys.

The root-owned `tangent trigger` runtime discovers definitions and stores execution state under `~/.tangent/agent-shell/triggers/`. It allows one sweep and one active worker per trigger, coalesces missed checks, and deduplicates work and attention until an idle result clears the condition. Trigger workers use the Area's inherited agent command in deterministic retained tmux sessions and do not create Goals or require an Area brain.

A single optional per-user LaunchAgent invokes the due sweep every minute. Agent Shell projects triggers beside processes and commands; it is not the scheduler.

## Consequences

- Triggers reuse Area ownership, repository resources, tmux visibility, and the Programs UI.
- Enabling a trigger is prior authorization to run its probe and bounded agent instructions unattended.
- Probe stdout becomes a small compatibility contract.
- The first version supports fixed intervals only. Calendar schedules, native notifications, and event queues require later evidence.
- ADR-0029 still removes Threads and routines; this ADR introduces a narrower Programs lifecycle rather than restoring either product.
