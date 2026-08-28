# Design record: a loop that sends a brain a message every N minutes

Date: 2026-08-28. Status: designed, not implemented. Intent: `user-intent.md`.

## Problem contract

Julian wants to set up a loop on a brain. Every N minutes, something outside the brain sends the brain one message. The message is the same each time. This is the shape of the Claude Code `/loop` command, applied to an Area brain instead of the current session.

Constraints, from Julian and from the repository:

- The loop targets one brain. A brain is one logical record per Area (ADR-0024, ADR-0033).
- The sender is outside the brain. A brain cannot wake itself between turns.
- Julian must see which brains have loops. This is a small mark, not a focal point.
- Tangent is notes plus a few CLI helpers, not machinery (ADR-0043, memory "notes, not machinery"). No new first-class runtime concept.
- Everything goes through the brain (ADR-0041). A loop must not start a worker.

Non-goals:

- A loop that runs a shell probe. That is a `when:` process and exists.
- A loop that starts a Goal. That is a `schedule:` process and exists.
- A loop on a worker. Workers only send (ADR-0040).
- A self-paced loop where the brain picks the next interval. Julian said "every N minutes".

Success conditions:

1. Julian writes one short note, and from then on the brain gets the message every N minutes while it runs.
2. The Work view and the Area page show that the brain has a loop.
3. `tangent process pause <slug>` stops it. `tangent process resume <slug>` restarts it. Erasing the note removes it.
4. No message piles up while the brain is away or busy.

## Current system

Observed, from the code:

- A process is a note, `<area>/process-<slug>.md` (ADR-0043). Its frontmatter carries `type: process`, `status: active|paused`, and either `schedule:` (calendar words) or `when:` (a shell probe) with `every:` (a duration). `parseProcessNote` rejects `every:` without `when:` (`packages/agent-shell/app/process-note.mjs`, the check "the frontmatter needs schedule: ... or when: ..."). `parseEvery` already accepts `s`, `m`, `h`, `d`.
- The Agent Shell server is the scheduler. `sweepProcesses` runs in a runtime scheduler lane every 10 s (`server.mjs:2173`). Run state is `~/.tangent/agent-shell/processes/<area>/<slug>.json`.
- When a process is due, the sweep calls `notify(area, dueNotice(note), { idempotencyKey })`. `dueNotice` is fixed text: `Process <slug> is due. Start it with: tangent goal create ...` (`process-scheduler.mjs:80-84`). The body of the note is the worker instruction, never the message to the brain.
- `notify` is `notifyBrain`, which calls `routeBrainNotice` (`server.mjs:4135-4165`). The notice is written to the Area inbox first (`brain-inbox.mjs`, at-least-once delivery). With a live brain it is queued to the composer and delivered when the composer is empty (`agent-messages.mjs`). With no live brain the notice waits in the inbox and is listed in the first message of the next generation. `routeBrainNotice` returns `addressed: true` only when a live brain took it.
- A due `when:` process is not probed again until the brain acted on the last note (`evaluateProcess`, the `lastNoticeAt` versus `lastGoalAt` rule). A due `schedule:` process is skipped while its Goal is open.
- The Area page shows a read-only Processes table: process, When, next run, last run, state (`area-directory-view.js:232-248`). `processView` supplies the words, including `Due, brain told` and `Due, brain not running` (`process-scheduler.mjs:202-223`).
- The Work view shows a `Processes due` section only for a due process whose brain is not running, with a Start brain button (`work-desk-view.js:1919-1934`).
- The Work group header row carries the one brain button per Area, `work-group-brain`, labelled Open, Resume, or Start brain (`work-desk-view.js:1577-1594`).
- `tangent area show` prints the Area's processes for the brain (`area.ts:131-140`). `vault-root-AGENTS.md:26` tells the brain how to write a process note when Julian asks.
- Two process notes exist in the vault, both `schedule:` or probe processes for worker jobs (`neara/pgande/process-rebase-pgande-staging.md`, `neara/pgande/speedrun/process-speedrun-pgande.md`).
- `tangent send <area-path> "<text>"` from a non-worker session already queues text to an Area brain (`send.ts`). A LaunchAgent could call it on a timer today, with no code change.

Observed, from history: routines were deleted (ADR-0029), the trigger runtime with its LaunchAgent was retired (ADR-0043), and the operating vision rejected "a process fire creates a Goal directly" and "`tangent process define`" (operating-vision record, rejected table). Each of the last three schedulers died because its definition lived outside the vault or ran outside the server.

## Internal precedent

The `when:` process is the closest thing to a loop: it already has `every:` and a 10 s sweep. The difference is what happens at the tick. A `when:` process runs a probe and, on exit 0, tells the brain to start a Goal. A loop skips the probe and sends the brain the body.

The `Processes` table and `tangent process list|show|pause|resume|check` already give a loop its listing, pause, resume, and check-now for free.

## External precedent

