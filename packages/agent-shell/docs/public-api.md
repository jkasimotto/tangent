# @tangent/agent-shell Public API

Public import paths:

- `@tangent/agent-shell`
- `@tangent/agent-shell/cli`
- `@tangent/agent-shell/area-resources`

The first two paths export the CLI runners and help specifications for `send`, `area`, `brain`, `goal`, `document`, `style`, `agent`, `handover`, `process`, `shell`, `study`, and `vault`. They also export the study contract. The third path exports the parser for an Area note's `## Resources` section. The root `tangent service` command reads Area folders through it. Agent Shell exports no other server module.

The root `tangent` command loads this package only when one of these nouns is used. The root package owns `tangent service` (servers and watchers). `tangent process start|stop|restart|close` still reach it for one release with a hint (ADR-0043).

## Command boundary

Every command except `vault commit` and `study` is a thin HTTP client to the Agent Shell gateway. The default URL is `http://127.0.0.1:4321`. `--server` or `TANGENT_SHELL_URL` can select another loopback URL.

`tangent process create` creates and commits an `every:`-only loop note. `tangent process remove` removes and commits one loop note. The list, show, pause, resume, and check commands manage the same process-note identity.

Requests have a response deadline and an operation ID. A failed mutation response warns that the operation can already be durable. A worker send transport failure tells the caller to retry the same command. The server deduplicates that retry and repairs a missing brain notice.

`GET /api/work` returns `agent-shell-work.v3` from the gateway's immutable memory buffer. It contains bounded Area, Goal, Agent, Brain, Process, presentation, and problem rows. It excludes Request bodies, prompt inputs, document indexes, Program rows, and durable histories. The response supports `ETag` and `If-None-Match`. Every `200` and `304` reports the Work identity, gateway and controller boots, publication time, observation time, and freshness state. A valid store never enters controller admission.

Each Process row includes `visibleInWork`. This field is true for a bounded occurrence or a broken definition.

Non-Work screens load their own bounded routes. These include `/api/navigation/search`, `/api/shell/status`, `/api/prompts/inspect`, exact `/api/brains/show`, exact `/api/agents/show`, and Area-scoped Process and Operation reads.

`GET /api/areas/map-world?located=<area>` returns the complete Area structure and the planned eager shards. It includes one world revision.

`GET /api/areas/map-shard?area=<area>&worldRevision=<revision>` returns one deferred shard for that exact world revision.

`POST /api/areas/map-gestures` accepts source-space mutations. Region elements can include compatible `area-placement.v1` intent. The route rejects runtime IDs and commits all affected source shards as one operation.

`GET` and `POST /api/areas/map-view` read or write private `area-map-view.v2` state by world ID. A world response also includes this state when it exists.

`tangent vault commit` writes the vault history directly. `tangent study` starts one local interactive agent directly. No other package command writes vault files or starts a process itself.

## Vault and Area commands

- `tangent area list|show <area>` reads Areas. `show` prints the Repository, Worktree, and Branch the Area sees, each with the Area whose note declares it, and the folder a worker starts in.
- `tangent area create <parent> <name>` creates one nested Area.
- `tangent area recent <area>` reads subtree milestones. `--since` takes a window (`30d`, `12h`, `2w`, `90m`) or an ISO time, and `--query` keeps the milestones whose summary or reference holds any of its words.
- `tangent area audit <area>` writes one detached compatibility audit.
- `tangent area present <area> <file>... [--note <text>] [--withdraw]` lets the exact active Area brain present or withdraw vault Documents from its own Area. It creates no Goal relation.
- `tangent goal create --area <area> --title <text> --done-when <text> ...` creates one Goal and optional Subgoals.
- `tangent job create|show|start|append|advance|stop|replace` controls durable execution. A worker opens in its Assignment `--path`, else in the nearest bound Area Worktree or Repository. Each Attempt records its resolved folder, command, policy source, launch disclosure, conversation, Agent Shell instance, and immutable target.
- `tangent goal show <slug>` prints each attempt's session, cwd, harness, conversation id, resume command, and last context fill (ADR-0042). `--conversations` finds a codex conversation by the attempt's folder and start time.
- `tangent goal list [<area>]` and `tangent goal show <slug>` read Goals. The listing takes `--subtree`, a repeatable `--status`, `--changed-since` with the same window or date, and `--query`. The subtree scent counts what the same filters find in the child Areas and prints the command that reads them.
- `tangent goal depend|undepend` edits advisory prerequisite links.
- `tangent goal own|release` changes the Goal session binding without stealing a live owner. Neither starts an agent.
- `tangent goal done|wont-do` changes Goal state only on Julian's explicit instruction.
- `tangent document comments|resolve` reads or resolves Julian's inline Document comments.
- `tangent style add <file> "<observation>" [--quote <words>] [--tag <tag>]` records one writing-style note. `tangent style list` and `tangent style show <id>` read the corpus. A style note writes no vault file, makes no commit, sends no notice, and never appears in a Document or its comment listing. `POST /api/style-notes` is refused for worker sessions; `GET /api/style-notes` reads the corpus with counts by model, harness, tag, and Area.
- `tangent vault commit <paths...> -m "<verb>: <area> <summary>"` commits only the named vault paths with provenance trailers. A worker session (`@tangent_kind goal`) is refused.

