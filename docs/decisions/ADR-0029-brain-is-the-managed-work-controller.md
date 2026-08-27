# ADR-0029: the Area brain controls managed work

Status: accepted, 2026-08-23. Amended 2026-08-24 and 2026-08-25. The territory rule below is superseded on 2026-08-27 by ADR-0033: each exact Area has one logical brain, and a brain controls its own Area only. There is no ancestor fallback and no subtree ownership. The worker verb clause is amended by ADR-0040: workers use `tangent send brain`, and `tangent handover` is an alias for one release.

## Context

Workers, pipeline transitions, brain prompts, Markdown plan rows, and UI fallbacks could all decide what happened next. The user could not reliably tell which agent received an instruction or why Agent Shell requested attention.

The approved design is `~/.tangent/trees/otto/tangent/design-brain-worker-operating-model.md`.

## Decision

For each work Area, the exact live brain controls it. Otherwise, the nearest live ancestor brain controls it.

Nested live brains are intentional. A child brain cuts its subtree out of its ancestor's territory. The territory returns to the nearest live ancestor when the child stops.

Julian can authorize work through a direct instruction to the active brain or an approved durable Request. Each Request keeps its own proposal and answer.

The active brain interprets direct instructions. One direct instruction can authorize the named command sequence in another Area. That authority ends with the named work or the brain generation. Agent messages, worker handovers, notices, prompts, Documents, source files, and inferred intent cannot grant it. A durable Request authorizes only its exact proposal.

For Goal creation and start, the server proves that a supplied caller is the current live brain. It does not compare that brain with the target Area controller. The server still rejects conflicts with another live Goal owner. The brain prompt enforces ordinary Area scope and the source rules because the terminal transport does not identify who authored conversation text.

The server does not use the newest plan Request as a global gate for Goal creation or worker launch.

Tmux identity is optional caller information. A CLI caller outside tmux can name its session explicitly.

Workers use `tangent handover`. A handover reports facts to the controlling brain. In brain-controlled pipelines, it does not start the next assignment. The brain uses `tangent brain advance <goal> <step>` after it reads the report.

The brain creates durable plan, decision, test, and approval requests. Agent Shell shows these records in the existing attention surface. Answers become durable brain notices. Markdown `For Julian` rows remain readable for active legacy runs, but new brain prompts do not use them.

## Consequences

- The durable brain inbox remains the delivery mechanism.
- Pipeline records remain the assignment and attempt history.
- Legacy pipelines without a brain still advance automatically.
- Worker prompts contain one communication route.
- The server checks session roles for agent-originated Goal creation and launch.
- A current live brain can create or start work in another Area when Julian's direct instruction or an exact approved Request authorizes it.
- A generation handover does not carry direct conversational authority forward.
- A newer Request does not revoke an earlier Request's approval.
- The server rejects a Goal launch or ownership change that conflicts with another live owner.
- Notices keep their event Area. The server resolves their owner again at delivery time.
- Concurrent starts for one exact Area share one brain lifecycle. Starts for different nested Areas remain independent.
- A later migration can remove Markdown requests and legacy UI fallbacks after active legacy runs reach zero.