Claude Code `/loop <interval> <prompt>` re-sends one prompt to the session on a fixed interval. The user sees the loop in the task list. Stop is one command. The analogy holds because the brain is a long-lived session that reads its composer between turns, the same way the `/loop` prompt lands. The analogy stops at self-pacing: `/loop` without an interval lets the model pick the delay. Julian asked for a fixed N.

## Lens analysis

Selected lenses: UI/UX (a visible mark on the brain), Architecture and data (the note contract and scheduler state), Operations (ticks, missed ticks, busy composer). API and Migration were not selected: no new package boundary, and the one frontmatter change is additive.

### UI/UX

- The mark must be recognisable without reading. One small glyph next to the brain button on the Work group header row, present only when the Area has at least one active loop. The title on hover says `Loop every 20m: <first words of body>`. No new column, no new key, no new view.
- The Area page Processes table already shows every process. A loop row reads `Every 20m, to the brain` in the When column and `Loop` in the State column while the brain runs. Nothing else changes.
- Pause and resume stay CLI-only, as the table's hint line already says. A loop is not a focal point, so it earns no button.
- The `Processes due` section on Work never lists a loop. A loop waiting for a brain is a fact for the Area page, not an ask.

### Architecture, types, and data

- Definition lives in the vault note. Frontmatter: `type: process`, `status: active|paused`, `every: <duration>`, no `schedule:`, no `when:`. The body is the message. This is the third shape of one type, chosen by which keys are present, the same way `schedule:` and `when:` are chosen today.
- `parseProcessNote` gains one branch: `every:` alone is a loop. `note.loop = true`, `note.everyMs` set. `launch:`, `path:`, and `verify:` are meaningless for a loop; the parser reports them as a broken note so a mis-typed `when:` line is not silently read as a loop.
- State file gains `lastDeliveredAt`. The sweep's `notify` must return whether a live brain took the notice. `routeBrainNotice` already returns `addressed`. `notifyBrain` returns it. No new file, no new schema version: the state file has no schema field today.
- The Goal-based fields (`lastGoalAt`, `lastGoalFile`) stay null for a loop. `goalNamesProcess` is never consulted for a loop.

### Operations

- Tick rule: a loop is due when `now - lastNoticeAt >= everyMs` and the last notice was delivered, or when it never fired. The first tick fires on the first sweep after the note is seen and a brain lives. This matches `/loop`, which fires at once.
- No brain: the loop does not fire. Reason `brain not running`. State word `Waiting for brain`. A heartbeat to an absent brain is noise on its return, and the inbox digest would list every missed tick.
- Brain busy (composer holds text or the brain is mid-turn with no empty composer): the notice is queued by `queueBrainNotice` and delivered when the composer empties. The loop counts it as sent. The next tick waits until that notice is delivered, so at most one loop message is in flight. This is the `/loop` behaviour: a tick that cannot land waits, it does not stack.
- Idempotency key: `process:<area>:<slug>:<tick ISO>`, the existing pattern.
- Diagnosis: `tangent process check <slug>` prints the reason line. `lastReason` already exists.
- Server restart: `lastNoticeAt` is on disk. The first sweep after restart fires when the interval has passed. A notice queued but undelivered at the crash is in the inbox and is delivered to the next generation, the inbox's normal at-least-once path.

## Candidate designs

### A. A loop is a process note with `every:` alone (selected)

Add one shape to the existing note type. The scheduler sends the body to the brain every N minutes while the brain runs.

- Cost: about 60 lines across `process-note.mjs`, `process-scheduler.mjs`, `server.mjs` (return delivered), `area-directory-view.js`, `work-desk-view.js`, `area.ts`, `vault-root-AGENTS.md`, tests. One ADR-0043 amendment.
- Reuses: sweep, state files, pause and resume, check, the Area table, `tangent area show`, the inbox.
- Visible in git history and Obsidian.

### B. A runtime loop record, `tangent loop create <area> --every 20m "<text>"`

A new JSON record under `~/.tangent/agent-shell/loops/`, a new CLI verb, a new list in the UI.

- Cost: a new concept, a new store, a new CLI command, a new table.
- Rejected. It is the routine and trigger machinery again (ADR-0029, ADR-0043). The definition would not be in the vault. Julian rejected `tangent process define` in the operating vision for the same reason.

### C. A LaunchAgent that runs `tangent send <area> "<text>"` on a timer

Works today with no code. `tangent send` from a non-worker queues to the Area brain.

- Rejected as the design. Nothing in Tangent knows the loop exists, so nothing can show it on the brain, pause it, or stop two of them stacking while the brain is away. ADR-0043 retired the last LaunchAgent scheduler because the server is the scheduler. Kept as a stopgap Julian can use before A ships.

### D. `/loop` inside the brain harness

Rejected. The brain would loop itself, and a brain restart or generation handover loses the loop. Julian asked for something external. Not every harness has `/loop`.

## Evidence and counterexamples