Every request carries the caller's tmux session in the `x-tangent-session` header. The server refuses Goal, Area, Document, brain, and pipeline mutations from worker sessions. Reads stay open (ADR-0040).

Area paths do not grant command permission. Brains, workers, browser actions, stale sessions, and local shells use the same target validation. Caller identity is audit provenance. Live ownership, revisions, queue state, and exact attempts remain enforced.

Each server response comes from one Agent Shell instance identity. `GET /api/health` returns `instanceId`. `GET /api/sessions` returns only sessions owned by that instance.

The live tmux ownership key is `@tangent_agent_shell_instance`. A foreign session cannot be attached, stopped, reconciled, or adopted. A markerless legacy session has the same rule, except an explicit brain resume can claim the exact session whose durable record matches its live brain tags.

## Agent messages

- `tangent agent list` reads live Agent sessions and queued message counts. `agent show <session>` joins one exact session to its durable Attempt or Brain generation.
- `tangent agent stop <session>` fences the current Attempt and immutable target. A Job Agent stop ends that Attempt, returns its Assignment to pending, and leaves its Goal open. `agent resume <session>` creates an unbound resume Agent from historical Attempt identity.
- `tangent send <session|area> <note...>` sends one plain message. A worker may name only the organizing Area recorded on its assignment. The durable Area path survives brain restarts and can be outside the Goal's ancestry. No message words change Goal or assignment state.
- `tangent agent send <session-or-area> <text...>` is an alias of `tangent send` for one release and prints a hint line.

Agent Shell first resolves the target as a live session. It stores the normalized generic message before it wakes or writes to that pane. An exact Area path uses the durable Area brain inbox. A known stale brain session resolves to that same logical inbox. An unknown target returns not found. A missing or inactive brain does not block Area delivery. Queued messages survive controller restarts in first-in, first-out order. A presentation receipt is not proof that the model read the text.

A brain send to a worker uses ordinary durable message semantics and retains composer safety.

Context recovery reads brain records, exact-Area inbox notices, Goal records, and Goal queues without claiming or mutating the session. Current brain context contains every currently unread durable notice with its Area. Managed worker context contains the primary Goal, every co-assigned Goal, queue revision, exact assignment instruction, attempts, reports, prior handovers, and a rebuilt opening prompt. Queue context exposes the durable `extraFiles` order and repeats those Goals in the rebuilt prompt. A prompt-source failure leaves the durable context available with `promptError`. Historical brain context contains that generation's checkpoint but never the current generation's inbox. A live tmux session with no durable binding returns `role: "unassigned"`; a session that is neither durable nor live returns 404.

When passive observation sees a bound running worker back at its shell, reconciliation writes one idempotent exact-Area brain notice. The queue remains running and the tmux session remains alive so another harness can recover in place.

## Brain lifecycle

- `tangent brain status [area]` reads one logical brain and its active attempt.
- `tangent brain stop [area]` stops the exact owned attempt. Without an Area, it uses the current brain session.

Brain stop reads the current attempt ID before it posts the guarded stop operation. A changed, foreign, or legacy attempt is not terminated. The command does not change Goals.

`tangent brain succeed` reuses the current generation's resolved launch after current policy accepts it. It requires changed `## Current` memory and a new ordinary self-sent inbox notice. The successor is staged without authority. Promotion requires the native transcript adapter to prove the complete first user message by SHA-256 and UTF-8 byte count. Agent Shell then moves the logical pointer, marks included notices delivered, and terminates the outgoing immutable target. A changed pointer, note, activity revision, failed receipt, or restart deadline leaves the outgoing generation authoritative; durable recovery retries receipt or retirement. Open Requests remain on the logical Brain.

