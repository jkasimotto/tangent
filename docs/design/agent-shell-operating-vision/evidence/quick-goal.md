# quick-goal: choose Area, choose harness, let it rip, tell the brain when done

## Observed

## 1. Creating a Goal today

### CLI: `tangent goal create`
- Spec (`packages/agent-shell/src/cli/spec.ts:147-158`): options `--area` (required), `--title` (required), `--done-when` (required), `--description`, `--source` (repeatable), `--subgoal-title`/`--subgoal-done-when`, `--own`, `--session`.
- Implementation (`packages/agent-shell/src/cli/commands/goal.ts:59-95`): `requireArea` does a server lookup, then `requiredString(args.title, ...)` and `requiredString(args["done-when"], ...)` (lines 61-63) throw before any request. Posts to `POST /api/goals/create` with `{ area, description, goal: { title, doneWhen, state: "Not started." }, subgoals, sources, caller?, own? }`. Prints `goal: <vault file>` and, with `--own`, `owned by <session>`. It prints the file, not the slug.
- `--own` (ADR-0022, `docs/decisions/ADR-0022-goal-ownership-and-shared-sessions.md:18`): binds the calling tmux session as owner (`status: active`, `session:`) so the caller does the work itself. It is a self-ownership path, not a worker spawn.

### HTTP: `POST /api/goals/create` and `POST /api/goals/new`
- Route table `packages/agent-shell/app/work-mutation-routes.mjs:8-9`: `POST /api/goals/new` -> `createSimple`, `POST /api/goals/create` -> `create`.
- `create` (`packages/agent-shell/app/server.mjs:6981-7009`): 404 `no area "<area>"`; 400 `the Goal needs a name and a done condition` when title or doneWhen empty; 409 when `caller` and `own` differ; 404 when `own` names no tmux session. Calls `createGoalSet`, then for `own` writes the binding (`writeGoalBinding(created.file, { status: "active", session: own })`) and `adoptGoalSession`. Ends with `recordCommittedCommand({ operation: "goal-create", ... })`.
- `createSimple` (`server.mjs:6966-6979`): 400 `a title is required` / `a Goal needs a done condition`. Same `createGoalSet` + `recordCommittedCommand`.
- `createGoalSet` (`server.mjs:1329-1351`): allocates slug, writes `<area>/goal-<slug>.md`, adds the Goal to the Area note (`addGoalToArea`), `git add`, `vaultCommit(... "add: <area> goal <slug> from Agent Shell")`. Returns `{ file, files }`.
- `recordCommittedCommand` (`server.mjs:4275-4299`) logs a `work mutation` event and calls `routeBrainNotice(targetArea, "Goal <slug>: command goal-create committed by <origin>.")`, so every create already writes a durable inbox notice for the Area brain, live or not.

### Browser: Work `a` = New Goal
- Command registry `packages/agent-shell/app/public/work-commands.js:16`: `{ id: "newGoal", keyDisplay: "a", scope: "area", label: "New Goal", help: "Create a Goal in this Area, then choose its agent." }`.
- Form `packages/agent-shell/app/public/goal-launch-view.js:38-76` (`renderCreate`): kicker "New goal", fields Area (select, required), Name (required), "Done looks like" (textarea, required), "Starting point" (optional). Buttons: `Create and choose agent ⌘↵` (submit), `Create only` (submit, `data-create-only`), Cancel. Form note: "You review the Area default, harness, model, and effort before anything starts."
- Submit handler `packages/agent-shell/app/public/shell-event-bindings.js:2004-2032`: client-side guard `Choose an Area, add a name, and state what done looks like.`; posts `POST /api/goals/new { area, title, doneWhen, state }`; then `refresh()`, `selectGoal(created.file)`, and when not `data-create-only` clicks the Goal row's `[data-launch-for="<file>"]` button, which opens the Launch Editor. Toast: "The Goal is ready. Review its agent before starting." So the browser's fast path is create, then a second surface, then Start.
- Go To (`packages/agent-shell/app/public/go-to-core.js:24`) names the create view "New work"; no Go To row creates and starts.

## 2. Starting a worker today

### CLI: `tangent goal start`
- Spec (`spec.ts:218-231`): description says "Tangent never picks a harness, so every agent you start names its own --launch." Options `--step`, `--launch <harness[/model[/effort]]>` ("Required harness ... or exactly one for a Goal started without --step"), `--path`, `--continue-from`, `--kind implementation|review`, `--recovery`, `--session`.
- Implementation (`goal.ts:113-136`): `requireGoal(server, slug)` (slug lookup), `caller = --session || currentTmuxSession()`. Solo form posts `POST /api/goals/start { file, approved: true, launch: true, choice?: {harness, model?, effort?}, recovery, caller? }`; pipeline form posts `{ file, steps, recovery, caller? }`. `soloLaunch` (`goal.ts:143-147`): "An omitted launch reaches the server, which lends the calling brain's own harness or refuses. The client never picks a harness itself." `printLaunches` prints `launch: step N runs <ref> (your brain's harness)` rows before `started <slug> in <session>`.
- Help examples (`goal.ts:432-447`) show `tangent goal start connect-chosen-ramp-faces --launch codex/sol/low`.