- Counterexample to "reuse the `when:` wait rule": that rule waits on a Goal. A loop has no Goal. The wait must key on delivery instead. This is why `lastDeliveredAt` is added rather than reusing `lastGoalAt`.
- Counterexample to "the note waits for the brain like a scheduled process": the `schedule:` design chose a waiting note because a missed daily job is work owed. A missed heartbeat is not work owed. Hence the loop does not fire without a brain.
- Failed generalization: "make `every:` mean loop for every process". `when:` plus `every:` already means poll the probe. The meaning of `every:` stays "the interval"; the presence of `when:` decides whether a probe runs.
- Weak evidence: no loop note exists yet, so there is no measured interval. `/loop` clamps to 60 s minimum. The parser accepts `30s`. Decision 6 below sets a floor.

## Decisions

1. **A loop is a process note with `every:` and no `schedule:` or `when:`.** The body is the message. Shape chosen by keys present, as today. Decisive: ADR-0043 and the operating vision say repeatable work is a note. Candidate A.
2. **The scheduler sends the body, not a start command.** Message text: `Loop <slug> (every <every>): <body>`. The prefix lets the brain recognise the loop and pause it with `tangent process pause <slug>`.
3. **A loop fires only while a brain lives.** No brain means no notice, reason `brain not running`, state `Waiting for brain`. Decisive: a pile of stale heartbeats in the inbox digest is noise.
4. **At most one loop message in flight.** The next tick waits until the last notice was delivered. `notifyBrain` returns `addressed`; the sweep stores `lastDeliveredAt` when true.
5. **The mark is one glyph on the Work group header brain button and `Loop` in the Area Processes table.** Glyph `↻` after the brain button text, class `work-group-loop`, title `Loop every 20m: <first words>`. Shown only for `status: active` loops. Not on the `Processes due` section, not a column, not a key.
6. **Floor of 1 minute.** `every: 30s` on a loop is a broken note: `a loop runs every 1m or slower`. The 10 s sweep makes shorter loops jitter, and a brain turn is longer than that. `when:` probes keep their current freedom.
7. **`launch:`, `path:`, `verify:` on a loop are a broken note.** A mis-typed `when:` must not turn a worker job into a heartbeat.
8. **No create command.** Julian or the brain writes the note. `vault-root-AGENTS.md` gains one sentence: a loop is `process-<slug>.md` with `every:` alone and the message as the body. Decisive: D16 "no define command".
9. **ADR-0043 is amended, not replaced.** One paragraph: the third shape.

## Rejected alternatives

- Candidate B (runtime loop record): strongest alternative, because it gives a one-line create command like `/loop`. Lost because the definition leaves the vault and re-creates deleted machinery.
- Candidate C (LaunchAgent plus `tangent send`): lost because nothing shows it and nothing stops stacking. Usable today as a stopgap.
- Candidate D (`/loop` in the brain): lost because it is not external and dies with the generation.
- A loop that waits like a scheduled process: lost, see counterexamples.
- Self-paced loops (`every: auto`): lost, Julian asked for N minutes, and the brain can already `tangent process pause` when the loop is not useful.
- A loop row on the Work view: lost, Julian said not a focal point.

## Risks, assumptions, unknowns

- Assumption: `notifyBrain` can return `addressed` to the sweep without changing other callers. Observed: it already returns the boolean and every other caller ignores it.
- Assumption: a delivered notice is what `deliveredAt` in the inbox means, and `addressed: true` implies queued to a live composer, which is delivered when empty. If a queued notice can be lost before delivery, the loop would wait forever. Mitigation: the tick also fires when `now - lastNoticeAt >= 3 * everyMs`, so a lost delivery costs three intervals, not the loop.
- Unknown: whether Julian wants the brain to be able to write its own loop. The design allows it (a brain writes notes). Nothing prevents it.
- Risk: a brain that answers every tick with a long turn never has an empty composer, so ticks queue behind turns. This is the `/loop` behaviour and is accepted.
- Reconsider when: a loop needs a probe and a message (then `when:` gets a `message:` key), or when a loop should start a Goal (then it is a `schedule:` process and exists).

## Sources

- `packages/agent-shell/app/process-note.mjs`, `process-scheduler.mjs`, `brain-inbox.mjs`, `agent-messages.mjs`
- `packages/agent-shell/app/server.mjs:2173, 4135-4165, 4235`
- `packages/agent-shell/app/public/area-directory-view.js:226-248`, `work-desk-view.js:1550-1600, 1912-1935`
- `packages/agent-shell/src/cli/commands/process.ts`, `send.ts`, `area.ts:126-140`
- `packages/agent-shell/app/vault-root-AGENTS.md:26`
- `docs/decisions/ADR-0029-remove-threads-and-routines.md`, `ADR-0030-area-triggers.md`, `ADR-0043-processes-are-notes.md`
- `docs/design/agent-shell-operating-vision/design-record.md` D16 to D19
