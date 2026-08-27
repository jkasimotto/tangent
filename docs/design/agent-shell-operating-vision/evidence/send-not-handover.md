# send-not-handover: collapse the agent-to-agent verbs (worker handover, brain handover, agent send, notices, reminders) into one "send" concept

## Observed

## Inventory of every agent-to-agent communication verb today

Checkout HEAD is `488cc0b`, which is also the `deployedCommit` the live server on 127.0.0.1:4321 reports (`GET /api/sessions`, `rebuild.targetCommit`), so code and runtime match.

### 1. Worker handover: `tangent handover "<facts>" [--report '<json>'] [--session <name>]` and `tangent goal handover ...`

- Two CLI entry points, one route. `packages/agent-shell/src/cli/commands/handover.ts:9-23` and `packages/agent-shell/src/cli/commands/goal.ts:285-296` both POST `/api/goals/handover` with `{ session, text, report? }`. `packages/agent-shell/test/cli-worker-handover.test.mjs:21-60` pins that both send byte-identical bodies. Spec text: `src/cli/spec.ts:6-15` ("Report this worker's facts to its controlling Area brain; the brain chooses the next action") and `spec.ts:247-256` ("Submit this assignment's facts or tagged result to its authoritative queue and notify the target Area").
- `--continue` is retired. `goal.ts:290` throws "--continue is retired. Submit a typed context-risk report; do not replace this worker from inside its own attempt." The route refuses `body.continue === true` with 400 (`app/pipeline-routes.mjs:28-31`). `app/session-safety.test.mjs:33-36` asserts `server.mjs` contains no `continueWorkerSession`; `app/context-continuation.test.mjs:7-20` asserts the reminder text has no `--continue`. ADR-0028 (`docs/decisions/ADR-0028-worker-context-continuation.md`) still says "Status: accepted" but its swap contract no longer exists in code. Leftovers: `app/context-handover.mjs` (`continuationSessionName`, `continuationSection` still rendered into prompts at `server.mjs:1764,1741`), `app/continuation-record.mjs` (schema `goal-continuation.v1`, 14 files under `~/.tangent/agent-shell/continuations/`, 2 of them with real continuations from 2026-08-23 and 2026-08-26), `swappedAwayNaming` guard (`server.mjs:3050,3144`).
- Route: `app/pipeline-routes.mjs:6,23-44` `POST /api/goals/handover`. Text goes through `operations.normalizeMessage` (refuses >4000 chars, `app/agent-messages.mjs:82-87`). Report must be one JSON object.
- Server: `handoverPipelineStep` (`server.mjs:3041-3056`) finds the queue record whose step or attempt session matches the caller, takes the per-Goal mutation lock (`withGoalQueueMutation`, `server.mjs:3286-3295`); a session that is not in any queue but is a live `kind: "goal"` session is migrated into a queue first (`migrateLiveSoloExecution`, `server.mjs:3126-3131`), so even a solo `--own` session that runs handover gets an `area-goal-queue.v2` record. `handoverPipelineStepUnlocked` (`server.mjs:3058-3136`) handles exact retries by idempotency key (`workerHandoverOperationId`, `server.mjs:2986-2990`: `report:<session>:<sha256>` when the CLI supplies none), late evidence from a replaced attempt (preserved, never advances, `server.mjs:3088-3120`), paused/migration-problem queues (409).
- State change (`completePipelineStep`, `server.mjs:3162-3270` and `submitWorkerReport`, `app/area-brain-domain.mjs:375-420`):
  - `step.handover` text appended, `step.handoverSource = "agent"`.
  - Typed report: allowed types `implementation-result | question-needed | context-risk | failed`, or for a `designatedReview` assignment `review-result | question-needed | context-risk | failed` (`area-brain-domain.mjs:383`). Assignment status becomes `complete`, or `waiting` for question-needed/context-risk/failed/blocked (`:408`). `queue.revision += 1`, idempotency key stored, attempt `result/report/endedAt` set.
  - Untyped text under `area-goal-queue.v2`: stored as `{ type: "untyped-evidence" }`, status `waiting`, revision++ (`server.mjs:3175-3183`).
  - A `review-result` with verdict `passed`, matching `goalRevision`, complete criteria, on a designated review with `completionPolicy: "review-pass"` sets `closeGoal` (`area-brain-domain.mjs:414-420`); the server then runs `cascadeGoalDone` and `vaultCommit` (`server.mjs:3237-3246`): the Goal file in the vault changes.
  - A `worker-handover-receipt.v1` is appended to the assignment (`app/worker-handover-receipt.mjs:17-50`; fields `id` sha256 of goal+assignment+session+key, `queue.{revisionBefore,revisionAfter,result,assignmentStatus,closeGoal}`, `destinationArea`, `notice.{sourceId: "worker-handover:<id>", text, id, recordedAt}`). The receipt is a durable outbox: `settleWorkerHandoverNotice` (`server.mjs:3007-3040`) routes the notice with idempotency `sourceId`, writes the notice id back, and returns 503 "Retry the same handover unchanged" if the notice is not durable. The reconcile pass repairs pending receipts (`server.mjs:4010-4018`).
  - Under v2 the handover never starts the next step: `server.mjs:3258-3262` returns `{ status: "reported", next: { index, session: null } }`. Auto-advance (`startPipelineStep`) only runs for non-v2 records (`:3263-3270`), and all 285 records under `~/.tangent/agent-shell/pipelines/` are `area-goal-queue.v2` (counted), so that path is dead in practice.
