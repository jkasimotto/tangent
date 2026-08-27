# processes: repeatable Area work that fires on a schedule or a condition and usually creates a Goal; agent-definable, human-readable

## Observed

## 1. Where repeatable-work definitions live today

**The only mechanism for scheduled or condition-driven agent work is the `triggers` map inside an Area-local `.processes.json` (ADR-0030).**

- Manifest schema: the file may hold only `scripts`, `commands`, `triggers` (`src/cli/processes.ts:60-61`; `packages/agent-shell/app/programs.mjs:84-85`). A trigger entry has `every` (duration matching `^(\d+)(s|m|h|d)$`, `src/cli/triggers.ts:64-70`), `probe` (shell text), `instructions` (path, absolute or relative to `cwd`, `triggers.ts:278`), optional `cwd` (default: the Area note's `## Resources` line `- Repository:` or `- Worktree:`, `triggers.ts:266-274`), `paused` (`triggers.ts:92`), and `report` (parsed only by the server projection, `programs.mjs:116`; the root runtime ignores it).
- Probe contract: stdout must be one JSON object, `{"status":"idle"}`, `{"status":"work","key":"...","context"?}` or `{"status":"attention","key":"...","message":"..."}` (`triggers.ts:25-28`, `98-111`). The probe runs as `zsh -lic <probe>` in `cwd` with a 60 s timeout (`triggers.ts:168`).
- Three manifests exist in the vault (find over `~/.tangent/trees`):
  - `neara/pgande/.processes.json`: trigger `rebase-pgande-staging`, `every: 1d`, probe `echo '{"status":"work","key":"'$(date +%Y-%m-%d)'"}'`, instructions `neara/pgande/pgande-staging-rebase-instructions.md`, cwd `/Users/julianotto/git-worktrees/polez/pgande-staging-rebase`, `paused: true`.
  - `neara/pgande/speedrun/.processes.json`: trigger `speedrun-pgande`, `every: 15m`, probe is a bash `if` over `date -u +%H%M` returning `work` with key `speedrun-<date>-am|mid|pm` inside 07:15-07:50, 15:45-16:20, 19:15-19:50 UTC, else `idle`; instructions `neara/pgande/speedrun/pgande-speedrun-instructions.md`; cwd is the Area folder itself.
  - `otto/dnd/.processes.json`: `scripts` only (`hmr`, `checkpoint`), no triggers.
- `.processes.json` is ignored by vault git: `~/.tangent/trees/.gitignore:8` (`**/.processes.json`, comment "Personal named-process definitions live on noun nodes but never enter vault history") and README line 78 ("Do not commit it or copy its definitions into node notes"). The two instruction Markdown files ARE committed (`git ls-files`; commits by julianotto 2026-08-25 "add: neara/pgande daily rebase trigger agent line and instructions", 2026-08-26 "add: neara/pgande/speedrun speedrun area and agent instructions").
- The speedrun Area note (`neara/pgande/speedrun/speedrun.md`) describes the schedule in prose ("The trigger fires at 07:30, 16:00, and 19:30 UTC") and records `- Agent: pi-code --provider resetdata-glm --model zai/glm-5.2 --thinking medium` under Resources. `tangent area show neara/pgande/speedrun` prints Purpose, Goals (0), Ideas (0) and nothing about the trigger.
- Stale vault rule: `~/.tangent/trees/README.md` lines 79-80 still say "A daily agent routine is a committed `recur-<slug>.md` file on its noun node. Its frontmatter contains `schedule: daily HH:MM`, `cwd`, `model`, and `paused`." README line 21 allows frontmatter `type: routine`; `otto/tangent/design-living-documents.md:53` maps "Repeatable personal routine" to "A `type: routine` node note". No code reads `recur-` anywhere (rg over the repo outside docs/dist: zero hits); ADR-0029 deleted that product.

## 2. How to define one today

- CLI: `tangent trigger <list|check|acknowledge|stop|install> [name] [--force] [--json]` (`src/cli/triggers.ts:213-246`; spec `src/cli/index.ts:54-61`). There is no `add`, `create`, `edit`, `remove`, `pause`. Definitions are hand-edited JSON.
- Agent Shell: `POST /api/operations/new` -> `saveLocalProgram` rejects anything but `process` or `command` (`programs.mjs:190` `if (!["process", "command"].includes(type)) throw new Error("Choose a process or command.")`). The "New Operation" form offers only "Server or watcher" and "One-off command" (`packages/agent-shell/app/public/program-view.js:145`).
- Pause/Resume is the only server-side write to a trigger: `setTriggerPaused` rewrites `.processes.json` atomically (`programs.mjs:214-229`), reached via `POST /api/operations/control {id, action: "pause"|"resume"}` (`server.mjs:6448`).
- `~/.agents/AGENTS.md` (every agent's instructions) names `tangent process list|start` ("Before starting any server or watcher") and never mentions `tangent trigger`. The brain's generated command reference covers `BRAIN_COMMAND_NOUNS = ["area","brain","goal","document","agent","idea","vault","shell","harness"]` (`packages/agent-shell/app/brain-command-reference.mjs:18`): no `trigger`, no `process`. So no agent is told how to define a trigger.

## 3. Runtime: `tangent trigger` and its state

- State file `~/.tangent/agent-shell/triggers/state.json`, schema `{ triggers: { "<area>:<name>": { lastCheckedAt, lastOutcome, handledKey, acknowledgedKey, error, sessionName } } }` (`triggers.ts:30-39`, `54-61`). Sweep lock is a directory `sweep.lock`, stale after 5 min (`triggers.ts:336-345`).
- Current state (observed 2026-08-27): `neara/pgande:rebase-pgande-staging` lastCheckedAt `2026-08-25T23:40:32Z`, lastOutcome work key `2026-08-26`, handledKey `2026-08-26`, no session; `neara/pgande/speedrun:speedrun-pgande` lastCheckedAt `2026-08-27T09:42:33Z`, lastOutcome idle, sessionName `trigger-speedrun--speedrun-pgande-7e780adf`.
- Due rule: paused never due; otherwise `now - lastCheckedAt >= everyMs`; missed intervals coalesce into one check (`triggers.ts:126-131`). The interval is relative to the last check, not aligned to wall-clock. Calendar schedules are explicitly unsupported (ADR-0030 "The first version supports fixed intervals only").
- Dedupe: a worker launches only when `previous.handledKey !== outcome.key`; an `idle` result clears `handledKey` and `acknowledgedKey`; `attention` records nothing until acknowledged (`triggers.ts:171-178`, `189-197`). An error during probe or launch stores `error` and leaves `handledKey` unchanged (`triggers.ts:180-182`).
- Overlap: `launchTriggerAgent` reads `pane_current_command` of the retained tmux session; if it is not one of `zsh bash fish sh dash tcsh nu` it throws `trigger agent <session> is still active` (`triggers.ts:282-283`). Session name `trigger-<leaf>--<name>-<sha1(8)>` (`triggers.ts:119-123`); options `@tangent_kind trigger`, `@tangent_area`, `@tangent_process` (`triggers.ts:287-289`).
- Prompt pasted into the agent: instructions text + `Trigger: <area>:<name>` + `Observed key: <key>` + optional `Context:` (`triggers.ts:294`). Agent command is the nearest Area note `- Agent:` resource, fallback `claude-otto` under `otto/`, else `claude` (`triggers.ts:302-314`).
- Scheduler while the shell is closed: LaunchAgent `~/Library/LaunchAgents/com.tangent.triggers.plist` runs `/usr/bin/env zsh -lic "tangent trigger check"` with `StartInterval 60`, stdout/stderr to `~/.tangent/agent-shell/triggers/launchd.log` and `launchd-error.log` (`triggers.ts:249-264`; plist observed; `launchctl list` shows `com.tangent.triggers` loaded, exit 0). Agent Shell itself is also a LaunchAgent (`com.tangent.agent-shell.plist`, `KeepAlive`, `gateway.mjs`), so "shell closed" in practice means crashed or rebuilding.
- `launchd-error.log` is 766 KB, 33,000 lines, entirely `gitstatus failed to initialize` / `can't change option: monitor` from the login shell (`-l`) every minute; `launchd.log` is empty.
- Trigger workers and Goals: ADR-0030 says trigger workers "do not create Goals or require an Area brain". Neither instructions file contains `tangent goal`; both end with "print a short summary". `tangent goal create` is an HTTP client to `http://127.0.0.1:4321` (`packages/agent-shell/src/cli/client.ts:10`; error text at `:228` "Agent Shell is not running at ..."), so a worker can only create a Goal while the server is up. ADR-0034 later made commands permissive ("Any local caller can act directly on work in any Area"), so nothing forbids a trigger worker calling `tangent goal create`; nothing does today.
- Tests: `test/triggers.test.mjs` covers duration/probe contracts, manifest parsing and cwd derivation, due coalescing, discovery, LaunchAgent install, stop. No test covers dedupe across two work keys, the still-active path, or a failing manifest.

## 4. Can a trigger wake or inform the brain?

- Only through Operation events. Server runtime-scheduler lane `material Operation events` runs every 10 s (`server.mjs:2155-2163`): `programsSnapshot` (reads `.processes.json` and `state.json`, `programs.mjs:123-172`) -> `operationFromProgram` (`packages/agent-shell/app/area-brain-domain.mjs:425-436`: trigger mode `scheduled`; state `problem` when `program.error || runtime.error || unacknowledged attention`, else `running`/`quiet`; `reportableResult` only when `report === true` and `lastOutcome.status === "work"`) -> `materialOperationEvents` (`packages/agent-shell/app/operation-events.mjs:49-71`: kinds `problem-opened`, `problem-changed`, `problem-resolved`, `declared-result`) -> `projectMaterialOperationEvents` (`server.mjs:6399-6421`): `notifyBrain(operation.area, "Operation <label>: <summary>", {idempotencyKey})` plus `appendMilestone(kind: operation-<kind>)`.
- `notifyBrain` -> `routeBrainNotice` (`server.mjs:4301-4308` and its body): the notice is persisted to `~/.tangent/agent-shell/brains/<area>/inbox.json` first; with no brain record it logs "Area brain has not started yet"; with an inactive brain "no live brain; waits for the next generation". It never starts a brain. The only path that wakes an inactive brain from a notice is `deliverJournalToBrain` (`server.mjs:4434-4443`), which calls `startBrain(area, {resume: true, messageRecorded: true})` and only when a `brain.json` exists.
- Inboxes are exact-Area only: `inboxesForBrain` keeps `record.area === area` ("Parent and child Areas never share delivery", `packages/agent-shell/app/brain-inbox.mjs:121-126`); `brainOwnsArea` requires `brainArea === area` (`packages/agent-shell/app/brain-record.mjs:213-215`).
- Observed consequence: `~/.tangent/agent-shell/brains/neara/pgande/speedrun/inbox.json` holds n1..n4 (2026-08-26T19:20Z "problem: trigger agent trigger-speedrun--speedrun-pgande-7e780adf is still active", 20:05Z "recovered", 2026-08-27T07:26Z same problem, 07:56Z "recovered"), all `readAt: null, deliveredAt: null`. The speedrun Area has no `brain.json` (only inbox, milestones, operation-events). `operation-events.json` for the Area records the same four edges; `milestones.json` across all brains contains only `operation-problem-opened` (2) and `operation-problem-resolved` (2); no `declared-result` has ever fired.
- The tmux session `trigger-speedrun--speedrun-pgande-7e780adf` still exists (created Thu Aug 27 01:48 local = 2026-08-26T15:48Z, inside the 15:45-16:20Z window), `pane_current_command` is `node`: the pi-code REPL sits at its prompt with the finished report visible (`↑176k ↓77k ... 12.8%/1.0M`). So the trigger ran once; the 19:15Z and 07:15Z windows both hit "still active" and were reported as Problems that self-resolved when the window passed. It will not run again until `tangent trigger stop` kills the session.
- Brain prompt (`server.mjs:4502-4599`) has no Operations, trigger, or schedule section; the vault design record `otto/tangent/design-record-tangent-around-the-area-brain.md:868` lists "Healthy Operations and routine schedules" under what the prompt deliberately omits.
- Brain pacing (`packages/agent-shell/app/brain-pacing.mjs`): in-memory backoff ladder `[60s,120s,300s,600s,1200s,1800s]` for a live generation that did nothing; `wakeFromPaceText` (`server.mjs:5277-5279`) tells it to sweep `tangent goal list` and `tangent agent list` and hand over if nothing changed; queued from reconcile when `brainPacing.due` (`server.mjs:5423-5426`). It is not a wall-clock scheduler and applies only to a live session. All 17 `brain.json` records on the machine are currently `inactive`, `ended`, or `stopped` (none active).
- `packages/agent-shell/app/runtime-scheduler.mjs` is an in-process 1 s tick with named serial lanes (message delivery, material Operation events); it lives and dies with the server.

## 5. How triggers are shown

- API: `GET /api/operations` returns `{programs, operations, problems, errors, areas, liveCount}` (`programs.mjs:171`; routes `packages/agent-shell/app/program-routes.mjs:6-8`; legacy `/api/programs*` behind `TANGENT_LEGACY_PROGRAM_API=1`, `program-routes.mjs:10-12`, ADR-0033). Each trigger item: `id: trigger:<area>:<name>`, `type: "trigger"`, `label` (Title Case of slug), `command` = probe text, `probe`, `instructions` (path), `every`, `paused`, `report`, `runtime` (the state.json record), `cwd`, `sessionName`, `session`, `available` (`programs.mjs:148-157`); plus `mode: "scheduled"`, `state`, `problem`, `reportableResult` from `operationFromProgram`.
- Row (`program-view.js:75-86`): kind word "Trigger", label, the raw probe as `<em>`, a state word from `programState` ("Agent running", "Agent running · Paused", "Paused", "Check failed", "Needs attention", "Waiting", "Not checked", `program-view.js:21-28`), and controls Stop / Check now / Pause / Resume (`program-view.js:53-67`). Detail (`program-view.js:116-129`): Command (probe), Folder, Cadence (`every`), Instructions (path only), Last check (local time), Attention message, Error, Session. There is no next-run time, no last-run result or summary, no plain-language condition, no run history, and no link to any Goal.
- `public/shell.js:644` includes `item.lastRunAt` and `item.nextRunAt` in the paint key; `programsSnapshot` never sets either (dead keys).
- Placement: on the Area page the Operations list is inside `<details class="area-more">More` and then `<details>Operations · N` (`packages/agent-shell/app/public/area-directory-view.js:241-243`): collapsed, two disclosures deep. Work shows only Operations whose state is `problem` (`packages/agent-shell/app/public/work-desk-view.js:1810-1827`, "A healthy Operation adds nothing to Work"). Julian's own note: "The Area view is rarely opened and needs a redesign later" (`otto/tangent/tangent.md` Ideas, 2026-08-20).
- CLI read: `tangent trigger list` prints `<area>:<name>\t<state>\t<every>` with states waiting / error / needs-attention / work-seen / paused (`triggers.ts:222-225`, `348-354`); `--json` dumps `{definitions, state}`.

## 6. Naming today

- `tangent process <list|start|stop|restart|close> [name] [--area]` manages long-running tmux servers/watchers from `scripts` (`src/cli/processes.ts:199-224`); AGENTS.md: "Before starting any server or watcher: tangent process list, tangent process start". UI kinds: "Server or watcher", "Command", "Trigger" under the heading "Operations"; ADR-0033: "Programs project as Area Operations with one mode" (`service`, `on-demand`, `scheduled`, `area-brain-domain.mjs:426`). The vault design record defines "Process: a runtime instance of an Operation. It is an internal term." (`design-record-tangent-around-the-area-brain.md:350`). Both process and trigger sessions store their name in the same tmux option `@tangent_process` (`processes.ts:192`, `triggers.ts:287`).

## 7. What ADR-0029 rejected and why

- ADR-0029 deleted `@tangent/threads`, `tangent threads`, the Daily agent UI and `recur-*.md` scheduled agents: no definitions existed on the machine, the projection stopped changing 2026-08-14, both LaunchAgents failed because the CLI path no longer existed, and the package cost every rebuild. ADR-0016 is marked superseded. ADR-0030 explicitly "introduces a narrower Programs lifecycle rather than restoring either product". ADR-0034 amended ADR-0030: "Material trigger events now reach the exact inbox".

## 8. Goal creation facts that a Goal-creating process depends on

- `POST /api/goals/create` (`packages/agent-shell/app/work-mutation-routes.mjs:9`; handler `server.mjs:6979-7000`): needs `area`, `goal.title`, `goal.doneWhen`; optional `description`, `sources` (vault Documents rendered as `## Sources` wikilinks), `subgoals` (max 8), `own`, `caller` (audit provenance). `createGoalSet` (`server.mjs:1329-1352`) writes `goal-<slug>.md`, adds the Goal to the Area note, `git add`, `vaultCommit("add: <area> goal <slug> from Agent Shell")`.
- Slug allocation appends `-2`, `-3`, ... on collision (`allocateGoalSlug`, `server.mjs:1213-1220`); there is no dedupe by title or by any key. Goal frontmatter is `type: goal`, `status`, `done_when`, `session`, `waiting_on` (observed on `otto/tangent/goal-a-better-view-over-my-work-past-and-present.md`); no field records a creating process.
- Precedents in the vault for condition-driven Goal creation: `otto/dnd/testing/design-tests-are-strong-but-fast.md:114-115` chose a commit-triggered checkpoint runner "registered as a `tangent process`" over "a scheduled run (cron, every N hours)" because "between runs a red commit sits unnoticed", and wants "On red it can also drop a note the brain can turn into a fix Goal". `otto/tangent/design-agent-usage-insights.md:206` wants a scheduled global usage-index refresh "(LaunchAgent or the Agent Shell server on a timer, since it already runs)".

## Gap

Julian's intent, split into four claims, against what exists:

1. **"Very cleanly and easily define processes ... define those for an area ... happy for an agent to do it."** Today a definition is a hand-edited, git-ignored `.processes.json` whose condition is an opaque zsh string and whose body lives in a separate committed Markdown file. No CLI or API creates a trigger (`programs.mjs:190`; `tangent trigger` has no add). No agent is told the mechanism exists (AGENTS.md and `BRAIN_COMMAND_NOUNS` omit it). The two real triggers were written by Julian by hand on 2026-08-25/26. The vault README still advertises a deleted `recur-*.md` format, so an agent following the vault rules would define the wrong thing.

2. **"Happen at regular times or at trigger conditions."** Only fixed intervals relative to the last check exist (`triggerIsDue`). Both real triggers fake a calendar: the rebase probe always returns `work` with today's date as the key so `every: 1d` plus key-dedupe yields "once a day, whenever the sweep runs after 23:40Z"; the speedrun probe polls every 15 min and returns `work` inside three 35-minute UTC windows. Conditions exist (probe), but the condition language is shell, the dedupe rule (`handledKey`) is implicit, and a condition-based trigger cannot express "at 07:30" without a window wide enough to catch a 15-minute poll.

3. **"Usually creating a goal."** No process creates a Goal. A trigger launches a retained interactive tmux agent with pasted instructions; its result is a pane transcript and, only for `report: true` with a `work` outcome, a `declared-result` notice (never fired in production). ADR-0030 stated the opposite of Julian's wish ("do not create Goals"). A Goal-creating process needs the server (`client.ts:10`), a dedupe policy (slugs collide into `-2`, `-3`), provenance (no frontmatter field), and a brain hand-off (notices are exact-Area and never wake an inactive brain; the speedrun Area has no brain and four unread notices).

4. **"Read them and very clearly see what processes I have, when they trigger, what their trigger conditions are."** The readable surfaces are `tangent trigger list` (name, state word, interval) and an Operations list two disclosures deep on an Area page Julian says he rarely opens. The row shows the raw probe text as the condition, `Cadence: 15m` as the schedule, and no next-run, no last-run outcome, no created Goal, no history. The definitions are not in vault history, so "read them" cannot mean reading the vault. The prose schedule in `speedrun.md` ("fires at 07:30, 16:00, and 19:30 UTC") is hand-maintained and can drift from the probe.

Closest existing mechanism: ADR-0030 triggers plus the Operation-event projection (`projectMaterialOperationEvents`). They already provide per-Area definition, a root-owned scheduler that runs while the shell is closed, one-worker-per-trigger, key dedupe, a UI row, and exact-Area brain notices. Missing: a calendar schedule, a Goal-creating action, a committed human-readable definition, a definition CLI, a next-run/last-run projection, and a wake path to a brain that exists.

## Candidates

## Candidate A: vault-native Markdown process files, run by the root scheduler, projected read-only

**Definition.** One committed file per process beside the Area note: `<area>/process-<slug>.md`, frontmatter `type: process`, `status: active | paused`, and exactly one of `schedule:` (calendar: `daily 09:00`, `weekdays 07:30 UTC`, `mon,thu 16:00`, or a list) or `when:` (a probe command, polled `every: 15m`), plus `action: goal | agent`, `dedupe: per-slot | one-open`, optional `cwd`, `launch`. The body is the Goal description or the agent instructions (today's `pgande-speedrun-instructions.md` becomes the body). Rendered schedule text is derived deterministically from frontmatter, never hand-written. A new command `tangent process define --area <a> --name <n> --schedule "<text>" | --when "<probe>" --every 15m --goal-title "<t>" --goal-done-when "<c>" [--body-file <md>]` writes and commits the file (`vault commit` provenance), so an agent never hand-writes frontmatter; `tangent process list|show|pause|resume|check|stop` are the read and control verbs.

**Who runs it when the shell is closed.** Keep the root `tangent trigger` runtime and its LaunchAgent (`triggers.ts:157-186`, `249-264`) as the executor, renamed or aliased under the same `tangent process` noun (see naming below). Discovery walks Area folders for `process-*.md` instead of `.processes.json` `triggers`. Calendar due logic: compute the next slot from `schedule` and fire when `now >= slot` and `firedSlot !== slot` (slot key = the ISO instant of the scheduled time), coalescing missed slots to the latest one, so a sleeping laptop fires once on wake rather than three times. `when:` processes keep today's probe/key dedupe.

**Goal action.** The sweep posts `POST /api/goals/create` with `title`, `doneWhen`, `description` = body, `sources: [process file]`, `caller: process:<area>:<name>`; the server adds a frontmatter line `process: <area>/process-<slug>` so the Goal shows its origin. Dedupe `one-open`: skip when an open Goal with that `process:` field exists; `per-slot`: title suffixed with the slot date ("Rebase pgande-staging 2026-08-27"), skip when a Goal with that `process` and `slot` exists. When the server is down, write a durable request under `~/.tangent/agent-shell/triggers/outbox/<id>.json`; the server converts it on reconcile (same outbox pattern as the worker-handover receipt, ADR-0034). `action: agent` keeps today's retained-session worker but launches it through `POST /api/goals/start` on the created Goal when the server is up, so the worker is a normal queue attempt with a handover instead of a foreign REPL.

**Brain hand-off.** After creation, `routeBrainNotice(area, "Process <name> created Goal <slug>")`. If no `brain.json` exists for the exact Area, deliver to the nearest ancestor that has one (a new explicit exception to `inboxesForBrain`, documented in an ADR amendment to ADR-0034) or, minimum, surface the created Goal in Work where it is already visible as an open Goal.

**Read-only view.** A `Processes` section on the Area page above `More`, and a compact `Processes` shelf on Work showing only the next 24 h of fires and any problem. Columns: name, schedule text ("Daily 09:00", "Every 15 min while `...` reports work"), next run (computed), last run (time, outcome, link to the Goal or session), state. `tangent process list` prints the same columns. The existing "Check now / Pause / Resume / Stop" controls stay.

**Migration.** A one-shot `tangent process migrate` converts `triggers` entries into `process-*.md` files (rebase -> `schedule: daily 09:40` or Julian's chosen time; speedrun -> `schedule: 07:30, 16:00, 19:30 UTC`; instructions file content -> body), keeps `state.json` keys `<area>:<name>` so history survives, and leaves `.processes.json` with only `scripts` and `commands`. The trigger key stays parsed for one release with a deprecation error in `tangent process list`. Delete README lines 79-80 and replace with the new file rule.

**Trade-offs.** Most work: new parser, calendar logic, outbox, frontmatter field, two UI surfaces, ADR. Gains: definitions in vault history, readable by Julian in Obsidian and by every agent, agent-writable through one command, schedule and condition visible as text, Goals as the product of a process. Risk: two writers of the file (agent edits, server pause flag) need the same atomic rewrite discipline as `setTriggerPaused`.

## Candidate B: keep `.processes.json`, extend the trigger schema, add a definition CLI and a read-only projection

**Definition.** Add to each trigger entry `schedule` (calendar list) as an alternative to `every`+`probe`, `goal: { title, doneWhen, dedupe }`, and `description` (plain text shown as the condition). Add `tangent trigger add|edit|remove|pause|resume` so agents stop hand-editing JSON. Teach agents in AGENTS.md and `BRAIN_COMMAND_NOUNS`.

**Who runs it.** Unchanged: root CLI + LaunchAgent. Calendar slot logic and Goal action as in A, but the definition stays machine-local and git-ignored.

**Read-only view.** Extend `programsSnapshot` with computed `nextRunAt`, `lastRunAt`, `lastResult`, `scheduleText`, `conditionText` (the keys `shell.js:644` already expects), and render them in `program-view.js` row and detail; move the Operations section out of `More`. `tangent trigger list` gains next-run and last-result columns.

**Migration.** None for existing files; new fields are optional. README lines 79-80 still need deleting.

**Trade-offs.** Least code and no vault-rule change. But it entrenches an ignored JSON file as the definition of Julian's work: not in history, not readable in the vault, not portable to a second machine, and the "condition" stays a shell string unless `description` is hand-maintained (the same drift as `speedrun.md` prose today). The `.processes.json` ignore rule exists because `scripts` hold personal machine paths; processes are Area work, not machine configuration, which argues against B.

## Candidate C: brain-owned routines in the plan Document

**Definition.** The brain writes a `## Processes` section in `plan-<leaf>.md` with a strict line grammar, parsed by Tangent the way `for-julian.mjs` parses `## For Julian` (ADR-0025): `- Every weekday 09:00: create Goal "<title>" done when "<condition>".` and `- When \`<probe>\` reports work (every 15m): <instruction>.` The brain is the only writer; Julian reads the plan Document.

**Who runs it.** Two sub-options. C1: the brain executes, so the LaunchAgent sweep must wake the brain at due times (a `startBrain(resume, messageRecorded)` call like `deliverJournalToBrain`, `server.mjs:4434-4443`), and the brain runs `tangent goal create`. C2: Tangent parses the lines deterministically and executes them exactly as in A; the brain only authors.

**Read-only view.** The plan Document itself, plus a projection identical to A's (parsed lines give schedule text; state from `state.json`).

**Migration.** The brain rewrites the two existing triggers as lines in `plan-pgande.md` and `plan-speedrun.md` (the speedrun Area has no plan or brain today; one would have to be created).

**Trade-offs.** C1 is the cheapest to write and the most expensive to run: every fire costs a brain generation (the 2026-08-25 precedent was 170 idle generations in four hours, `brain-pacing.mjs` header), the brain is inactive on every Area right now, LLM parsing of a schedule is non-deterministic, and a brain-less Area (speedrun) has no owner. C2 collapses into A with the definition inside the plan Document instead of its own file; the plan Document is brain prose that the brain rewrites each generation, so a deterministic section inside it is fragile (the brain can drop or reword lines). C keeps Julian's "read them" inside a Document he already opens, which is its real merit.

## Cross-cutting decision points

- **Naming.** `tangent process` today means servers and watchers (`processes.ts`), and Julian says "processes" for repeatable work. Options: rename today's `scripts` to `tangent service` (matches the Operation mode `service` in `area-brain-domain.mjs:426`) and give `tangent process` to repeatable work; or keep `tangent process` for servers and use `tangent routine` for repeatable work. The first matches Julian's vocabulary and the ADR-0033 mode names; it touches AGENTS.md, README lines 69-77, `tangent process` callers in the desk (`server.mjs:6441`), and the `otto/dnd` checkpoint design.
- **Executor location.** A Goal-creating process needs the server anyway. Moving due logic into the server's `runtime-scheduler` lane (already a 10 s Operation lane, `server.mjs:2155`) removes the LaunchAgent, the 33k-line error log and the `zsh -lic` cost, at the price of not firing while the server is down (it is a KeepAlive LaunchAgent, so the window is small). Keeping the root CLI honours ADR-0030's reason ("Agent Shell may be closed"). A middle path: server-owned due logic plus a durable outbox for `goal` actions, with `tangent process check` as the manual path.
- **Worker exit.** The retained interactive REPL is why speedrun ran once (`triggers.ts:282-283`). Any candidate that keeps `action: agent` must either run the harness non-interactively, or treat a session whose Goal attempt has handed over as free, or replace the retained session with a Goal-queue attempt.

## Counterexamples

1. **A finished interactive worker blocks its trigger forever.** `launchTriggerAgent` treats any non-shell `pane_current_command` as "still active" (`triggers.ts:282-283`). The speedrun session runs `node` (pi-code REPL at its prompt after finishing) since 2026-08-26T15:48Z; the 19:15Z and 07:15Z windows both failed with "trigger agent ... is still active", surfaced as Problems that self-resolved when the window passed (`brains/neara/pgande/speedrun/operation-events.json`). A naive "one worker per process" rule without a completion signal reproduces this.

2. **A calendar faked as a probe drifts.** The rebase trigger's probe always returns `work` with today's date; `every: 1d` is relative to `lastCheckedAt` (`2026-08-25T23:40:32Z`), so the daily run slides later by sweep latency each day and has no notion of "at 09:00". A design that adds `schedule:` must define dedupe by slot, not by `handledKey`, or a paused-then-resumed process will refire for an old key.

3. **Polling windows vs exact times.** Speedrun needs 35-minute windows to guarantee one hit at 15-minute polling; a "cron expression" design that fires only at the exact minute misses every slot the laptop sleeps through, while today's coalescing (`triggers.ts:126-131`) plus window keys tolerates sleep. Slot coalescing must fire the latest missed slot, not all of them.

4. **Exact-Area inboxes drop notices for brain-less Areas.** `inboxesForBrain` and `brainOwnsArea` require the exact Area (`brain-inbox.mjs:124-126`, `brain-record.mjs:213-215`); `routeBrainNotice` never starts a brain. The speedrun Area has no `brain.json` and four unread Operation notices. "A process informs the brain" is false for the one real scheduled process on the machine. ADR-0034 superseded ADR-0024's descendant-inbox clause, so ancestor delivery needs a new decision.

5. **Goal creation needs the server; the scheduler was designed not to.** `tangent goal create` is a loopback HTTP client (`client.ts:10`, `:228`); ADR-0030 put the scheduler in the root CLI so it works while Agent Shell is closed. A Goal-creating process therefore needs an outbox or must run inside the server.

6. **Goal slugs never dedupe.** `allocateGoalSlug` appends `-2`, `-3` (`server.mjs:1213-1220`); a daily Goal-creating process yields `goal-rebase`, `goal-rebase-2`, ... and nothing links them to the process or stops a second open one.

7. **One bad manifest kills every trigger on the machine.** `parseTriggerManifest` throws when `cwd` does not exist (`triggers.ts:91`); `discoverTriggers` has no per-manifest try/catch (`triggers.ts:137-153`), so `checkTriggers` and the whole sweep throw. The rebase trigger's cwd is a git worktree (`/Users/julianotto/git-worktrees/polez/pgande-staging-rebase`); deleting it to reclaim disk (the speedrun instructions say worktrees "may have been deleted to reclaim disk") would silently stop the speedrun trigger too. The server projection, by contrast, isolates errors per Area (`programs.mjs:159-161`).

8. **The definition file is deliberately not vault history.** `.gitignore:8` and README line 78 forbid committing `.processes.json`; the instructions Markdown is committed. Any design that keeps definitions in that file cannot satisfy "read them" from the vault or from a second machine, and an agent that defines one cannot `tangent vault commit` it.

9. **Stale vault rule.** README lines 79-80 describe `recur-<slug>.md` with `schedule: daily HH:MM`; nothing reads it (ADR-0029). An agent following vault rules today defines a routine that never runs.

10. **`report`/`revision` fields are half-wired.** `programs.mjs:116` parses `report: true` and `operationFromProgram` reads `outcome.revision`, but `triggers.ts` ignores `report` and `parseTriggerOutcome` never keeps `revision`; `declared-result` has never appeared in any `milestones.json`. Reusing this path for "process result -> brain" needs it finished, not assumed.

11. **Naming collision.** `tangent process` already means servers/watchers in AGENTS.md, README lines 69-77, `server.mjs:6441`, the otto/dnd checkpoint design, and the tmux option `@tangent_process` is shared by processes and triggers (`processes.ts:192`, `triggers.ts:287`). Calling the new thing "process" without renaming the old one breaks every agent's instruction to run `tangent process list` before starting a server.

12. **Brains are not a clock.** Pacing is an in-memory backoff for a live generation, capped at 30 min, and its wake text instructs the brain to hand over when nothing changed (`server.mjs:5277-5279`); all 17 brain records are inactive/ended/stopped now. Brain-owned routines (Candidate C1) need an external wake and cost a generation per fire (precedent: 170 generations, 3.9 h of tokens, `brain-pacing.mjs` header).

13. **The read-only surface is already hidden.** Operations sit under `More` > `Operations` (`area-directory-view.js:241-243`) on a view Julian says he rarely opens; Work hides healthy Operations by design (`work-desk-view.js:1810-1827`). A read-only view placed in the same slot does not meet "very clearly see".

14. **The LaunchAgent login shell is noisy and costly.** `zsh -lic` every minute has produced 33,000 lines of p10k/gitstatus errors in `launchd-error.log`; each probe also spawns a login shell with a 60 s timeout. A design that adds more processes multiplies this unless the sweep runs one non-login shell or moves into the server.

15. **Prose schedules drift.** `speedrun.md` says "fires at 07:30, 16:00, and 19:30 UTC"; the probe's windows start at 07:15, 15:45, 19:15 and the actual first fire was 15:48Z. Any design where the human-readable schedule is hand-written rather than derived from the executed definition repeats this.

## Unknowns

- **Who paused the rebase trigger and why.** `paused: true` is in an ignored file; no commit, log, or milestone records it. Ask Julian, or check `~/.tangent/agent-shell/messages*` logs if any exist for the pause action.
- **Whether the speedrun agent is meant to exit.** `pi-code` stays as a REPL after its turn; unknown whether it has a non-interactive/exit flag. Establish by reading the pi-code CLI help or the harness registry (`tangent harness list`).
- **Julian's exact words beyond the quoted sentence**: whether "creating a goal" means an unowned Goal for the brain to dispatch, or a Goal the process's own worker takes with `--own`; whether he wants processes in vault history (conflicts with README line 78); whether local time or UTC schedules; whether he wants processes on Work or only on the Area page. Establish from the voice memo transcript.
- **Dedupe policy Julian expects** when a process fires while its previous Goal is still open (skip, reopen, or a second Goal). Not derivable from code.
- **Whether ancestor brains may receive child-Area process notices.** ADR-0034 forbids ancestor mutation authority and exact-inbox delivery; whether notices (not mutations) may bubble is undecided. Needs an ADR amendment either way.
- **Cost and reliability of the LaunchAgent sweep on this machine**: `launchd.log` is empty and the error log is only shell noise, so there is no positive record of sweeps; verify by adding a heartbeat line or reading `state.json` `lastCheckedAt` deltas over a day.
- **Whether `tangent process` can be renamed** without breaking Julian's other repos' instructions (`~/.claude/polez`, `otto/dnd` checkpoint runner design names `tangent process`). Grep those trees before choosing the noun.
- **Second-machine use**: whether Julian runs Tangent on more than one Mac (affects whether definitions must be committed and whether `cwd` paths can be machine-relative). Ask.
- **How the brain would learn about processes** if they are vault files: the brain prompt omits Operations by design (`design-record...:868`); whether a bounded "Processes" line belongs in the prompt is a product decision.
- **Whether any trigger event ever reached a live brain**: all observed notices are unread in a brain-less Area; no evidence either way for an Area with an active brain. Establish with a test in `packages/agent-shell/app` that starts a brain and projects a trigger problem.

## Sources

- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0030-area-triggers.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0029-remove-threads-and-routines.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0016-threads-vertical-app.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0024-area-brain.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0025-brain-writes-what-needs-julian.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0031-agent-shell-capability-ownership.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0033-area-brain-operating-model.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0034-audited-area-brain-workflow.md
- /Users/julianotto/Projects/otto-tangent/docs/decisions/ADR-0036-agent-shell-process-ownership.md
- /Users/julianotto/Projects/otto-tangent/src/cli/triggers.ts
- /Users/julianotto/Projects/otto-tangent/src/cli/processes.ts
- /Users/julianotto/Projects/otto-tangent/src/cli/index.ts
- /Users/julianotto/Projects/otto-tangent/test/triggers.test.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/programs.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/program-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/area-brain-domain.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/operation-events.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-pacing.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/runtime-scheduler.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-command-reference.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-inbox.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/brain-record.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/work-mutation-routes.mjs
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/server.mjs (lines 605-630, 1205-1225, 1329-1375, 2150-2175, 4170-4200, 4290-4335, 4425-4471, 4500-4599, 4975-5000, 5270-5290, 5410-5435, 6290-6310, 6385-6460, 6979-7000)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/program-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/area-directory-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/work-desk-view.js
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/app/public/shell.js (line 644)
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/client.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/commands/goal.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/src/cli/spec.ts
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/docs/public-api.md
- /Users/julianotto/Projects/otto-tangent/packages/agent-shell/docs/architecture.md
- /Users/julianotto/Projects/otto-tangent/ARCHITECTURE.md
- /Users/julianotto/Projects/otto-tangent/docs/index.md
- /Users/julianotto/Projects/otto-tangent/docs/design/prepared-review-requests/design-record.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-work-contract/design-record.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-navigation-model/design-record.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-architecture-boundaries.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-compressed-work-hierarchy.md
- /Users/julianotto/Projects/otto-tangent/docs/design/agent-shell-area-desk.md
- /Users/julianotto/.agents/AGENTS.md
- /Users/julianotto/.tangent/trees/README.md
- /Users/julianotto/.tangent/trees/.gitignore
- /Users/julianotto/.tangent/trees/neara/pgande/.processes.json
- /Users/julianotto/.tangent/trees/neara/pgande/speedrun/.processes.json
- /Users/julianotto/.tangent/trees/otto/dnd/.processes.json
- /Users/julianotto/.tangent/trees/neara/pgande/pgande-staging-rebase-instructions.md
- /Users/julianotto/.tangent/trees/neara/pgande/speedrun/pgande-speedrun-instructions.md
- /Users/julianotto/.tangent/trees/neara/pgande/speedrun/speedrun.md
- /Users/julianotto/.tangent/trees/neara/pgande/pgande.md
- /Users/julianotto/.tangent/trees/otto/tangent/tangent.md
- /Users/julianotto/.tangent/trees/otto/tangent/plan-tangent.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-record-tangent-around-the-area-brain.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-living-documents.md
- /Users/julianotto/.tangent/trees/otto/dnd/testing/design-tests-are-strong-but-fast.md
- /Users/julianotto/.tangent/trees/otto/tangent/design-agent-usage-insights.md
- /Users/julianotto/.tangent/agent-shell/triggers/state.json
- /Users/julianotto/.tangent/agent-shell/triggers/launchd-error.log
- /Users/julianotto/.tangent/agent-shell/triggers/launchd.log
- /Users/julianotto/.tangent/agent-shell/brains/neara/pgande/speedrun/inbox.json
- /Users/julianotto/.tangent/agent-shell/brains/neara/pgande/speedrun/operation-events.json
- /Users/julianotto/.tangent/agent-shell/brains/neara/pgande/operation-events.json
- /Users/julianotto/.tangent/agent-shell/brains/**/brain.json (17 records)
- /Users/julianotto/.tangent/agent-shell/brains/**/milestones.json
- /Users/julianotto/Library/LaunchAgents/com.tangent.triggers.plist
- /Users/julianotto/Library/LaunchAgents/com.tangent.agent-shell.plist
- launchctl list (com.tangent.triggers, com.tangent.agent-shell)
- tmux ls; tmux display-message / capture-pane on trigger-speedrun--speedrun-pgande-7e780adf
- tangent trigger list [--json]; tangent process; tangent area show neara/pgande/speedrun; tangent goal list otto/tangent
- git -C ~/.tangent/trees log/ls-files/check-ignore for .processes.json and instruction files
