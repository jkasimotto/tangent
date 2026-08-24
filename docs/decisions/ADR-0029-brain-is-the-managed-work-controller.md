# ADR-0029: the Area brain controls managed work

Status: accepted, 2026-08-23. Amended 2026-08-24.

## Context

Workers, pipeline transitions, brain prompts, Markdown plan rows, and UI fallbacks could all decide what happened next. The user could not reliably tell which agent received an instruction or why Agent Shell requested attention.

The approved design is `~/.tangent/trees/otto/tangent/design-brain-worker-operating-model.md`.

## Decision

For each work Area, the exact live brain controls it. Otherwise, the nearest live ancestor brain controls it.

Nested live brains are intentional. A child brain cuts its subtree out of its ancestor's territory. The territory returns to the nearest live ancestor when the child stops.

The brain must create a durable plan request. Agent-originated Goal creation and worker launch require an approved plan. Manual UI actions remain available during migration.

Workers use `tangent handover`. A handover reports facts to the controlling brain. In brain-controlled pipelines, it does not start the next assignment. The brain uses `tangent brain advance <goal> <step>` after it reads the report.

The brain creates durable plan, decision, test, and approval requests. Agent Shell shows these records in the existing attention surface. Answers become durable brain notices. Markdown `For Julian` rows remain readable for active legacy runs, but new brain prompts do not use them.

## Consequences

- The durable brain inbox remains the delivery mechanism.
- Pipeline records remain the assignment and attempt history.
- Legacy pipelines without a brain still advance automatically.
- Worker prompts contain one communication route.
- The server checks session roles for agent-originated Goal creation and launch.
- Notices keep their event Area. The server resolves their owner again at delivery time.
- Concurrent starts for one exact Area share one brain lifecycle. Starts for different nested Areas remain independent.
- A later migration can remove Markdown requests and legacy UI fallbacks after active legacy runs reach zero.