- Response line the worker reads (`src/cli/worker-report.ts:28-38`): `reported to <area> brain; queue revision N; notice nM`.
- Record: `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2` (`app/area-brain-domain.mjs:16`, `app/pipeline-record.mjs:15`). Step keys observed in a real record: `id, index, instruction, launch, command, label, launchSource, path, kind, designatedReview, status, session, startedAt, endedAt, handover, handoverSource, attempts, reports, launchDisclosure, handoverReceipts, continueFromAssignmentId`. Counts across the 285 records: 717 steps; reports `implementation-result` 45, `review-result` 18, `untyped-evidence` 13, `question-needed` 1, `context-risk` 0; 13 receipts (receipt cutover is recent); 608 steps with `handoverSource: "agent"`.
- Target: never a session. The report lands in the exact Area inbox (`record.controllerArea === record.area` is enforced, `worker-handover-receipt.mjs:21-22`), and a live brain in that Area gets it queued (`routeBrainNotice`, below).
- How the prompt teaches it: `pipelineStepPrompt` (`server.mjs:1744-1778`) `## When you finish`: "Finish with `tangent handover --report '<json>' "<facts>"`. The JSON type is `implementation-result` ... Free text alone records evidence but cannot advance or close the Goal." and for designated reviews the `review-result` shape with `goalRevision`. Then: "This operation reports to the brain; it does not choose the next agent. If you need a decision, test, correction, fresh context, or another agent, include that fact in the same handover. The brain decides the next action. ... If your context is nearly full, hand over that fact through the same command." `goalPrompt` (`server.mjs:1681-1743`) `## Brain` section (`:1708`): "Stay on the assigned Goal and report through the handover command below."; `:1733` "When the done condition is met, report the proof through the typed handover."; `contextTeachingSentence` (`server.mjs:237-240`): "submit a typed context-risk report with the durable facts. Do not replace yourself. Tangent keeps the report in the Goal queue, and any local caller can start the fresh attempt through that queue." Machine-level `~/.agents/AGENTS.md:36`: "finish by handing facts to the next agent ...: `tangent goal handover "<facts>"`".
- Workflow reminder that names the verb: `reconcileContextHandovers` (`server.mjs:5458-5515`) queues a `kind: "context-reminder"` message with `render()` at the 300k threshold (`CONTEXT_HANDOVER_TOKENS`, `server.mjs:234`): "report your files, checks, unresolved facts, and first next action with: tangent handover "<facts>". Do not replace yourself." Reminder state lives on `step.contextReminders` or the solo continuation record; the entry is in-memory only (ADR-0039: reminders carry live functions and are not persisted).

### 2. Brain handover: `tangent brain handover "<facts>" [--session]`

- CLI `src/cli/commands/brain.ts:89-102` POSTs `/api/brains/handover` `{ session, text }`; a 429 is printed as Tangent's answer, not an error; success prints "handed over; generation N started (<session>); this session ends now". Spec `spec.ts:79-84`: "Hand this brain's facts to a fresh copy of itself: the next generation starts from the plan and these facts, and this session ends."
- Route `app/brain-routes.mjs:24,83-92` → `handoverBrain` (`server.mjs:5066-5075`): 404 unless the caller is `record.session === record.currentAttemptId` of an active brain; then under the Area lifecycle lock `handoverBrainUnlocked` (`server.mjs:5076-5122`):
  1. 409 if `handoverOperation.status` is in `preparing|activating|retiring|incomplete|rolling-back|rollback-incomplete` (`server.mjs:4605-4613`).
  2. Pacing: `brainPacing.judge` (`app/brain-pacing.mjs`, ladder 1,2,5,10,20,30 min by `record.waitingStreak`); an early waiting handover returns 429 with `pacedHandoverText` (`server.mjs:5050-5056`: "These facts were not recorded; run the same handover again when you wake"). What counts as "acted": any successful POST whose body names the session in `session|caller|from` except `/api/brains/handover` itself (`server.mjs:7141-7149`, `actingSession` `:5036-5042`), so a `tangent agent send` by the brain counts as action.
  3. `countWaitingHandover` + `recordHandover` (`app/brain-record.mjs:173-187`): `generation.handover` text, `generation.endedAt`, and `record.checkpoint = { text, createdAt, sourceAttemptId }`.
  4. Writes `record.handoverOperation = { id, controllerBootId, status: "preparing", fromAttemptId, fromGeneration, fromTarget (immutable tmux target), toAttemptId: null, ... }`, then `spawnBrainSession` (`server.mjs:4797-...`): builds `brainPrompt` for the preview generation first (a prompt that cannot be built rolls the handover back), creates the tmux session with `@tangent_brain <area>` and `@tangent_generation <n>`, arms the prompt.
  5. On prompt arrival `settleBrainActivation` (`server.mjs:4756-4795`) marks the unread notices listed in the new generation's first message delivered, moves the operation to `retiring`, and `retireBrainHandoverSource` (`server.mjs:4636-4671`) transfers open Requests to the new generation (`handoverBrainRequests`, `app/brain-requests.mjs:126-133`), terminates the old tmux target through `sessionOwnership.terminate`, forgets pacing, marks `complete`. On failure `rollbackBrainHandover` (`server.mjs:4672-4750`) kills the unready replacement, restores `record.generation/session/currentAttemptId`, and queues "The replacement brain did not become ready. Tangent kept this generation alive." to the old session.
