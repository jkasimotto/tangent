# ADR-0047: Server-authoritative agent state and Area repair crews

Date: 2026-08-28

Status: accepted.

## Context

Tangent showed pane activity as agent state. A static pane did not explain the agent's current purpose or next actor.

A worker could finish after its Area brain stopped. Its report remained durable, but no authorized organizer settled the work.

Starting another permanent brain would create competing owners. Asking Julian to inspect every worker would move runtime repair to him.

## Decision

The Agent Shell server owns one state word for each current attempt and Area brain. Each state includes:

- the time when the state started
- the actor who can change it
- the strongest available evidence
- the useful next route.

Queue records have priority over recovery records. Recovery records have priority over transcript and screen observations.

Tangent reads supported harness transcripts for real progress. It uses harness-specific screen patterns for composers, dialogs, and terminal walls.

Stale observations become `Unknown`. A short observation outage does not create work for Julian.

Tangent can nudge an idle worker once. It can resume a dead harness once and re-arm a missing prompt once.

Each recovery effect has a durable operation identifier, a two-minute lease, and the original tmux target. A retry is idempotent.

When a brain is unavailable, the server can dispatch one temporary repair crew for its exact Area. Dispatch requires live waiting work.

The crew has a 30-minute lease. Each committed command adds ten minutes, up to one hour.

The server permits two crews for one brain stop and three crews across the machine. A blocked result ends retries.

The crew can settle existing Goals, control existing assignments, present results, and send messages. It cannot create work or change Area policy.

A returning brain supersedes the crew under the exact-Area lifecycle lock. The returning brain receives the crew's audited result digest.

Julian sees only decisions, old unknown states, old unhandled reports, and exhausted or blocked repair work. Tangent does not create Request records for runtime state.

## Consequences

- Work and `tangent agent list` use the same server-derived state.
- Repair commands keep brain status authority. A verified Goal still becomes `Check it`.
- Repair records are durable `area-repair.v1` JSON files outside the vault.
- The tmux target and Agent Shell instance fence every automatic recovery effect.
- Unsupported transcript formats remain explicit screen observations or `Unknown` states.