The server stamps the sender and delivers only into an empty composer. An agent that is still working has one whenever nobody is typing into it, so a message reaches a busy agent and it reads the message at its next turn boundary. A pane the server is already writing to is the exception: an agent session that is booting holds every message until its own opening prompt has arrived. Otherwise, the message stays queued.

## Job execution

Every Goal execution uses one `job.v1` file under `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`. It keeps all numbered runs. Each run owns ordered Assignments, immutable Attempt history, typed reports, optimistic revision, and bounded operation receipts. Readers accept `area-goal-queue.v2` and `agent-pipeline.v1`; the first mutation writes `job.v1` and preserves the old record as run 1. Ambiguous Goal slugs are refused.

- `tangent goal start <slug> --launch <harness[/model[/effort]]>` declares one implementation assignment.
- `tangent goal start <slug> --step <instruction> [--kind <implementation|review>] [--launch ...] [--path ...] ...` declares ordered assignments.
- `tangent goal append <slug> --step <instruction> [--kind <implementation|review>] ...` adds pending assignments without rewriting history. The type defaults to `implementation` and only labels the step.
- `tangent goal create --area <a> --title "<t>" [--done-when "<d>"] --start --path <dir> [--launch <ref>] [--verify] [--instruction "<i>" | --instruction-file <file>]` is the brain's one command to create a Goal and start its worker. Only a live brain may pass `--start`; the server refuses others with 403 before it writes anything. The done condition defaults to the title.
- `tangent goal done <slug> [--note "<text>"]` from a brain on a Goal flagged `verify: yes` sets `verify` (Check it) instead of `done` and keeps the note in `## State`. Julian's own Done closes it.
- `tangent job advance <goal> <assignment>` starts one exact pending Assignment. Normal Job creation, start, append, advance, and replacement require the exact current live organizing Brain. Agent Shell rechecks Area launch policy before each Agent start. A guarded repair path keeps only its existing limited authority. A local user or Brain can stop a Job.

Worker report types are `implementation-result`, `review-result`, `context-risk`, and `failed`. The server validates the report against the assignment kind and queue revision. A worker report never starts another assignment. Missing, malformed, truncated, shell-quoted, and non-object reports fail before queue mutation. A rejected typed report also records no queue result or notice.

An accepted handover adds one `worker-handover-receipt.v1` record to the assignment. It links the worker session, Goal, assignment, report type, queue revisions, queue result, exact destination Area, and inbox notice. The server writes the queue and pending receipt first. It then writes one notice with a stable source ID. If notice storage fails, the command fails and tells the worker to retry unchanged. Reconcile and the retry repair the same notice. A response is successful only after the receipt holds the notice ID.

No worker report closes a Goal (ADR-0041). A passing `review-result` completes the queue; the brain reads the note and runs `tangent goal done`. Free text is a note and never closes or advances a Goal.

For one release, hidden `goal start`, `goal append`, `brain advance`, `goal replace-agent`, `brain handover`, and `agent context` aliases print their canonical replacement and call the same service. Old command HTTP routes are thin adapters. These edges emit `compat.alias.used`. Work has no v1 or v2 compatibility response.

## Area brain

One logical brain belongs to one exact Area. Its record is `~/.tangent/agent-shell/brains/<area>/brain.json` with schema `area-brain.v2`.

The product lifecycle is `active` or `inactive`. Process, waiting, attempt, and recovery values are health or diagnostic detail.

- `tangent brain status [<area>]` shows lifecycle, health, founding message, open Question count, and current session. `tangent brain request` refuses `--kind test`: Julian flags what he checks.
- `tangent brain request ...` creates one durable Question.

Every attempt opens in its Area folder, where the harness reads the AGENTS.md chain, and gets Julian's message as its first message with the waiting inbox notices below it. Agent Shell generates no prompt. Old records keep `checkpoint` and generation `handover` text; nothing writes them (ADR-0041).

Area memory includes exact `Purpose`, `Current`, and `Knowledge`. It includes smaller ancestor `Purpose` and `Knowledge` sections. Selected Documents come only from current source instructions, open Goal relationships, and open Request relationships. Completed Goals and their Documents remain excluded.

## Questions

Every Question accepts a free-text reply in the native exact-Area brain conversation. A Question can also contain one effect from the server allowlist.

The effect allowlist contains only `goal-done`. Each effect has a hashed revision and a durable operation record. The server writes operation intent before execution. Success closes the Question. Failure records the problem and leaves the Question available for retry.

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

