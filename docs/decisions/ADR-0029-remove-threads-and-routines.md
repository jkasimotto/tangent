# ADR-0029: Remove Threads and scheduled agents

Date: 2026-08-24

## Decision

Delete `@tangent/threads`, the root `tangent threads` command, and Agent Shell's Daily agent UI. Keep Agent Shell managed processes and one-shot commands.

## Context

Threads tracked a delegated-work portfolio and later became the dispatcher for `recur-*.md` scheduled agents. The machine has no thread or recurrence definitions. Its generated projection stopped changing on 2026-08-14, and both installed launch agents repeatedly failed because their CLI path no longer existed. Agent Shell still exposed creation and controls for scheduled agents even though the dispatcher was not operational.

Keeping the unused package also made every Agent Shell rebuild compile Threads and its Usage dependencies.

## Consequences

- The root build and install smoke suite no longer include `@tangent/threads`.
- Agent Shell Areas expose only managed processes and one-shot commands.
- `recur-*.md`, the Threads sidecar, and scheduler status are no longer Agent Shell product concepts.
- ADR-0016 remains as historical context but is superseded by this decision.