- Record: `~/.tangent/agent-shell/brains/<area>/brain.json`, schema `area-brain.v3` (`app/brain-record.mjs:23`); observed otto/tangent: 324 generations, `status: inactive`, `checkpoint` present, `waitingStreak: 0`, `handoverOperation: null`, generation entry keys `generation, session, resolvedLaunch, startedAt, endedAt, handover, remindedAt, instanceId, deliveryStatus, notices`.
- Target: "fresh copy of me" is derived by the server (`brainSessionName(area, generation)`), never named by the caller.
- How the brain is taught: `brainPrompt` (`server.mjs:4500-4599`) contains no command manual and never names `tangent brain handover`; its `Execution contract` names only `tangent goal append ... --kind review`, and `Asking Julian` names `tangent brain request --help`. `app/brain-command-reference.mjs` (`installedCommandReference`) has no caller in app code (grep; only its own test). The verb reaches a brain through: `~/.agents/AGENTS.md:43`; the 90-minute refresh reminder `server.mjs:5428-5432` ("write the plan status and run tangent brain handover "<facts>""); `wakeFromPaceText` `server.mjs:5276-5279`; `pacedHandoverText`; `tangent brain --help` (`brain.ts:151-167`).

### 3. Generic message: `tangent agent send <session-or-area> "<text>" [--from <session>]`

- CLI `src/cli/commands/agent.ts:68-85` POSTs `/api/agents/send` `{ to, text, from }`; prints `delivered to X`, `queued for <area> (<reason>)`, or `queued for X (<reason>); it will arrive when the composer is empty`. Spec `spec.ts:339-347`: "Send to a live agent or store a durable message for an Area brain".
- Route `app/agent-routes.mjs:8,37-46` → `send` (`server.mjs:6290-6311`): `normalizeMessage` (≤4000 chars), `resolveSession` (exact name or normalized match, `server.mjs:5795-5799`), sender via `commandActor` (`app/command-provenance.mjs:6-19`: live session facts, else a historical brain session keeps its Area, else `unknown sender`). If the target is not live and `areaInboxTarget` resolves it (an exact Area path, or any current or historical brain session name, `command-provenance.mjs:24-39`) → `routeBrainNotice(area, text, { sender })` and the response is `{ status: "queued", target: "area", via: "area"|"brain-session", receipt: notice.id }`. Otherwise `messages.dispatch(live, { durable: true, ... })`.
- Durable record for the session path: `~/.tangent/agent-shell/message-queue.json`, schema `agent-message-queue.v1` (`app/message-queue-store.mjs:4`, entry `{ id, target, from, area, text, banner: true, queuedAt }`), written before any wake (`queueDurably`, `app/message-delivery.mjs:73-97`), removed after presentation settles or the target dies (`:100-105,172-180`). File is absent on disk right now (nothing pending). Audit log for every send/delivery/drop/kept: `~/.tangent/agent-shell-messages.jsonl` (`server.mjs:2113`).
- Delivery: banner `[Message from <from> (<area>)] <text>` stamped by the server (`agent-messages.mjs:34-37`); typed only into a positively identified empty composer, including a working agent's empty composer, never while Tangent has a prompt pending for that pane (`deliveryDecision`, `agent-messages.mjs:56-79`; ADR-0021 amendments). Dead target → `dropped` (at-most-once). Queue limits 100 per target, 1000 total.
- State change: none in any workflow record. Side effects: pacing `noteAction` for the sender (`server.mjs:7149`), and the Area path writes an inbox notice (at-least-once, below).
- Target: exact tmux session name, or the logical Area brain (Area path or stale brain session).
- Teaching: `~/.agents/AGENTS.md:34`; worker prompts do not name it (the `## Brain` section says "report through the handover command below"); `agent.ts:156-170` help.
- Usage in the log (2026-08-16 to 2026-08-27): 1968 `sent`, 1370 `delivered`, 304 `kept` (Area inbox with no live brain: 298 from `tangent`, 6 from agents), 245 `dropped`, 13 `not delivered`, 34 `work mutation`. Of the deliveries: tangent→brain 939, tangent→worker 96, agent→brain 99 (workers reporting status or asking the brain), agent→worker/other 236 (includes brain→worker nudges such as `autodesign-brain-g2` "Status check: you've been idle 10 minutes with no handover", and worker↔worker coordination in otto/tangent).