Canonical execution routes are `GET /api/jobs/show` and `POST /api/jobs/create|start|append|advance|stop|replace`. Canonical Agent routes are `GET /api/agents`, `GET /api/agents/show`, and `POST /api/agents/stop|resume|send`. Canonical Brain routes are `GET /api/brains/show` and `POST /api/brains/stop|succeed|requests|requests/withdraw`. Every mutation takes `operationId`; Job mutations also take `expectedRun` and `expectedRevision`. Canonical responses say `job`, `assignment`, `attempt`, and `agent`. A stale Job fence returns 409 with the current revision.

`GET /api/goals/detail` returns Goal intent only. `GET /api/jobs/show` returns full selected-run execution history. `GET /api/work` returns only `agent-shell-work.v3`. One Goal row embeds one current execution summary and one selected Assignment. Detail stays behind the exact routes.

- `POST /api/goals/start`: `{ file, steps?, caller?, recovery?, extraFiles? }`. Only a live brain caller starts a worker (ADR-0041). There is no other start route: `POST /api/goals/agent` was deleted on 2026-08-28.
- `POST /api/goals/attempts/resume`: `{ goal, attemptId?, conversationId? }`. A live attempt answers `status: "live"` with its session. A dead attempt answers `status: "resumed"` with a new `resume` session in the attempt's folder and the typed `command`. The harness needs `resume` in `harnesses.md` (ADR-0042).
- `GET /api/goals/detail?goal=<file>[&conversations=1]`: the Goal reader model. Each attempt carries `resume: { live, session, cwd, harness, conversationId, command, contextFill }`. With `conversations=1`, attempts without a recorded id list what the transcript folder holds under `resume.found`.
- `POST /api/goals/handover`: `{ session, text, report?, kind?, idempotencyKey? }`. `kind` is `note`, `done`, or `blocked`. A successful response includes the queue `pipeline` and its worker handover `receipt`.
- `POST /api/agents/send` with `to: "brain"`: `{ to, from, text, kind? }`. The server resolves the worker's Goal queue and its brain. A caller that is not a worker gets 400.
- `POST /api/agents/send` with an Area path: `{ to, from, text, idempotencyKey? }`. The route writes the Area inbox before live delivery. A retry with one key returns one receipt.
- `POST /api/voice?area=<path>` transcribes the audio body. It sends the transcript through the Area message route and returns `{ transcript, delivery }`.
- `POST /api/pipelines/control`: `{ goal, action, step, caller, expectedRevision, idempotencyKey }`.
- `POST /api/pipelines/append`: `{ goal, steps, caller, expectedRevision, idempotencyKey }`.
- `POST /api/brains/start`: `{ area, instruction, choice?: { harness, model?, effort? }, expectedLaunch?, resume? }`.
- `POST /api/brains/requests/answer`: `{ area, id, answer, note?, effectRevision? }`.
- `GET /api/brains/show?area=<path>|session=<name>` reads one enriched brain.
- `GET /api/agents/context?session=<name>` reads `tangent-agent-context.v1` recovery context. It is read-only and does not require an Agent Shell ownership marker.
- `GET /api/sessions` is a runtime diagnostic for existing CLI and recovery consumers. The Work browser does not read it.
- `POST /api/kill/<session>` stops only a session owned by the responding Agent Shell instance. It returns 409 for foreign or legacy sessions.
- `GET /api/goals?area=<path>[&subtree=1]` lists Goals. An exact-Area result also carries `scope`, `childAreas`, `descendantGoals`, and the `subtreeCommand` that reads the rest.
- `GET /api/areas/milestones?area=<path>[&since&limit]` reads material milestones across the Area subtree.
- `GET /api/operations` lists Area Operations with one `mode`, one `state`, and any `problem`.

Mutation routes validate target records, current revisions, idempotency, live ownership, and exact attempts. Caller identity is audit provenance, not permission. Read APIs can carry compatibility aliases. Mutation APIs do not have two meanings.

Brain start resolves `choice` through the harness registry and the Area policy. The choice applies only to the new attempt. Without `choice`, Agent Shell uses the nearest valid Brain launch memory. `expectedLaunch` must equal the selected `harness/model/effort` reference. A live brain is reattached without changing its attempt launch. Raw launch commands are rejected.

## Shell and study

- `tangent shell rebuild` starts a durable build and waits for the gateway boot ID to change. A failed build leaves the current server running.
- Rebuild and shutdown keep all tmux sessions alive. A replacement with the same instance identity can recover its own sessions.
- `tangent study` starts the study partner with the published study contract.
- `tangent study contract` prints that contract.

See ADR-0020 for the CLI boundary, ADR-0032 for the gateway, ADR-0034 for Area brains, and ADR-0036 for process ownership.
