# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`

Both paths export the CLI runners and help specifications for `area`, `brain`, `goal`, `idea`, `document`, `agent`, `shell`, `study`, and `vault`. They also export the study contract. Agent Shell does not export its private server modules.

The root `tangent` command loads this package only when one of these nouns is used. The root package owns `tangent process` and `tangent trigger`.

## Command boundary

Every command except `vault commit` and `study` is a thin HTTP client to the Agent Shell gateway. The default URL is `http://127.0.0.1:4321`. `--server` or `TANGENT_SHELL_URL` can select another loopback URL.

Requests have a response deadline and an operation ID. A failed mutation response warns that the operation can already be durable. A worker handover transport failure tells the caller to retry the same command. The server deduplicates that retry and repairs a missing brain notice.

`tangent vault commit` writes the vault history directly. `tangent study` starts one local interactive agent directly. No other package command writes vault files or starts a process itself.

## Vault and Area commands

- `tangent area list|show <area>` reads Areas.
- `tangent area create <parent> <name>` creates one nested Area.
- `tangent area recent <area>` reads subtree milestones. `--since` takes a window (`30d`, `12h`, `2w`, `90m`) or an ISO time, and `--query` keeps the milestones whose summary or reference holds any of its words.
- `tangent area audit <area>` writes one detached compatibility audit.
- `tangent goal create --area <area> --title <text> --done-when <text> ...` creates one Goal and optional Subgoals.
- `tangent goal list [<area>]` and `tangent goal show <slug>` read Goals. The listing takes `--subtree`, a repeatable `--status`, `--changed-since` with the same window or date, and `--query`. The subtree scent counts what the same filters find in the child Areas and prints the command that reads them.
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

The server stamps the sender and delivers only into an empty composer. An agent that is still working has one whenever nobody is typing into it, so a message reaches a busy agent and it reads the message at its next turn boundary. A pane the server is already writing to is the exception: an agent session that is booting holds every message until its own opening prompt has arrived. Otherwise, the message stays queued.

## Goal queue

Every active Goal execution uses one `area-goal-queue.v2` record under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`. One assignment and many assignments use the same controller. A worker session is one attempt inside an assignment.

- `tangent goal start <slug> --launch <harness[/model[/effort]]>` declares one implementation assignment.
- `tangent goal start <slug> --step <instruction> [--kind <implementation|review>] [--launch ...] [--path ...] ...` declares ordered assignments.
- `tangent goal append <slug> --step <instruction> [--kind <implementation|review>] ...` adds pending assignments without rewriting history. The type defaults to `implementation`. A designated review requires `--kind review`; instruction text never infers the type.
- `tangent brain advance <goal> <step>` starts one pending assignment after the exact-Area brain reviews the current queue.
- `tangent handover <facts...> --report '<json>'` and `tangent goal handover <facts...> --report '<json>'` submit through the same route.

A Julian start without a caller queues normal work for the exact brain. An exact-Area brain caller can start the declared assignment. A guarded `--recovery` start records `julian-emergency` in the same queue. It requires a pending assignment, no current attempt, and exhausted brain recovery.

Worker report types are `implementation-result`, `review-result`, `question-needed`, `context-risk`, and `failed`. The server validates the report against the assignment kind and queue revision. A worker report never starts another assignment. Missing, malformed, truncated, shell-quoted, and non-object reports fail before queue mutation. A rejected typed report also records no queue result or notice.

An accepted handover adds one `worker-handover-receipt.v1` record to the assignment. It links the worker session, Goal, assignment, report type, queue revisions, queue result, exact destination Area, and inbox notice. The server writes the queue and pending receipt first. It then writes one notice with a stable source ID. If notice storage fails, the command fails and tells the worker to retry unchanged. Reconcile and the retry repair the same notice. A response is successful only after the receipt holds the notice ID.

Only a designated `review-result` can close routine work. Closure requires the `review-pass` policy, the current Goal revision, passed criteria, and evidence references. Free text becomes `untyped-evidence`. It reaches the exact brain, but the assignment stays `waiting`. Free text never closes or advances a Goal.

Compatibility readers normalize `agent-pipeline.v1` and solo records. New mutations write only `area-goal-queue.v2`.

## Area brain

One logical brain belongs to one exact Area. Its record is `~/.tangent/agent-shell/brains/<area>/brain.json` with schema `area-brain.v2`.

The product lifecycle is `active` or `inactive`. Process, waiting, attempt, and recovery values are health or diagnostic detail.

- `tangent brain handover <facts...>` stores the facts as the current checkpoint before replacement starts.
- `tangent brain status [<area>]` shows lifecycle, health, founding instruction, checkpoint, open Question count, and current session.
- `tangent brain request ...` creates one durable Question.

Every attempt receives the immutable founding instruction. A replacement also receives the latest checkpoint. One 8,000-character budget covers the whole generated prompt: structural context, checkpoint, and provenance. Only the founding instruction sits outside it. The checkpoint takes what the structural sections left, with explicit omission data when it is clipped.

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
- `POST /api/goals/handover`: `{ session, text, report?, idempotencyKey? }`. A successful response includes the queue `pipeline` and its worker handover `receipt`.
- `POST /api/pipelines/control`: `{ goal, action, step, caller, expectedRevision, idempotencyKey }`.
- `POST /api/pipelines/append`: `{ goal, steps, caller, expectedRevision, idempotencyKey }`.
- `POST /api/pipelines/edit`: `{ goal, step, caller, expectedRevision, idempotencyKey, ...patch }`.
- `POST /api/brains/start`: `{ area, instruction, choice?, command?, resume? }`.
- `POST /api/brains/handover`: `{ session, text }`.
- `POST /api/brains/requests/answer`: `{ area, id, answer, note?, effectRevision? }`.
- `GET /api/brains/show?area=<path>|session=<name>` reads one enriched brain.
- `GET /api/sessions` reads the complete Work projection.
- `GET /api/goals?area=<path>[&subtree=1]` lists Goals. An exact-Area result also carries `scope`, `childAreas`, `descendantGoals`, and the `subtreeCommand` that reads the rest.
- `POST /api/areas/journal`: `{ area, text, idempotencyKey, source? }` saves the exact words, commits them with any rollover archive as `files`, and then wakes the exact Area brain. The result `route` says what happened to that brain: `brain-opened`, `brain-resumed`, `brain-started`, `no-brain`, `not-started`, `duplicate`, or `not-committed`. A `not-committed` capture carries `commitError`, records no milestone, and wakes no brain. The surface keeps its text and idempotency key. After Git recovers, the same request commits the existing Journal files before one milestone and one brain delivery. An idempotency key stays used after a rollover moves its entry to an archive, so a retry never saves the same words twice.
- `GET /api/areas/journal?area=<path>` reads the active Journal and its archives in order.
- `GET /api/areas/milestones?area=<path>[&since&limit]` reads material milestones across the Area subtree.
- `GET /api/operations` lists Area Operations with one `mode`, one `state`, and any `problem`.

Mutation routes validate exact Area authority, current revisions, and idempotency where the record supports retries. Read APIs can carry compatibility aliases. Mutation APIs do not have two meanings.

## Shell and study

- `tangent shell rebuild` starts a durable build and waits for the gateway boot ID to change. A failed build leaves the current server running.
- `tangent study` starts the study partner with the published study contract.
- `tangent study contract` prints that contract.

See ADR-0020 for the CLI package boundary, ADR-0032 for the gateway, and ADR-0034 for the current Area-brain workflow.