### 4. Brain inbox notices (server-originated, plus Area-addressed sends)

- `routeBrainNotice(area, text, { idempotencyKey, sender })` (`server.mjs:4230-4262`): `noticeMessage` clips at 4000 chars instead of refusing (`agent-messages.mjs:102-108`); with a sender the banner is baked into the stored text; `recordBrainNotice` appends to `~/.tangent/agent-shell/brains/<area>/inbox.json` (schema `area-brain-inbox.v1`, `app/brain-inbox.mjs:20`, notice `{ id: "n<seq>", text, createdAt, deliveredAt, deliveredTo, deliveredGeneration, sourceId? }`, dedupe by `sourceId`, `brain-inbox.mjs:67-85`); if no brain record or no live brain → log event `kept` and return `addressed: false`; else queue an in-memory entry `{ from: "tangent"|sender, notices: [{area,id}], generation }` for `record.session`. Delivery marks the notice read (`markBrainNoticesDelivered`, `server.mjs:4181-4197`); a failed delivery releases it and `flushBrainNotices` (`server.mjs:4445-4471`) re-queues every unread notice not "on its way" on boot and every 10 s reconcile, as a digest when more than one (`noticeDigest`, `brain-inbox.mjs:147-162`). Only the exact Area's inbox is read (`inboxesForBrain`, `brain-inbox.mjs:124-126`; ADR-0033). A new generation's first prompt lists unread notices (`brainPrompt` "Unread messages", `server.mjs:4569`, capped at 12) and marks them delivered on arrival (`settleBrainActivation`). Notices are in-memory queue entries, not in `message-queue.json` (ADR-0039: "This queue stores only generic tangent agent send messages").
- Observed otto/tangent inbox: `seq: 573`, 207 notices kept, 7 unread; the 7 unread are all `command goal-wont-do committed by local Agent Shell caller` audit lines.
- Notice sources (all `notifyBrain`/`routeBrainNotice` call sites in `server.mjs`): worker handover receipts (`:3007-3040`); Julian/skip completions (`:3223,3238,3246,3252,3256,3261,3266,3269`); `recordCommittedCommand` audit notice for every committed work mutation naming the target Area, including the brain's own `goal-advance` (`:4265-4290`); step idle 10 min (`:4071`, `BRAIN_IDLE_NOTICE_MS`), step at a decision menu or draft 5 min (`:4082`, `BRAIN_WAIT_NOTICE_MS`), step stopped without a handover (`:4095`), worker shell exit (`:4058-4064`), pipeline ended by Julian (`:2983,3392`), Goal session ended without a pipeline (`:2462`); Describe work (`describedWorkNotice`, `:4310-4316`); Journal capture (`deliverJournalToBrain`, `:4435-4444`, which also resumes an inactive brain); explicit Document comment notify `POST /api/document/notify-comments` (`app/document-routes.mjs:11`, `server.mjs:716-723`); Request answered/dismissed/effect failed (`:6155,6178,6134`, text from `brainRequestAnswerNotice`, `app/brain-requests.mjs:226-240`); For Julian verdict, undo, reply (`:5577,5596,5610`); route-journal effect (`:6083`); Operation events (`:6406`); unshown For Julian lines (`:5319`).

### 5. Other server-typed messages (in-memory, no durable record)

- Brain refresh reminder at `TANGENT_BRAIN_REFRESH_MINUTES` (90) (`server.mjs:215,5428-5432`; `generation.remindedAt` is durable).
- Pace wake (`server.mjs:5426-5427`).
- Rollback notice to the kept brain (`server.mjs:4745-4749`).
- A continue-from step prompt typed into an already-live worker session with `banner: false` and label "pipeline step" (`server.mjs:2803-2807`; the only `banner: false` use): a message that is an assignment.
- Desk fallbacks from ADR-0023 are gone: `POST /api/pipelines/control` `action: "send"` → 410 "Send-on was replaced by a typed worker report to the queue controller."; `restart` → 410 (`server.mjs:3363-3364,3395-3397`). Advance is `tangent brain advance <goal> <step>` (`brain.ts:72-83`) → `action: "advance"` (`server.mjs:3341-3362`) which starts the pending assignment.

### 6. Tests and documents that carry the verbs