### HTTP: `POST /api/goals/start`
- Route `packages/agent-shell/app/launch-routes.mjs:12` -> `operations.start` (`server.mjs:6755-6788`).
- `start`: 404 `no goal file <file>`; `callingBrain = await liveCallingBrain(caller)` (`server.mjs:5045-5048`, null for empty caller); `recovery: true` goes to `recoverQueuedGoal` (needs an existing open queue whose brain exhausted recovery, `area-brain-domain.mjs:366-372`). Without `steps`, the server builds one step: `{ instruction: "Implement this Goal and submit a typed implementation result.", launch: body.choice | command: chosen.command, kind: "implementation" }` (`server.mjs:6771-6778`), where `launchCatalog.requested(body)` (`launch-catalog.mjs:104-113`) returns `{ command: "", label: "" }` when neither `command` nor `choice` is present. Then `startPipeline(file, { steps, attemptKind: "managed", brain: callingBrain, extraFiles })` and `recordCommittedCommand({ operation: "goal-start", ... })`.
- `startPipeline` (`server.mjs:2872-2905`): 409 `goal is <done|dropped|parked>`; 409 `this Goal already has an authoritative queue` when an unfinished queue exists; 409 `goal is owned by live session <name>`; then `materializeStepLaunches`, `resolveStepPaths`, `validateSteps`, `newPipeline(...)`, `writePipeline`, `startPipelineStep(record, 1)`.
- `materializeStepLaunches` (`server.mjs:2712-2748`, ADR-0035): `fallback = brainWorkerLaunch(brain)` (`server.mjs:2698-2702`, the calling brain's `resolvedLaunch.ref`, null for a non-brain caller or an edited-command brain). Steps that name no launch and have a fallback get `launchSource: "brain-default"`. Then `missingStepLaunches` (`server.mjs:2652-2662`) returns 400 with text: `step 1 has no --launch. Every step names its own harness.\nPass --launch <harness[/model[/effort]]> for each step.\n<area> declares the work default <ref>.\nRun \`tangent harness list --area <area>\` for the valid ids.` (`launchHelpLines`, `server.mjs:2636-2640`). Comment at 2708-2710: "A worker, stale brain, browser, or local shell must name the launch. Tangent still supplies no harness from a profile or from a recorded command." Mismatch warnings compare an explicit launch against `fallback?.harness ?? areaHarnessId(area)` (2740-2746).
- Test pin: `packages/agent-shell/app/brain-worker-launch-http.test.mjs:293-299`: a `POST /api/goals/start` with `steps: [{ instruction: "Start this by hand." }]` and no caller gets `400` matching `/step 1 has no --launch/`.
- `spawnGoalSession` (`server.mjs:2269`) has its own 409 for a direct call with no command: `goal <slug>: this start named no harness. Pass --launch <harness[/model[/effort]]>.` (`server.mjs:2312-2314`); this is the path `POST /api/goals/agent` (collaborate, `launch-routes.mjs:11`, `server.mjs:6750-6754`) hits.
- `startPipelineStep` (`server.mjs:2769-2870`): resolves the launch to an exact command (`resolveStepLaunch`, 2605-2610), `discloseAssignmentLaunch` writes `launchDisclosure { launch, source, label, command, assignmentStatus, session, disclosedAt }` into the queue record before any session exists (2750-2767), names the tmux session `<areaLeaf>--<slug>[-sN]` (`pipelineStepSessionName`, 2598-2602), spawns via `spawnGoalSession` with `pipelineStepPrompt`, records an attempt `{ id, kind: "managed", session, instanceId, target, resolvedLaunch, startedAt }`, sets `record.currentAssignmentId`, bumps `revision`.
- Queue record: `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2` (all 285 records on disk carry this schema).

### Browser start
- Launch Editor start (`packages/agent-shell/app/public/shell-coordinator.js:536-560`): `post("/api/goals/start", { file: targetFile, steps })` with no `caller`, so the server never lends a brain harness to a browser start. Each step comes from `launchStepRequest` (`goal-launch-view.js:382-398`): explicit `command`, else the chosen `launch`, else the Area default preset from `/api/launch/options` (`options.default`), else nothing. So the browser itself applies the Area Work default silently on the wire; the editor shows it first.
- `launchFieldsForArea` (`goal-launch-view.js:216-233`) does the same for the solo `launchOpenSession` path (`shell-coordinator.js:709-731`, `approved: true, launch: true, ...fields`).
- The Launch Editor instruction placeholder says "What this agent does (optional for one assignment)" (`goal-launch-view.js:615`); a single row with no instruction goes through the solo path and the server's default instruction text.
- Work-contract design (`docs/design/agent-shell-work-contract/design-record.md:537`): Enter on a startable Goal opens the launch editor; `c` chooses the agent; `o` reads. Decision 15 (line 359): "Use the same launch catalog picker for brains and workers. Seed it from the Area default and allow a one-attempt harness, model, or effort override."

### `tangent goal append`
- `goal.ts:180-200`: fetches the queue revision, posts `POST /api/pipelines/append { goal, steps, expectedRevision, idempotencyKey, caller? }` (`pipeline-routes.mjs:8`, server op `appendPipelineSteps` at `server.mjs:3406`). Same `materializeStepLaunches` rule with `firstIndex` (ADR-0035). `--kind review` is the only way to create a designated review (`spec.ts:242`).

### Launch resolution and Area declarations
- Registry: `~/.tangent/trees/harnesses.md`, fenced block `tangent.harnesses.v1` (`launch-environment.mjs:22-49`). Observed harness ids: `claude`, `claude-otto`, `codex`, `codex-gw`, `claude-gw`, `opencode`, `pi-code`, `agy`, `agyd`; model sets and effort sets as listed in that file. `resolveLaunch` (`launch-environment.mjs:106-131`) joins `harness.command + model.args + effort.args` and never substitutes.
- Area note block `tangent.environment.v1` with `defaults.launch` (Work) and `defaults.brain` (Brain, or the string `"work"`) (`launch-environment.mjs:52-60`, `updateEnvironmentDefault` 186-208, `inheritedLaunch` 236-248 walks `areaAncestors`, nearest wins, no machine fallback).
- Observed declarations: `~/.tangent/trees/otto/otto.md:26-40` work `codex/sol/low`, brain `codex/luna/low`; `~/.tangent/trees/otto/tangent/tangent.md:247-261` brain `codex/sol/low`, work `claude-otto/opus-5/medium`; `~/.tangent/trees/neara/neara.md:41-53` work `pi-code/glm-5-2/medium`, brain `claude/sonnet-5/medium`.
- Read paths: `GET /api/launch/options?area=&kind=launch|brain|all` (`launch-routes.mjs:9`, `launch-catalog.mjs:62-100`), `POST /api/launch/default { area, kind: work|brain, mode: launch|inherit|work, launch }` (`server.mjs:6740-6749`), CLI `tangent harness list --area <area>` prints `work default:` and `brain default:` lines (`src/cli/commands/harness.ts:36-58`).
- Repository: Area note `## Resources` line `- Repository: ~/Projects/otto-tangent` (`~/.tangent/trees/otto/tangent/tangent.md:99`), read by `areaResource`/`areaDirectory` (`server.mjs:449-471`). A step `--path` overrides it (`resolveStepPaths`, `server.mjs:2676-2696`).

### Describe work (the "through the brain" path)
- `POST /api/work/describe` (`launch-routes.mjs:6`, `server.mjs:6696-6720`): when any brain record exists for the Area (`brainRecordForArea`, `brain-record.mjs:220-222`, any status), the description goes to `describeWorkToBrain` (`server.mjs:4318-4352`): the text becomes an inbox notice, a live brain gets it queued, an inactive brain is resumed via `startBrain(owner.area, { resume: true, messageRecorded: true })`. Only an Area with no brain record ever opens a plain work-definition session. The Work toolbar no longer exposes Describe work (`design-record.md:115`, decision 6 at line 350).

## 3. What happens when the worker finishes

- Worker prompt (`pipelineStepPrompt`, `server.mjs:1750-1780`): "## When you finish ... Finish with `tangent handover --report '<json>' "<facts>"`. The JSON type is `implementation-result`, with status, summary, evidenceRefs, problems, and nextNeed. Free text alone records evidence but cannot advance or close the Goal." Decision line depends on a live brain (1759-1763): with one, "The brain decides the next action."; without one, "If a real decision needs Julian, ask him here; this legacy pipeline waits." `goalPrompt` adds a `## Brain` section only when `liveBrainForArea(area)` is non-null (1704-1709).
- CLI `tangent handover` (`src/cli/commands/handover.ts:10-22`) and `tangent goal handover` (`goal.ts:280-292`) both post `POST /api/goals/handover { session, text, report? }` (`pipeline-routes.mjs:6`, 22-42; `--continue` is refused with 400 "Workers cannot replace themselves").
- Server chain: `handoverPipelineStep` (3043-3057, per-Goal lock) -> `handoverPipelineStepUnlocked` (3060-3141: exact-retry replay, late evidence on replaced attempts, legacy solo migration) -> `completePipelineStep` (3162-3272).
- `completePipelineStep` with `source === "agent"`: a typed report goes through `recordTypedReport` -> `submitWorkerReport` (`packages/agent-shell/app/area-brain-domain.mjs:375-419`): allowed types for a non-review assignment are `implementation-result | question-needed | context-risk | failed`; `implementation-result` needs `status` in `complete|blocked|failed` and a `summary`; assignment becomes `complete` (or `waiting` for blocked/failed/question/context-risk); `queue.currentAssignmentId = null`; `queue.status = "complete"` when nothing is pending or running; `closeGoal` is true only for a designated `review-result` `passed` at the current `goalRevision` with complete criteria. Untyped text makes the assignment `waiting` with an `untyped-evidence` report (3181-3189).
- A receipt is appended (`appendWorkerHandoverReceipt`, 3210-3220) with `noticeText` from `workerHandoverNotice` (2999-3007): `Goal <slug>: assignment <n> from worker <session> submitted implementation-result (complete). Queue revision <r> recorded assignment status complete. <excerpt>`. `settleWorkerHandoverNotice` (3009-3041) calls `routeBrainNotice` and returns 503 to the worker until the notice has an id ("Retry the same handover unchanged. Tangent will repair and deduplicate the notice.").
- On a v2 queue with `source === "agent"` the server never starts the next assignment: it returns `workerResponse("reported", { index: next.index, session: null })` (3252-3255) or `workerResponse("reported")` when nothing is pending (3235-3251); `goal-done` only in the review-pass branch (3225-3232, `cascadeGoalDone`). Advancing is a separate call: `tangent brain advance <goal> <step>` -> `POST /api/pipelines/control { action: "advance", step, expectedRevision, idempotencyKey, caller? }` (`src/cli/commands/brain.ts:72-81`; `controlPipelineUnlocked` `server.mjs:3315-3360`), which any caller may issue.
- CLI result line (`src/cli/worker-report.ts:29-38`): `reported to <area> brain; queue revision N; notice <id>`.
- `routeBrainNotice` (`server.mjs:4231-4262`): `recordBrainNotice` writes `~/.tangent/agent-shell/brains/<area>/inbox.json` (schema `area-brain-inbox.v1`, `brain-inbox.mjs:1-30`) first. Then: no brain record -> log `kept ... reason: "Area brain has not started yet"` (4243); record but not live -> `kept ... "no live brain; waits for the next generation"` (4248); live -> `messages.queue(record.session, ...)` (4253-4260). Only an exact-Area brain that is `active` with a live session owned by this instance counts (`exactLiveBrainForArea`, 4121-4127).
- A new or resumed brain generation reads unread notices in its prompt under "Unread messages" (`brainPrompt`, `server.mjs:4559-4560`), and `flushBrainNotices` re-queues unread notices on start and reconcile (4453). `tangent agent send <area> "<text>"` stores to the same inbox when no live session matches (`server.mjs:6290-6307`, `src/cli/commands/agent.ts:68-80`).
- Goal file status: the start writes `status: active` plus `session:`; the reconcile pass flips a Goal back to `open` when its session is gone (`server.mjs:2455-2461`, commit message `update: <area> goal <slug> back to open, session ended`) and sends `Goal <slug>: its session <name> ended without a pipeline; the Goal is open again.` only for non-pipeline sessions. A worker session that dies without a handover marks the step `stopped` and notifies the brain (4040-4096). Idle without handover for `TANGENT_BRAIN_IDLE_MINUTES` (default 10) and a decision menu for `TANGENT_BRAIN_WAIT_MINUTES` (default 5) each produce one notice (`server.mjs:222-228`, 4069-4083).
- Goal `done` is written only by `tangent goal done` / `POST /api/goals/edit { status: "done" }` (`goal.ts:365-377`), the browser Goal status surface (`x`), or the review-pass closure. The brain prompt says "A designated review closes routine work only at the current Goal revision. Free text never closes a Goal." (`server.mjs:4572`).

## 4. Runtime state observed (read-only, 2026-08-27)
- Brains (`~/.tangent/agent-shell/brains/*/brain.json`): none live. Statuses: otto/tangent `inactive` gen 324, otto/dnd `stopped` gen 17, otto/launcher `stopped` gen 33, neara `inactive` gen 189, neara/portland `inactive` gen 14, others inactive/stopped/ended.
- Unread inbox notices exist for 16 Areas, e.g. neara/portland 45 of 81, otto/dnd/players 25 of 26, otto/tangent 7 of 207.
- Queue records: 285 files, 717 assignments, 84 single-assignment queues, 2 assignments carry the server's solo default instruction. `launchSource`/`launchDisclosure.source`: explicit 52, absent 665 (pre-disclosure), brain-default 0 (ADR-0035 is dated today). Harness ids across assignments: claude-otto 233, pi-code 180, codex 149, claude 144, agyd 8, codex-gw 2, claude-gw 1. Queue `status`: open 253, canceled 17, complete 15. 184 queues have every assignment `complete` yet `status: open` while their Goal file is `done`.

## Gap

## Minimum human path today (Observed)

**CLI, no brain involved:**
1. `tangent goal create --area <area> --title "<t>" --done-when "<d>"` (three required inputs; `goal.ts:61-63`; server 400 without title or doneWhen, `server.mjs:6984`). Output is the file path, so the slug has to be read from it.
2. `tangent goal start <slug> --launch <harness[/model[/effort]]>` (`goal.ts:113-136`). Omitting `--launch` from a shell returns 400 `step 1 has no --launch ... <area> declares the work default X` (`server.mjs:2652-2662`, pinned by `brain-worker-launch-http.test.mjs:293-299`). The Area Work default is printed in the refusal but never applied for a human caller (ADR-0035: "Tangent still supplies no harness from a profile, from an Area note, or from a recorded command").
Two commands, four typed inputs (area, title, done-when, launch), plus one slug lookup. The instruction defaults to `Implement this Goal and submit a typed implementation result.` (`server.mjs:6774`).

**Browser:**
`a` on the Area -> Area, Name, Done looks like (all required) -> `⌘↵` "Create and choose agent" -> Launch Editor opens seeded with the Area Work default -> Start. Two surfaces; three required text fields; the harness is prefilled (browser-side, `goal-launch-view.js:394-397`) so the "choose the harness" step is one confirmation. There is no "Create and start" button (`goal-launch-view.js:70-72`).

**Julian's target:** one surface, inputs = Area + harness (+ what to do), then it runs. Then a message reaches the brain when the worker finishes.

## Exact friction points

1. **Done condition is mandatory everywhere.** CLI (`goal.ts:63`), `POST /api/goals/create` (`server.mjs:6984`), `POST /api/goals/new` (`server.mjs:6971`), and the browser form (`shell-event-bindings.js:2011-2014`). A quick task has a title and maybe an instruction; the vault rule that an outcome needs a statable done condition (`~/.tangent/trees/README.md`, Outcomes) is enforced at the API.
2. **Create and start are separate operations with no server-side composite.** No route creates and starts (grep for create-and-start across app and CLI finds only the browser's `launchAfterCreate` click chain, `shell-event-bindings.js:2006-2027`). `--own` is the only one-shot on create, and it makes the caller the worker (ADR-0022:18).
3. **Harness must be typed by a human CLI caller.** ADR-0035 makes the live brain the only lender; a shell or browser caller must name one. The browser works around it by sending the Area default itself (`goal-launch-view.js:394-397`, `216-233`). The CLI has no `--launch default` or `--launch work` shorthand; `parseLaunch` only accepts registry ids (`goal.ts:334-339`).
4. **Instruction is a third text input for anything beyond "implement this Goal".** Solo starts get a fixed sentence; the Launch Editor treats it as optional for one assignment (`goal-launch-view.js:615`). For a quick task the title is the instruction, but nothing reuses it.
5. **Finishing does not finish.** On a v2 queue a worker handover only records `reported` and a notice (`server.mjs:3235-3255`); the assignment is `complete`, the queue may be `complete`, but the Goal file stays `active` until its session dies, then `open` (`server.mjs:2455-2461`). Nothing marks it done except a designated review pass (which a quick Goal never has) or Julian (`x` / `tangent goal done`). The worker is told "this legacy pipeline waits" when no brain is live (`server.mjs:1763`).
6. **"Tell the brain when done" already half exists but is invisible.** The handover writes a durable notice to `brains/<area>/inbox.json` whether or not a brain exists (`server.mjs:4238-4248`), and the same happens on create and start via `recordCommittedCommand`. But no brain is live in any Area right now, so the notice sits unread (16 Areas with unread notices) until Julian starts or resumes a brain with an instruction (`startBrain`, `server.mjs:~4800`, requires the Brain composer or Describe work). The notice text is queue-shaped (`Goal <slug>: assignment 1 from worker <session> submitted implementation-result (complete) ...`), not "quick task X is done, here is the summary".
7. **Describe work forces the brain.** With any brain record for the Area, `POST /api/work/describe` routes to the brain and will resume an inactive brain (`server.mjs:6702-6716`, `4344-4350`); a human cannot open a plain worker there. This is the "I don't need to go through the brain" complaint in code.
8. **Ownership and queue conflicts on re-runs.** A second quick start on the same Goal gets 409 `this Goal already has an authoritative queue` (`server.mjs:2879`) or `goal is owned by live session` (2882); the only additive path is `tangent goal append` with a queue revision (`goal.ts:186-188`).

## Candidates

## Candidate A: one composite operation, `tangent goal quick` / `POST /api/goals/quick` (create + start)

**Mechanism.** New server operation that runs `createGoalSet` then `startPipeline` inside one handler, with the title as the assignment instruction when none is given, and an optional done-when defaulting to a fixed sentence such as "Julian accepts the result." Launch resolution for a non-brain caller adds a second explicit source: `launchSource: "area-work-default"` applied only when the request says `launch: "default"` (or the browser sends the seeded choice as today). Returns `{ file, slug, session, launches, warnings }`.
**Touches.** `work-mutation-routes.mjs` or `launch-routes.mjs` (new route), `server.mjs` `start`/`startPipeline`/`materializeStepLaunches` (new fallback source, disclosure rows keep working because `discloseAssignmentLaunch` reads `launchSource`), `goal.ts` + `spec.ts` (`tangent goal quick --area <a> [--launch <ref>|default] "<title/instruction>"`), `goal-launch-view.js` create form (harness picker inline, "Create and start" button), `recordCommittedCommand` (`operation: "goal-quick"`).
**Trade-offs.** Directly contradicts ADR-0035's sentence that Tangent supplies no harness from an Area note; needs an ADR amendment that distinguishes "silent" (refused) from "explicitly requested default" (allowed, disclosed). Two write paths for Goal creation unless the composite reuses `createGoalSet` and `startPipeline` verbatim (it can). Done-when default weakens the vault rule that outcomes state done.
**Migration.** None for records; `launchSource` gains a value; `tangent goal --help` examples change. Tests: extend `brain-worker-launch-http.test.mjs` to prove `launch: "default"` resolves and discloses, and that an omitted launch still returns 400.

## Candidate B: keep two commands, remove each friction point in place

**Mechanism.** (1) `tangent goal create` gains `--start [--launch <ref>|default]` that posts create, then start, from the client (the server already returns the file; `goalsByFile` gives the slug). (2) `tangent goal start --launch default` (or `work`) expands on the server to the Area Work default with `launchSource: "area-work-default"`. (3) `--done-when` becomes optional in the CLI and both create routes, with the same default sentence. (4) The browser create form gets the picker row from decision 15 and a `Create and start` submit that calls `/api/goals/new` then `/api/goals/start` with the seeded choice (no new route).
**Touches.** `goal.ts`, `spec.ts`, `server.mjs:6966-7009` (doneWhen optional), `materializeStepLaunches` (the `default` sentinel), `goal-launch-view.js:38-76`, `shell-event-bindings.js:2004-2032`.
**Trade-offs.** Two round trips from the CLI; a failed start after a successful create leaves a Goal with no queue (already a normal state). Smallest ADR impact: `default` is an explicit human word, so ADR-0035's "no silent default" survives with one clarifying line.
**Migration.** None.

## Candidate C: quick completion policy so the worker's report finishes the Goal and wakes the brain

**Mechanism.** A quick start stamps the queue with `completionPolicy: "worker-report"` (today only `"review-pass"` closes, `area-brain-domain.mjs:411-418`). In `submitWorkerReport`, `closeGoal` also becomes true for `implementation-result` with `status: "complete"` under that policy, so `completePipelineStep` takes the existing `cascadeGoalDone` branch (`server.mjs:3225-3232`) and writes the milestone. The receipt notice text for quick Goals reads as a result ("Quick Goal <title> done by <session>: <summary>"). Optionally `--wake-brain` on the quick start: when the Area has a brain record, the completion calls `startBrain(area, { resume: true, messageRecorded: true })` exactly as `describeWorkToBrain` does (`server.mjs:4344-4350`), so the brain reads the result as its wake reason; without a record, the notice stays in the inbox.
**Touches.** `area-brain-domain.mjs` (`newGoalQueue` policy field, `submitWorkerReport`), `server.mjs` `completePipelineStep` (branch for the policy, brain wake), `workerHandoverNotice`, `pipeline-record.mjs` schema note, `pipelineStepPrompt` (tell the worker its complete report closes the Goal), ADR-0034 amendment (worker-report closure only for a policy Julian chose at creation).
**Trade-offs.** Breaks "free text never closes a Goal" only for typed reports under an explicit policy; Julian's word is given at creation instead of at closure. Waking a brain per quick task costs a generation each time and interacts with pacing (ADR-0024 amendment: a generation that only waits is paced; otto/tangent is at generation 324). A worker that reports `complete` wrongly closes the Goal with no review; the milestone and Goal file make it reversible (`tangent goal reopen`).
**Migration.** Existing queues have no `completionPolicy` field and keep `review-pass` semantics.

## Candidate D: quick task without a Goal file (assignment on the Area)

**Mechanism.** An Area-level queue record (`pipelines/<area>/_quick/<id>.json`) with one assignment and no Goal file; the session binds to the Area only.
**Trade-offs.** Contradicts ADR-0034 (one queue per Goal, Goal file `session:` is ownership), the vault rule "a result is a Goal, not an Area", Work rows (every open Goal is the row unit), `handoverPipelineStep` (matches by Goal), `recordCommittedCommand` (Goal subject), and `readGoalDetail`. Largest change for the least reuse. Listed to show why A to C stay on the Goal.

## Counterexamples

- **ADR-0035 is one day old and pins the opposite of "apply the Area default".** `docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md`: "Tangent still supplies no harness from a profile, from an Area note, or from a recorded command." Its motivation was 121 of 634 assignments on the wrong harness. `brain-worker-launch-http.test.mjs:293-299` asserts the 400 for a handless start. Any design that lets a shell start on the Area default must amend the ADR and the test, and must keep `launchDisclosure` rows so the record shows the applied source.
- **The browser already applies the Area default silently on the wire.** `goal-launch-view.js:394-397` and `216-233` fill `launch` from `/api/launch/options` `default` when the user chose nothing. The server cannot tell a "reviewed" default from a "never looked" one; a server-side `default` sentinel would be the first honest signal.
- **Brain harness and Work harness differ on real Areas.** otto/tangent: brain `codex/sol/low`, work `claude-otto/opus-5/medium` (`tangent.md:247-261`); otto: brain `codex/luna/low`, work `codex/sol/low`. A quick Goal on the Work default followed by a brain `append` on the brain's lent harness produces a mixed-harness queue, and the mismatch warning is measured against the brain default only for a brain caller (`server.mjs:2740-2746`).
- **Closure rules are layered and all say "not the worker".** ADR-0034: "Free text never closes a Goal", "A routine Goal closes after a passed review"; ADR-0024 amendment: a brain cannot mark done directly; `~/.agents/AGENTS.md`: done only on Julian's word except a brain under its own plan. `submitWorkerReport` only computes `closeGoal` for `review-result` on a `designatedReview` assignment with `completionPolicy === "review-pass"` (`area-brain-domain.mjs:411-418`). Candidate C has to be an explicit policy, not a relaxation.
- **A finished quick worker leaves a Goal that looks unstarted.** The reconcile flips `active` -> `open` when the session dies (`server.mjs:2455-2461`); the queue is the only evidence the work happened. 184 queues on disk have every assignment `complete` with `status: open`, so `queue.status` is not a finished signal; `pipelineFinished` (step statuses, `pipeline-record.mjs:204-213`) is.
- **Notices without a brain are durable but inert.** `routeBrainNotice` stores first (`server.mjs:4238`) and then logs `kept` (4243, 4248). 16 Areas currently hold unread notices and no brain is live. "Send the message to the brain" is already satisfied at the storage layer; the missing piece is a reader.
- **Waking a brain is not free.** ADR-0024 amendment (pacing) exists because otto/tangent replaced itself every ~50 seconds (170 generations in four hours); the record is now at generation 324. Auto-waking on every quick completion feeds this unless the wake carries work.
- **Describe work cannot bypass a brain record.** `server.mjs:6702-6716`: any record, even `ended`, routes to `describeWorkToBrain`, which resumes the brain (4344-4350). A "quick" surface built on `/api/work/describe` inherits this.
- **Queue and ownership fences block re-use of a Goal.** `startPipeline` 409s on an unfinished queue or a live owner (`server.mjs:2879-2882`); `append` needs `expectedRevision` (`goal.ts:186`); `replace-agent` needs the exact attempt id (`goal.ts:381-409`). A quick path that re-targets an existing Goal must go through append, not start.
- **The solo start's fixed instruction is nearly unused.** Only 2 of 717 assignments carry `Implement this Goal and submit a typed implementation result.`; brains and the editor almost always supply an instruction. A quick path that reuses the title as the instruction changes what the worker prompt's `## Your step` says.
- **`tangent goal create` returns a file, not a slug**, and `tangent goal start` takes a slug (`goal.ts:90`, `115`). A client-side composite needs the slug from the file name (`goal-<slug>.md`), which `createGoalSet` guarantees (`server.mjs:1341`).
- **Idle and wait notices fire on quick workers too** (10 and 5 minutes, `server.mjs:222-228`), adding inbox rows for a brain nobody started.

## Unknowns

- **Whether Julian will accept a defaulted or omitted done condition.** The vault README (Outcomes) says something without a statable done condition is an idea, not an outcome; both create routes enforce it. Ask him whether a quick task's done condition is "Julian accepts the result" or the title itself. (Not inspected: any earlier Julian statement on this; grep of `docs/design/*/user-intent.md` found none.)
- **What "send the message to the brain" should do when no brain is live.** Store only (already true), start a generation (cost: one generation per quick task, pacing rules), or surface the result to Julian in Work. The runtime shows no live brain in any Area today, so the answer decides whether the feature is visible at all. Establish by asking Julian and by reading the Work row projection for a Goal whose queue is complete and whose session ended (`desk-projection.mjs`, not fully read).
- **Whether quick Goals should auto-close on `implementation-result complete`.** ADR-0034 forbids it in general; a per-queue policy is possible (Candidate C). Needs Julian's word.
- **Exact browser keystroke count in the Launch Editor** from "Create and choose agent" to a running worker (whether Enter or ⌘↵ starts, and whether focus lands on Start). Not driven in a browser; establish with the `verify-app` skill against a read-only instance.
- **Whether the ADR-0035 refusal should stay for browser callers.** The browser never sends `caller`, so it never receives a lent brain harness and always sends a launch. An `area-work-default` source would make the browser's silent fill explicit; whether Julian wants the server or the browser to own that is open.
- **Which Areas' Work default is unset.** Only otto, otto/tangent, and neara notes were read (`grep -rl tangent.environment.v1` listed 16 files, most of them design Documents). Areas with no ancestor declaration would still get the 400 from a `default` sentinel; `tangent harness list --area <area>` per Area establishes it.
- **Performance of the composite.** `goalsByFile` walks the whole vault on every start (`server.mjs:2522-2528`, `2581-2583`); a create followed by a start walks it twice. Not measured.
- **Whether `tangent goal start` from an interactive shell without tmux behaves as the tests show** (`currentTmuxSession()` returns empty, `caller` omitted). `client.ts` was not read.
- **How the launch editor's `launchIsPipeline` branch decides solo versus pipeline** on a one-row start with no instruction (grep found `launchIsPipeline` defined at `goal-launch-view.js:401-404` but its call site in `shell-coordinator.js` was not located).

## Sources

- docs/decisions/ADR-0022-goal-ownership-and-shared-sessions.md
- docs/decisions/ADR-0023-agent-pipelines-replace-reviewed-build.md
- docs/decisions/ADR-0024-area-brain.md
- docs/decisions/ADR-0029-brain-is-the-managed-work-controller.md
- docs/decisions/ADR-0033-area-brain-operating-model.md
- docs/decisions/ADR-0034-audited-area-brain-workflow.md
- docs/decisions/ADR-0035-worker-harness-comes-from-the-brain.md
- docs/decisions/ADR-0037-brain-attempt-launch-override.md
- docs/decisions/ADR-0039-durable-generic-agent-message-queue.md
- docs/design/agent-shell-work-contract/design-record.md
- docs/design/agent-shell-work-contract/user-intent.md
- docs/design/agent-shell-navigation-model/design-record.md
- packages/agent-shell/src/cli/spec.ts
- packages/agent-shell/src/cli/commands/goal.ts
- packages/agent-shell/src/cli/commands/handover.ts
- packages/agent-shell/src/cli/commands/harness.ts
- packages/agent-shell/src/cli/commands/brain.ts
- packages/agent-shell/src/cli/commands/agent.ts
- packages/agent-shell/src/cli/worker-report.ts
- packages/agent-shell/app/server.mjs
- packages/agent-shell/app/launch-routes.mjs
- packages/agent-shell/app/work-mutation-routes.mjs
- packages/agent-shell/app/pipeline-routes.mjs
- packages/agent-shell/app/goal-query-routes.mjs
- packages/agent-shell/app/area-routes.mjs
- packages/agent-shell/app/launch-catalog.mjs
- packages/agent-shell/app/launch-environment.mjs
- packages/agent-shell/app/pipeline-record.mjs
- packages/agent-shell/app/area-brain-domain.mjs
- packages/agent-shell/app/brain-record.mjs
- packages/agent-shell/app/brain-inbox.mjs
- packages/agent-shell/app/brain-worker-launch-http.test.mjs
- packages/agent-shell/app/public/goal-launch-view.js
- packages/agent-shell/app/public/shell-coordinator.js
- packages/agent-shell/app/public/shell-event-bindings.js
- packages/agent-shell/app/public/work-commands.js
- packages/agent-shell/app/public/go-to-core.js
- ~/.tangent/trees/README.md
- ~/.tangent/trees/harnesses.md
- ~/.tangent/trees/otto/otto.md
- ~/.tangent/trees/otto/tangent/tangent.md
- ~/.tangent/trees/neara/neara.md
- ~/.tangent/agent-shell/brains/*/brain.json
- ~/.tangent/agent-shell/brains/*/inbox.json
- ~/.tangent/agent-shell/pipelines/**/*.json
