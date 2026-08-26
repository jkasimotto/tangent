# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`

Both paths export the CLI runners and help specifications for `area`, `brain`, `goal`, `idea`, `document`, `agent`, `shell`, `study`, and `vault`. They also export the study contract. Agent Shell does not export its private server modules.

The root `tangent` command loads this package only when one of these nouns is used. The root package owns `tangent process` and `tangent trigger`.

## Command boundary

Every command except `vault commit` and `study` is a thin HTTP client to the Agent Shell gateway. The default URL is `http://127.0.0.1:4321`. `--server` or `TANGENT_SHELL_URL` can select another loopback URL.

Requests have a response deadline and an operation ID. A failed mutation response warns that the operation can already be durable. Callers must inspect current state before retrying.

`tangent vault commit` writes the vault history directly. `tangent study` starts one local interactive agent directly. No other package command writes vault files or starts a process itself.

## Vault and Area commands

- `tangent area list|show <area>` reads Areas.
- `tangent area create <parent> <name>` creates one nested Area.
- `tangent area recent <area>` reads subtree milestones.
- `tangent area audit <area>` writes one detached compatibility audit.
- `tangent goal create --area <area> --title <text> --done-when <text> ...` creates one Goal and optional Subgoals.
- `tangent goal list [<area>]` and `tangent goal show <slug>` read Goals.
- `tangent goal depend|undepend` edits advisory prerequisite links.
- `tangent goal own|release` changes the Goal session binding without stealing a live owner.
- `tangent goal done|wont-do` changes Goal state only on Julian's explicit instruction.
- `tangent idea add|list` writes or reads Area ideas.
- `tangent document comments|resolve` reads or resolves Julian's inline Document comments.
- `tangent vault commit <paths...> -m "<verb>: <area> <summary>"` commits only the named vault paths with provenance trailers.

A supplied brain caller must be the current live brain for the exact target Area. Parent, child, sibling, worker, and stale sessions cannot mutate the target Area.

## Agent messages

- `tangent agent list` reads live agent sessions and queued message counts.
- `tangent agent send <name> <text...>` sends through the server queue.

The server stamps the sender and delivers only into an empty composer. An agent that is still working has one whenever nobody is typing into it, so a message reaches a busy agent and it reads the message at its next turn boundary. Otherwise, the message stays queued.

## Goal queue

Every active Goal execution uses one `area-goal-queue.v2` record under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`. One assignment and many assignments use the same controller. A worker session is one attempt inside an assignment.

- `tangent goal start <slug> --launch <harness[/model[/effort]]>` declares one implementation assignment.
- `tangent goal start <slug> --step <instruction> [--kind <implementation|review>] [--launch ...] [--path ...] ...` declares ordered assignments.
- `tangent goal append <slug> --step <instruction> ...` adds pending assignments without rewriting history.
- `tangent brain advance <goal> <step>` starts one pending assignment after the exact-Area brain reviews the current queue.
- `tangent handover <facts...> --report '<json>'` submits evidence and one tagged worker report.

A Julian start without a caller queues normal work for the exact brain. An exact-Area brain caller can start the declared assignment. A guarded `--recovery` start records `julian-emergency` in the same queue. It requires a pending assignment, no current attempt, and exhausted brain recovery.

Worker report types are `implementation-result`, `review-result`, `question-needed`, `context-risk`, and `failed`. The server validates the report against the assignment kind and queue revision. A worker report never starts another assignment.

Only a designated `review-result` can close routine work. Closure requires the `review-pass` policy, the current Goal revision, passed criteria, and evidence references. Free text never closes a Goal.

Compatibility readers normalize `agent-pipeline.v1` and solo records. New mutations write only `area-goal-queue.v2`.

## Area brain

One logical brain belongs to one exact Area. Its record is `~/.tangent/agent-shell/brains/<area>/brain.json` with schema `area-brain.v2`.

The product lifecycle is `active` or `inactive`. Process, waiting, attempt, and recovery values are health or diagnostic detail.

- `tangent brain handover <facts...>` stores the facts as the current checkpoint before replacement starts.
- `tangent brain status [<area>]` shows lifecycle, health, founding instruction, checkpoint, open Question count, and current session.
- `tangent brain request ...` creates one durable Question.

Every attempt receives the immutable founding instruction. A replacement also receives the latest checkpoint. Structural prompt context has an 8,000-character limit. The checkpoint has a 6,000-character limit with explicit omission data.

Area memory includes exact `Purpose`, `Current`, and `Knowledge`. It includes smaller ancestor `Purpose` and `Knowledge` sections. Selected Documents come only from current source instructions, open Goal relationships, and open Request relationships. Completed Goals and their Documents remain excluded.

## Questions

Every Question accepts a free-text reply in the native exact-Area brain conversation. A Question can also contain one effect from the server allowlist.

The initial effects are `goal-done` and `route-journal`. Each effect has a hashed revision and a durable operation record. The server writes operation intent before execution. Success closes the Question. Failure records the problem and leaves the Question actionable for retry.

Legacy Decide and Test plan lines remain readable during migration. They do not define closure for new Goal queues.

## Operations

Programs project to canonical `operations` and `problems` fields. Compatibility aliases remain for one release.

Each exact Area can have an `operation-event-ledger.v1`. The server records these material edges:

- a new Problem;
- a changed Problem;
- a Problem resolution;
- a successful result from a Program with `report: true`.

Routine healthy polling, starts, stops, and repeated success stay quiet. Event identity includes the Operation, kind, condition, and revision. The event persists before exact-Area inbox delivery.

## Main HTTP shapes

- `POST /api/goals/start`: `{ file, steps?, caller?, recovery?, extraFiles? }`.
- `POST /api/goals/handover`: `{ session, text, report, idempotencyKey? }`.
- `POST /api/pipelines/control`: `{ goal, action, step, caller, expectedRevision, idempotencyKey }`.
- `POST /api/pipelines/append`: `{ goal, steps, caller, expectedRevision, idempotencyKey }`.
- `POST /api/pipelines/edit`: `{ goal, step, caller, expectedRevision, idempotencyKey, ...patch }`.
- `POST /api/brains/start`: `{ area, instruction, choice?, command?, resume? }`.
- `POST /api/brains/handover`: `{ session, text }`.
- `POST /api/brains/requests/answer`: `{ area, id, answer, note?, effectRevision? }`.
- `GET /api/brains/show?area=<path>|session=<name>` reads one enriched brain.
- `GET /api/sessions` reads the complete Work projection.

Mutation routes validate exact Area authority, current revisions, and idempotency where the record supports retries. Read APIs can carry compatibility aliases. Mutation APIs do not have two meanings.

## Shell and study

- `tangent shell rebuild` starts a durable build and waits for the gateway boot ID to change. A failed build leaves the current server running.
- `tangent study` starts the study partner with the published study contract.
- `tangent study contract` prints that contract.

See ADR-0020 for the CLI package boundary, ADR-0032 for the gateway, and ADR-0034 for the current Area-brain workflow.