- Test files naming `/api/goals/handover`: `app/brain-notices.test.mjs`, `app/focus-shell-workflow-http.test.mjs`, `app/pipeline-routes.test.mjs`, `app/work-contract-server-http.test.mjs`, `app/worker-handover-production-path-http.test.mjs`, `test/cli-worker-handover.test.mjs`. Naming `/api/brains/handover`: 7 files incl. `app/brain-pacing.test.mjs`, `app/area-brain-production-path-http.test.mjs`, `app/agent-shell-instance-ownership-http.test.mjs`. Naming `/api/agents/send`: `app/brain-notices.test.mjs:418` (Area path with no live brain), `app/focus-shell-workflow-http.test.mjs`. CLI spec tests: `test/cli-agent-spec.test.mjs`, `test/cli-goal-spec.test.mjs`. Pure: `app/message-delivery.test.mjs` (13 tests incl. durable generic queue), `app/message-queue-store.test.mjs`, `app/agent-messages.test.mjs`, `app/worker-handover-receipt.test.mjs`, `app/context-handover.test.mjs`.
- Browser: `app/public/prompt-bestiary.js:73-80` documents "Worker handover" as a transition from Worker A to Area brain; `goal-card-core.js`, `ask-core.js` read `goal.handover` text.
- ADRs that define the verbs: 0021 (agent messages), 0023 (handover ends a step), 0024 (brain self-handover, inbox), 0028 (worker `--continue`, superseded in code), 0029 ("Workers use `tangent handover`. A handover reports facts to the controlling brain ... The brain uses `tangent brain advance`"), 0034 ("`tangent handover` and `tangent goal handover` use one report parser and one server route"; workers cannot replace themselves), 0039 ("The target remains an exact runtime session. This release does not add a logical recipient"). Design record `docs/design/agent-shell-work-contract/design-record.md:67-75,111,807-811,925` records the current split and decision 46 ("Let `tangent agent send` address an Area brain even when it has no live session").

## Gap

Julian: "I don't think we need the concept of handover and send anymore. We can all just make it send. It's all just agent communication."

What "it's all just communication" already holds today:
- The worker handover under `area-goal-queue.v2` no longer chooses the next agent. `completePipelineStep` returns `reported` with `next.session: null` (`server.mjs:3258-3262`); the prompt says so verbatim ("This operation reports to the brain; it does not choose the next agent", `server.mjs:1776`). Its destination is the exact Area brain inbox, the same place `tangent agent send <area>` writes (`server.mjs:6296-6302` → `routeBrainNotice`). So the worker verb is, in delivery terms, "send to my brain with a typed attachment".
- `tangent agent send` already accepts a logical recipient (Area path, or any past brain session name resolved to its logical Area, `command-provenance.mjs:24-39`), contradicting ADR-0039's "no logical recipient" line, which is stale.
- Worker self-replacement (`--continue`) is gone; the worker just reports `context-risk` and "any local caller" replaces it (`server.mjs:237-240`, `pipeline-routes.mjs:28-31`).

