# ADR-0040: Workers only send

Date: 2026-08-27

Status: accepted. Amended on 2026-09-01. Amends the worker verb clauses of ADR-0021, ADR-0023, ADR-0029, ADR-0034, and ADR-0039.

## Context

A worker learned four Tangent verbs from its prompt: `tangent handover`, `tangent goal handover`, `tangent agent send`, and a typed `--report` JSON contract. The prompt also taught `tangent process list`, `tangent document resolve`, and a rationale dossier.

Julian's rule: workers have two interactions with Tangent. They receive the opening prompt from the brain. They send messages to the brain. Nothing else.

The design record for the operating vision (`docs/design/agent-shell-operating-vision/design-record.md`, D5 to D7) records the decision.

## Decision

A worker has one command: `tangent send <organizer-area> "<plain note>"`.

The worker prompt contains the exact organizer Area. The CLI rejects `brain` and all worker send flags.

The server authenticates the worker session. It refuses a different Area or a session name.

The Area send stores the note on the current Assignment. It also stores a durable handover receipt and organizer inbox notice.

The Assignment stays running. The Job revision does not change. The brain accepts the note when it advances the Job.

The CLI sends the caller's tmux session in the request. The server refuses every other mutation from a worker session.

The worker prompt shrinks to the assignment, the done condition, the sources, the working directory, the step instruction, earlier handovers, and the one command. The typed report contract, the `## Brain` section, and the other command instructions are gone.

Hidden compatibility routes still read old typed reports. No prompt or CLI help teaches those routes.

## Consequences

- Plain text from a worker does not set the Assignment to waiting.
- Worker prompts and reminders name the exact organizer Area.
- The brain remains the only actor that advances the Job.
- A review worker states its verdict in the plain note.
