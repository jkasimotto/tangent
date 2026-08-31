# ADR-0055: Separate Goals, Jobs, Agents, and Brains

Status: accepted. Design: `~/.tangent/trees/otto/tangent/design-separate-goals-jobs-agents-and-brains.md`.

## Context

Goal records had accumulated execution queues, live sessions, Attempts, and Brain control. The shared vocabulary obscured which object owned intent, durable execution, a live process, or Area organization.

## Decision

Tangent has four explicit authorities.

- A Goal stores desired intent, relations, Documents, cards, and acceptance state.
- A Job stores one Goal's durable numbered runs. A run owns ordered Assignments, immutable Attempt history, reports, operation receipts, and optimistic revisions. `job.v1` stays at the historical pipeline path. Readers accept both old schemas; the first write converts the complete record without losing history.
- An Agent is one live or historical harness session. Its immutable tmux target and Agent Shell instance fence stop, resume, and replacement operations.
- A Brain is one logical exact-Area organizer with durable generation history and inbox authority.

Canonical commands and HTTP routes use the owning noun. Work v2 sends Goals and Jobs as separate collections and includes a deprecated v1 projection for one release. Hidden CLI aliases and old HTTP adapters call the canonical services and emit compatibility telemetry for the same window.

Brain succession is deliberate. `brain succeed` requires changed `## Current` memory, a new self-sent inbox notice, and a still-allowed inherited launch. Generation N+1 starts staged and has no authority. Agent Shell promotes it only after the native transcript proves the exact complete first user message by byte count and SHA-256, then retires generation N by immutable target. A failed proof leaves generation N authoritative. Restart reconciliation continues the durable receipt or retirement operation.

Structured events contain operation and object identities but never bodies or prompts. Work exposes invariant Problems for crossed Goal, Job, Agent, and Brain authority.

## Consequences

Goal detail is intent-only. Job detail owns complete execution history. Agent stop returns an Assignment to pending without closing its Goal, and Agent resume creates an unbound session. Operators must not roll back past the compatibility foundation after any `job.v1` write. The compatibility aliases, old route adapters, and Work v1 projection are removed together in the next release; old record readers remain.