What is not just communication:
1. The worker handover mutates the Goal queue: assignment status (`complete`/`waiting`), `revision++`, attempt result, receipt, and on a passed designated review it closes the Goal in the vault (`area-brain-domain.mjs:408-420`, `server.mjs:3237-3246`). A plain `agent send` from the same worker to the same brain writes only an inbox notice; the 99 agent→brain generic deliveries in the log are status chatter that today correctly leaves the queue untouched.
2. The brain handover is a process transaction, not a message: checkpoint write, two-attempt `handoverOperation` with immutable targets, Request transfer, kill of the old tmux session, rollback, and a 429 pacing refusal that deliberately does not record the text (`server.mjs:5076-5122,4636-4750`). There is no recipient; the server derives the fresh session. Nothing in `send` expresses "end me once my replacement is primed".
3. Two transports with different guarantees: inbox notices are at-least-once (durable, re-swept every 10 s, digested, listed in the next generation's prompt), generic messages are at-most-once (dropped on a dead target, 245 drops logged) and durable only until presentation. Notices are never stored in `message-queue.json`; generic messages never in `inbox.json`.
4. The verbs are taught in eight places with three different names (`tangent handover`, `tangent goal handover`, `tangent brain handover`, `tangent agent send`), and the brain prompt carries none of them: brains learn them from `~/.agents/AGENTS.md` and from server reminders that print the exact old command (`server.mjs:5432`).

Precise gap: there is no single verb with logical recipients (my brain, a session, an Area, a fresh copy of me) under which the state change is a consequence of the payload and recipient rather than of which CLI noun was typed. Closing it requires deciding (a) whether a message to the brain from a worker always touches the queue or only when it carries `--report`, (b) whether the brain's generation swap stays a caller verb at all or becomes a Tangent-owned rotation like the worker model, and (c) whether one durable queue can carry both at-least-once notices and at-most-once session messages.

## Candidates

## Candidate A: one `tangent send <recipient> "<text>" [--report '<json>']` with logical recipients

Mechanism: recipients `brain` (caller's exact Area inbox), `<area-path>`, `<session>`, `me` (fresh copy). Server derives the effect: a worker sending to `brain` with `--report` runs today's `handoverPipelineStep`; without `--report` it writes an `untyped-evidence` report exactly as today's plain handover does; a brain sending to `me` runs `handoverBrainUnlocked`; a worker sending to `me` is refused (ADR-0034, `session-safety.test.mjs:33-36`). One route `POST /api/agents/send` with `{ to, text, from, report? }` dispatching to the three existing operations, or three routes kept behind one CLI.

Touches: `src/cli/commands/{handover,goal,brain,agent}.ts`, `spec.ts` (four specs), `worker-report.ts` result line, `server.mjs` send operation (`:6290-6311`) and pacing exclusion (`:7149`, must key on recipient `me` instead of pathname), prompt text at `server.mjs:237-240,1708,1733,1764-1776,5432,5277,5050-5055,5495-5497`, `~/.agents/AGENTS.md:34,36,43`, `app/public/prompt-bestiary.js`, ADR-0021/0023/0024/0029/0034/0039 (new ADR superseding their verb clauses).

Trade-offs: matches Julian's words most directly. But "state derived from recipient" is false for the worker: the difference between a report and chatter is the payload (`--report`), not the recipient, so every worker message to `brain` either mutates the queue (breaks the 99 status-chatter deliveries, status flips to `waiting`, revision churn, receipts) or the verb needs a payload rule anyway. `me` as a recipient hides the kill semantics and the 429 pacing behind a word that sounds like a plain message (Julian's memory rule: no invented jargon; explain concretely). Text limits differ (`normalizeMessage` refuses >4000, `noticeMessage` clips): must pick one.

Migration: keep `tangent handover`, `tangent goal handover`, `tangent brain handover`, `tangent agent send` as aliases for one release because live workers and 300+-generation brain lineages are primed with the old text; the 90-minute refresh reminder and `wakeFromPaceText` must switch the same commit. Tests: 6 + 7 + 2 HTTP files and 3 CLI spec tests rewrite their command lines; pure modules unchanged.

## Candidate B: keep `handover` as the state verb, unify the transport underneath

Mechanism: leave the three CLI verbs and routes, but make the brain notice path and the generic path one durable queue: `routeBrainNotice` and `flushBrainNotices` append to `message-queue.json` entries carrying `notices: [{area,id}]` and `generation`, with a per-recipient policy field (`atLeastOnce: true` for logical-brain deliveries, false for exact sessions). `message-delivery.mjs` drops its "only generic entries are durable" split (`:13-28,189-192`), reminders stay in memory (they carry `render`).

Touches: `app/message-delivery.mjs`, `app/message-queue-store.mjs` (schema `agent-message-queue.v2` with `notices`, `generation`, `policy`), `server.mjs:2116-2126,4230-4262,4445-4471`, ADR-0039 amendment. No CLI, prompt, or AGENTS.md change.

Trade-offs: does not give Julian one verb; it removes the invisible duplication (two queues, two dedupe sets: `noticesOnTheirWay` and the store) which is the engineering smell behind "it's all just communication". Risk: the sweep-and-release retry model (`holdBrainNotices/releaseBrainNotices`) and the durable-until-settled model must be reconciled so a notice is neither doubled after a restart (`brain-notices.test.mjs:492` "once, and never twice") nor lost.

Migration: trivial at runtime (the store normalizes unknown shapes to empty, `message-queue-store.mjs:27-40`; inboxes remain the source of truth for notices so a v1 file can be discarded).

## Candidate C: one CLI verb, unchanged server contracts

Mechanism: `tangent send` becomes the only noun agents type; the CLI dispatches by recipient and flags to the existing routes: `tangent send brain --report '<json>' "<facts>"` → `/api/goals/handover`; `tangent send checkpoint "<facts>"` (brain only) → `/api/brains/handover`; `tangent send <session|area> "<text>"` → `/api/agents/send`. Server, records, receipts, pacing, and tests of server behaviour stay. The result lines keep saying what happened ("reported to X brain; queue revision N; notice nM", "generation N+1 started; this session ends now").

Touches: `src/cli/commands/*` (new `send.ts`, old nouns become aliases printing a deprecation line), `spec.ts`, `worker-report.ts`, teaching text (same list as A), `AGENTS.md`, `prompt-bestiary.js`, CLI spec tests (`test/cli-*-spec.test.mjs`, `test/cli-worker-handover.test.mjs`), one ADR.

Trade-offs: cheapest way to honour "just make it send" without pretending the effects are the same; `checkpoint` names the brain effect in plain words (the record already calls it `checkpoint`, `brain-record.mjs:185`). Leaves the two transports (B) untouched, and keeps a verb (`checkpoint`) whose real effect is a process swap.

Migration: same alias window as A; server unchanged so mid-run sessions are unaffected.

## Candidate D: no handover verb at all; Tangent rotates brains the way it already replaces workers

Mechanism: extend the ADR-0034 worker rule to brains. A brain never replaces itself; it `tangent send brain "<checkpoint>"` (or the same `--report` shape with `type: "checkpoint"`), which only writes `record.checkpoint` and an inbox notice. Rotation (the existing `handoverOperation` transaction: spawn, prime, retire source) is started by Tangent on its own triggers: context fill from the pane (`parseContextFill` already exists for workers, ADR-0028), the 90-minute refresh, or Julian/any local caller via `POST /api/brains/start { resume: true }` and `tangent goal replace-agent`-style command. Pacing becomes a rotation-side rule (do not rotate an idle brain) instead of a 429 refusal to the model.

Touches: `handoverBrainUnlocked` split into "record checkpoint" (send) and "rotate" (server), `brain-pacing.mjs` judge moves to the rotation trigger, reminder texts `server.mjs:5428-5432,5276-5279,5050-5056` deleted or rewritten, `brain.ts` handover subcommand removed, ADR-0024 self-handover clause and ADR-0033 superseded, 7 HTTP test files that call `/api/brains/handover` rewritten around `/api/brains/start resume` + checkpoint send, `brain-pacing.test.mjs` re-targeted.

Trade-offs: the only candidate where "handover" truly disappears for both roles and where workers and brains follow one rule (report, never replace yourself). It also removes the failure that pacing was built for (a brain that hands over every 50 s, `brain-pacing.mjs:1-6`) at its source, because the model no longer holds the swap lever. Cost: Tangent must decide when a brain's context is spent without the model's judgement; codex has no context pattern in `PANE_SIGNATURES` (ADR-0028), so the 324-generation otto/tangent brain on `codex --model gpt-5.6-sol` (`brain.json` last generation `resolvedLaunch.command`) would rotate only on the timer.

Migration: keep `tangent brain handover` as an alias that writes the checkpoint and requests a rotation (same transaction) for one release; live generations primed with the old reminder keep working.

## Counterexamples

1. A worker message to its brain is not always a report. `tangent agent send <session|area>` from a worker writes an inbox notice or a session message and touches no queue (`server.mjs:6290-6311`); `tangent handover` from the same worker flips the assignment to `waiting`/`complete`, bumps `revision`, appends a receipt, and can commit a Goal `done` to the vault (`server.mjs:3162-3270`, `area-brain-domain.mjs:408-420`). The log shows 99 agent→brain generic deliveries in 11 days that were coordination, not results. A design that keys the effect on the recipient alone either mutates the queue on chatter or silently drops typed closure.

2. The brain handover has a refusal that is not a delivery failure: 429 pacing with "These facts were not recorded" (`server.mjs:5050-5056,5085-5089`), 409 for an unsettled operation, 404 unless the caller is the exact current attempt. `agent send` has only 404/409 (no such or non-agent target) and 429 (queue full). Pacing's "acted" test is keyed on the route path (`server.mjs:7149`); a unified route needs a recipient-based exclusion or every self-checkpoint counts as action and defeats pacing.

3. Delivery guarantees differ by design: notices are re-swept every reconcile until presented (`flushBrainNotices`, `server.mjs:4445-4471`; `brain-notices.test.mjs:344,418,492`), generic messages are dropped when the target dies (`message-delivery.mjs:172-180`; 245 `dropped` events) and settle on presentation. One queue must carry a per-recipient policy or one class regresses.

4. Logical recipient already exists but bypasses the receipt: `tangent agent send <area>` from a worker records a notice with the banner baked in but no `worker-handover-receipt.v1`, no `reports[]` entry, and no revision bump (`server.mjs:6296-6302`), while `tangent handover` promises "reported to X brain; queue revision N; notice nM" (`worker-report.ts:28-38`). Two ways to reach the same inbox with different durability of the same facts.

5. Worker self-replacement is asserted absent: `session-safety.test.mjs:33-36` fails if `server.mjs` mentions `continueWorkerSession`; `pipeline-routes.mjs:28-31` refuses `continue: true`; `context-continuation.test.mjs` refuses `--continue` in reminder text. A `fresh-me` recipient for workers reintroduces what ADR-0034 removed. Meanwhile ADR-0028 still reads "accepted", and `continuationSection` is still rendered from `step.continuations` (`server.mjs:1764`) for the two historical continuations on disk.

6. The inbox is also an audit log, not only a mailbox: `recordCommittedCommand` routes a notice for every committed work mutation to the target Area, including the brain's own `goal-advance` (`server.mjs:4265-4290`); the 7 unread notices in `brains/otto/tangent/inbox.json` are all `goal-wont-do` audit lines with no agent sender. "All communication" would have to include Tangent's audit voice or split it out.

7. A message can be an assignment: the continue-from step prompt is typed into a live worker session as a `banner: false` message with label "pipeline step" and settled by the prompt transport (`server.mjs:2803-2807`, `message-delivery.mjs:46-48`); it also rewrites tmux options and the Goal binding. Unifying "send" must not let this carry the provenance banner or the at-most-once drop.

8. Identity strength differs: `agent send` accepts an unknown `from` and stamps "unknown sender" (`command-provenance.mjs:6-19`); both handovers require the caller to be the exact live step/attempt or the current brain attempt (`server.mjs:3043-3056,5066-5070`). ADR-0021: "Sender identity is only as strong as localhost". A single verb must keep the stronger check for state-changing payloads.

9. The brain prompt carries no command manual (`brainPrompt`, `server.mjs:4500-4599`; `installedCommandReference` is uncalled) and 324 generations of otto/tangent were primed by reminders that print `tangent brain handover "<facts>"` (`server.mjs:5432`). Renaming without keeping the alias and rewriting the reminders in the same commit strands running lineages.

10. Text size: `normalizeMessage` refuses >4000 chars (`agent-messages.mjs:82-87`), used by both `/api/goals/handover` and `/api/agents/send`; `noticeMessage` clips (`:102-108`) and was added precisely because a refused over-long Request answer vanished (`brain-notices.test.mjs:539,649`). One verb must choose refuse-with-error for interactive senders and clip for server-originated text, or workers lose long handovers.

11. `tangent brain advance` is the only way a v2 queue moves (`server.mjs:3341-3362`); the retired desk `send`-on and `restart` return 410 (`:3363-3364,3395-3397`). A `next` recipient has no server meaning any more; a design that revives "send to next" contradicts ADR-0029/0034.

## Unknowns

- The full content of Julian's 2026-08-27 memos beyond the quoted sentence: whether "send" should also cover Tangent's own audit notices and reminders, and whether he wants the brain's generation swap to remain something the brain does. Establish by reading the memo transcript or asking him with Candidate A vs D framed concretely.
- Whether `tangent send` (a new top-level noun) collides with anything in the root CLI dispatcher (`src/cli/index.ts` of the root package was not inspected; only `packages/agent-shell/src/cli/index.ts:1-16` was). Check the root `tangent` entry that lazily imports agent-shell nouns.
- Whether the live server has ever written `message-queue.json` (the file is absent now). ADR-0039's commit `001899d` is in the deployed history, so absence should mean nothing pending; verify by sending one generic message to a live session and checking `~/.tangent/agent-shell/message-queue.json` appears and empties.
- How often workers use `tangent handover` versus `tangent goal handover`: both hit one route and the log does not distinguish; the Usage index (`tangent usage tools query`) could count the typed commands per session.
- Whether any harness-level instruction files (`~/.claude-otto/skills`, per-Area Resources, bound-repo CLAUDE.md files fed by `inheritedInstructionFiles`) teach `tangent agent send` or `handover` to brains beyond `~/.agents/AGENTS.md`; grep of `~/.claude-otto/skills/*/SKILL.md` found nothing, bound repositories were not scanned.
- Whether pane context fill is readable for the codex harness the otto/tangent brain runs on (ADR-0028 says codex has no `context` pattern); Candidate D's fill-based rotation depends on it. Check `PANE_SIGNATURES` in `app/pane-state.mjs` and `fixtures/panes/`.
- The exact set of browser code paths that render `step.handover` text or the word "handover" to Julian (`goal-card-core.js`, `ask-core.js`, `prompt-bestiary.js` were grepped; `shell.js` and the work table were not read).

## Sources

- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 215-242, 340-354, 700-745, 1658-1800, 2100-2130, 2769-2840, 2940-3140, 3160-3275, 3300-3400, 4010-4098, 4095-4300, 4300-4320, 4420-4475, 4500-4600, 4600-4760, 4750-4850, 5036-5130, 5195-5215, 5270-5325, 5415-5520, 6205-6330, 7135-7160)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-inbox.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/message-queue-store.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/message-delivery.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-messages.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/context-handover.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/continuation-record.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/worker-handover-receipt.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/agent-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pipeline-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-command-reference.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-record.mjs (lines 23-60, 143-200)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-requests.mjs (lines 6-32, 126-135, 226-242)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-pacing.mjs (lines 1-60)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs (lines 16, 101-155, 375-420)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/pipeline-record.mjs (grep only)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/command-provenance.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/document-routes.mjs (lines 11, 65-66)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-routes.mjs (lines 8-11, 59-60)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/goal-command.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/prompt-bestiary.js (grep)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/handover.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts (lines 1-30, 282-296, 478-484)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/brain.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/agent.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/worker-report.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/spec.ts (lines 1-20, 52-115, 244-262, 320-364)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/index.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/test/cli-worker-handover.test.mjs (lines 1-60)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-notices.test.mjs (test names, lines 418-470)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/context-continuation.test.mjs (lines 1-20)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/session-safety.test.mjs (lines 33-36)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/message-delivery.test.mjs, message-queue-store.test.mjs, agent-messages.test.mjs, brain-pacing.test.mjs, worker-handover-production-path-http.test.mjs (test names)
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0021-pane-states-and-agent-messages.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0024-area-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0025-brain-writes-what-needs-julian.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0028-worker-context-continuation.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0029-brain-is-the-managed-work-controller.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0030-area-triggers.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0033-area-brain-operating-model.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0034-audited-area-brain-workflow.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0037-brain-attempt-launch-override.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0039-durable-generic-agent-message-queue.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md (grep and lines 60-75, 105-115, 405-415, 465-472, 800-812, 920-930)
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md (line 78)
- /Users/julianotto/.agents/AGENTS.md (lines 34, 36, 43)
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/brain.json
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/inbox.json
- /Users/julianotto/.tangent/agent-shell/brains/otto/tangent/requests.json
- /Users/julianotto/.tangent/agent-shell/pipelines/**/*.json (285 files aggregated; sample neara/portland/evaluate-and-strengthen-the-unified-structure-of-2.json)
- /Users/julianotto/.tangent/agent-shell/continuations/**/*.json (14 files)
- /Users/julianotto/.tangent/agent-shell-messages.jsonl (aggregated 2026-08-16 to 2026-08-27)
- /Users/julianotto/.tangent/agent-shell/message-queue.json (absent)
- http://127.0.0.1:4321/api/sessions (live server metadata)
- git log for handover.ts, context-handover.mjs, message-queue-store.mjs, worker-handover-receipt.mjs, agent.ts, ADR-0028, ADR-0039
