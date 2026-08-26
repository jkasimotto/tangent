# ADR-0035: A brain lends its own harness to the workers it starts

Date: 2026-08-27

Status: accepted

## Context

ADR-0023 gave every assignment its own `{ harness, model, effort }`. A later safety change removed every runtime worker default, so the server refused any assignment that named no harness.

That refusal made the Area brain the default mechanism: it had to type a harness id into every start and append command from memory. It typed the wrong one often. 121 of 634 recorded assignments ran on plain `claude`, including starts in Areas that declare another harness, and the `tangent goal --help` examples named plain `claude` as well.

The Area note holds two independent declarations: a Work launch and a Brain launch. Reading the Work declaration as the worker default is one candidate. Julian settled it the other way: a brain launched as `claude-otto` must run `claude-otto` workers, and the Area Work declaration must not override that at runtime.

## Decision

The calling brain's own resolved launch is the one authority for a worker assignment that names no harness.

`materializeStepLaunches` in `packages/agent-shell/app/server.mjs` fills each such assignment from the proven brain record, then resolves every assignment to its exact command before the queue is written. Start and append both use it, and the mismatch warnings come from the same result.

The loud refusal stays for a caller that is not the exact live brain, and for a brain that was started from an edited command and so has no harness id to lend. Tangent still supplies no harness from a profile, from an Area note, or from a recorded command.

An explicit `--launch` or an edited command always wins. The record stores `launchSource` on the assignment, so an applied default is never inferred later from a record that has changed.

The server discloses the chosen harness before it creates the worker. `discloseAssignmentLaunch` writes the exact launch, command, and source into the queue record and tells the open shells while the assignment is still pending and has no session. The start and append responses carry the same rows, and `tangent goal start` prints them above its `started` line.

`tangent goal start` no longer refuses an omitted `--launch` in the client. The omission reaches the server, which lends the brain's harness or refuses.

## Consequences

An Area whose Brain and Work declarations differ now starts workers on the Brain harness when the brain names none. The Work declaration still seeds the browser picker and the refusal text.

`app/brain-worker-launch-http.test.mjs` pins the rule with both `claude` and `claude-otto` in its registry and an Area that declares plain `claude` for work. It proves the lent harness, the durable pre-launch disclosure, the explicit override with its warning, and both refusals.
