# ADR-0040: Workers only send

Date: 2026-08-27

Status: accepted. Amends the worker verb clauses of ADR-0021, ADR-0023, ADR-0029, ADR-0034, and ADR-0039.

## Context

A worker learned four Tangent verbs from its prompt: `tangent handover`, `tangent goal handover`, `tangent agent send`, and a typed `--report` JSON contract. The prompt also taught `tangent process list`, `tangent document resolve`, and a rationale dossier.

Julian's rule: workers have two interactions with Tangent. They receive the opening prompt from the brain. They send messages to the brain. Nothing else.

The design record for the operating vision (`docs/design/agent-shell-operating-vision/design-record.md`, D5 to D7) records the decision.

## Decision

A worker has one command: `tangent send brain "<note>" [--done | --blocked | --question]`.

- A plain note is kept on the assignment and written to the brain inbox. The assignment status and the queue revision do not change.
- `--done` marks the assignment complete. The server stores `{ type: "implementation-result", status: "done", summary }`. On a review step it stores a passed `review-result` at the current Goal revision.
- `--blocked` marks the assignment waiting and stores `{ type: "failed", summary }`.
- `--question` marks the assignment waiting and stores `{ type: "question-needed", summary }`.
- The inbox note starts with the flag word: `done: ...`, `blocked: ...`, `question: ...`, or `note: ...`.

`brain` resolves on the server to the brain that controls the caller's Goal. A caller that is not a worker gets `tangent send brain works inside a worker session. Name a session or an Area path.` A session name or an Area path sends through the existing agent message path.

The CLI sends the caller's tmux session in the `x-tangent-session` header. The server refuses every other mutation from a worker session with 403 `workers only send. Use: tangent send brain "<note>"`. One helper, `refuseWorkerMutation`, holds the route list and the text. Reads stay open. `tangent vault commit` is local git, so the CLI refuses it when the session has `@tangent_kind goal`.

The worker prompt shrinks to the assignment, the done condition, the sources, the working directory, the step instruction, earlier handovers, and the one command. The typed report contract, the `## Brain` section, and the other command instructions are gone.

`tangent handover`, `tangent goal handover`, and `tangent agent send` stay for one release. Each prints one hint line first. A typed `--report` on the aliases keeps its old shape, so live workers primed with the old prompt still land.

## Consequences

- The `untyped-evidence` status change is gone. Plain text from a worker no longer sets the assignment to waiting.
- The context reminders name `tangent send brain "<facts>"`.
- `~/.agents/AGENTS.md` keeps the worker section to the one command.
- Slice 3 of the operating vision removes the designated review policy. This ADR changes only the prompt text for review steps.
- The next release removes the three aliases.
