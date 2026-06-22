# Tangent Command & Control: Spec + Hill-Climb Goals

Purpose: rebuild the Trees UI into a single-focus command-and-control center. The screen always shows what Julian has his attention on right now; everything else either is that focus or waits in an Incoming lane with a defined time it returns.

This doc is both the implementation specification (Part A) and the measurable goals an agent can hill-climb with end-to-end + screenshot tests (Part B). Part C is how to measure.

The invariant, stated once: **every task is either the Focus, or in Incoming with a return-time attached. Nothing exists without being your attention now or having a defined moment it returns to it.**

---

## Part A: Implementation specification

### A1. Scope and non-goals

In scope:
- New default view: the Focus center, replacing the tree-first main screen in `packages/trees-ui/src/App.svelte`.
- New append-only event log for tasks, focus segments, check-ins (the spine).
- Watching C&C-launched agents via their transcript files (no provider hooks).
- The check-in mechanism (scheduled change of focus).
- Rollup: gather an entity's free-text notes.

Non-goals (explicitly cut for v1):
- No feature-request entity type. Captured as free text, surfaced in rollup.
- No discovering/claiming agents started outside tangent. C&C-launched only.
- No LLM in the core loop. Every operation is manual and deterministic. (An optional "summarize rollup" button may be added later; the system works fully without it.)
- Do not extend or revive the dormant `WorkSession`/`Checkpoint`/`Capture` model in `trees-schema`. Leave it untouched.
- Do not add command grammar beyond starting/opening a task (see A5). Every other action is a control in the task UI.

### A2. Data model

One new append-only JSONL, matching the existing `~/.tangent/...` JSONL pattern:

`~/.tangent/focus/events.jsonl`

Event types (one object per line, all carry `ts` epoch-ms and `taskId`):

```
task_started   { id, entity, intent, outcome?, estimateMin, ts }
focus_on       { taskId, ts }            // becomes the Focus; auto-emits focus_off for the prior focus
focus_off      { taskId, ts }            // parked / dispatched / switched away
note_added     { taskId, text, ts }      // free text, stored verbatim
checkin_set    { taskId, dueAt, ts }     // when this task should return to attention
agent_dispatched { taskId, sessionId, adapter, transcriptPath, ts }
task_done      { taskId, note?, ts }
task_dropped   { taskId, note?, ts }     // stopped early, outcome not hit
```

Task is a **projection** over these events (follow the existing `trees-core/src/projection.ts` rebuild pattern). Derived task fields:

```
Task = {
  id, entity, intent, outcome?, estimateMin,
  status: 'focus' | 'parked' | 'watching' | 'done' | 'dropped',
  notes: string[],                       // resources = notes containing URLs
  checkinAt?: number,                    // from latest checkin_set
  agent?: { sessionId, adapter, transcriptPath, status },
  startedAt, doneAt?,
  focusSegments: [{ on, off? }],         // from focus_on/off pairs
  actualMin                              // wall-clock startedAt -> doneAt (the bet's actual)
}
```

All the requested views are queries over this one log, no extra storage:
- Current focus: the single task whose latest event is `focus_on` with no later `focus_off`.
- Switch count (today): number of `focus_on` events where the prior focus was a different task.
- Daily timeline: all `focusSegments` today, grouped/colored by entity.
- Estimate vs actual: `estimateMin` vs `actualMin` (wall-clock to done).

Reuse, do not reinvent:
- `@tangent/launcher` opens agent sessions (unchanged).
- `@tangent/usage` for reading transcript files (agent status).
- `trees-schema` `TreeEntity` stays as the entity tasks attach to (`entity` is a TreeEntity path).
- `worklog.json` becomes legacy/derived. Do not write new code against it.

### A3. Base tangent trees changes

- `trees-ui` App: Focus center becomes the default route. The existing tree builder/inspector moves to a secondary "Trees" tab (the filing cabinet). Nothing deleted.
- Remove session rows injected beneath entities in the tree (current `App.svelte` tree render). Agents never appear in the tree.
- Entity stays the unit tasks attach to. `/entity` navigation (type + TAB-complete) is the only command-bar grammar.
- Rollup becomes an action on an entity: concatenate, in time order, all `note_added` text and `task_done`/`task_dropped` notes across that entity's tasks, plus the bet results. Output is a plain-text/markdown note. No LLM.

### A4. Agent watching (transcript-based, no hooks)

On `agent_dispatched`, record `transcriptPath` (resolve from the launched cwd via the project dir convention `usage` already uses; pick the newest transcript created after dispatch `ts`).

Derive `agent.status` by reading that transcript file (pragmatic heuristic):
- `running`: file modified within the last poll window and last turn is not awaiting input.
- `waiting`: last turn is an assistant turn awaiting a tool/permission/user reply.
- `done`: launcher session is gone (`tmux has-session` false / iTerm2 gone) and transcript has ended.
- `unknown`: no transcript resolved.

```
// ponytail: file-tail heuristic for agent state. Upgrade to a structured transcript
// reader in @tangent/usage if waiting/done detection proves unreliable.
```

A watched task surfaces (joins the "due" set) when EITHER its `checkinAt` passes OR `agent.status` becomes `waiting`/`done`. A still-`running` agent never interrupts.

### A5. UI/UX specification

Two zones, nothing else. One dominant focal point per the UX guardrail.

```
┌───────────────────────────────────────────────┐
│  command bar:  /entity ⇥  + what you're doing  │  ← only grammar: start/open a task
├───────────────────────────────────────────────┤
│  FOCUS  (dominant: largest area, highest        │
│  contrast, live timer)                          │
│   entity · intent · bet(outcome, time)          │
│   ⏱ elapsed / estimate                          │
│   [ done ]  [ dispatch agent ]  [ park… ]  …    │  ← every non-start action is a button here
├───────────────────────────────────────────────┤
│  INCOMING  (thin, quiet, subordinate)           │
│   parked tasks + watched agents,                │
│   each with status + return countdown           │
└───────────────────────────────────────────────┘
```

Command bar: the ONLY typed command is starting/opening a task. `/` picks entity (fuzzy, TAB-complete, creates if new), then free text is the intent, plus a time. Enter commits. Time is never optional (the bet rule). Everything else (notes, done, drop, check-in, dispatch, rollup) is a visible control in the task UI. Recognition over recall.

Focus card: one per view, dominant. Primary action (done) is the largest button (Fitts). Destructive (drop) is separated. Notes are a free-text append field on the card.

Park / switch: starting a new Focus while one is live parks the current one and **always asks "bring this back when?"** with one-tap answers (15m / 30m / 1h / done). This is the seatbelt: no task can leave Focus without a return-time. This is how "focus on something else" works.

Dispatch agent: one action on the Focus card. The task **stays in focus** with the agent running in the background (the card shows the agent's status); dispatching does not change focus. The task only leaves focus when you park it or switch to another task, at which point it becomes `watching` and can vie for your attention (via check-in or agent-done), never auto-stealing focus.

Check-in due (the core moment): a check-in is a **scheduled change of focus**, not a passive badge. When `checkinAt` passes (or the watched agent goes `waiting`/`done`), a band rises over Focus, the highest-prominence interactive element on screen:

```
⏰ You wanted to check: <intent>
   status: <running ~x% ctx | waiting for you | ✅ done · N files>
   [ Make this my focus ]        [ snooze 15m ]
```

Two large targets. If the agent is still `running`, the band states "no input needed" and snooze is the obvious tap. A scheduled check-in finding nothing to do is valid; snoozing must be as cheap as acting.

Agent self-signal (no check-in set): brightens quietly in Incoming, escalates if ignored, never yanks Focus. Interruption proportional to risk.

Close the loop: marking done shows the bet result inline immediately: `predicted <outcome> in 2h · took 2h40 · ✅ hit` (or `✗ missed`). Outcomes legible right after the action. A second action, **"Done · don't know when"**, marks the task done but records no actual time, for the common case where you finished earlier and forgot to mark it (wall-clock would be meaningless). Such tasks show `finished, time unknown` and are excluded from estimate-vs-actual accuracy rather than polluting it with a guess.

States to implement for every interactive element: default, hover, focus-visible, active, loading, success, empty, error, disabled. WCAG 2.2 AA, keyboard access, focus order, reduced motion.

---

## Part B: Measurable goals (hill-climb targets)

Each goal has an ID, a target, and a measurement method. An agent runs the app (`tangent ui`), drives `trees-ui` with Playwright / chrome-devtools, and validates. "Action" = one click/tap or one committed keystroke group. End-states are asserted via DOM/screenshot so action-count cannot be gamed by skipping the outcome.

### B1. Action-cost goals (clicks/keystrokes from A to B)

| ID | Flow | Target | Baseline (current Trees UI) | Measure |
|----|------|--------|------------------------------|---------|
| G1 | App load → a running, focused task | 0 mouse clicks; 1 Enter commits (type entity, intent, time inline) | ~6-8 actions + tree navigation | Script the minimal flow; assert Focus card with running timer; count actions |
| G2 | Switch focus to a new task + set check-in on the parked one | ≤ 2 clicks beyond typing the new task | n/a (no concept today) | Assert old task in Incoming with `checkinAt`; new task is Focus; count actions |
| G3 | Dispatch an agent from the Focus card | ≤ 2 clicks | ~5+ (select entity, configure, open) | Assert task stays in focus with the agent attached (`transcriptDir` recorded); not moved to Incoming; count actions |
| G4 | Respond to a due check-in (make it Focus) | 1 click | n/a | Assert prior watched task is now Focus; count actions |
| G5 | Mark current task done with a note | ≤ 2 clicks | ~3 (select session, fill actual, submit) | Assert `task_done` emitted, bet result visible; count actions |
| G6 | Roll up an entity | ≤ 2 clicks | n/a | Assert rollup output contains that entity's note text; count actions |

### B2. Visibility goals (screenshot / DOM assertions)

| ID | State | Assertion |
|----|-------|-----------|
| G7 | Any state with an active task | Exactly one Focus region. Its bounding box is the largest content area and the highest-contrast block. No other card exceeds it (a due check-in band is the only allowed exception). |
| G8 | Any state | The Trees/tree view contains zero agent or session nodes (assert no such DOM nodes). |
| G9 | Incoming lane populated | Each Incoming item shows entity, status, and a return countdown (or "due now"). |
| G10 | Check-in due | The check-in band is present, top-most, and the highest-prominence interactive element; both `Make this my focus` and `snooze` targets meet minimum target size. |
| G11 | Immediately after marking done | The bet-result line (`predicted … in X · took Y · hit/missed`) is visible in the Focus card. |
| G12 | A running (not waiting/done) agent exists | No interruption band is shown; the agent sits quietly in Incoming. |

### B3. Invariant goals (state/data, asserted over the event log)

| ID | Invariant | Check |
|----|-----------|-------|
| G13 | At most one task in `focus` status at any instant | Project the log after any flow; assert ≤ 1 `status==focus` |
| G14 | No parked/watching task without a return-time | Every non-`focus`, non-terminal task has a `checkinAt` (parked) or an `agent` (watching). No task in limbo. |
| G15 | Switching emits `focus_off(old)` + `focus_on(new)` and increments today's switch count | Drive 3 switches; assert switch count == 3 |
| G16 | Daily timeline reconstructs from events | Sum of a task's `focusSegments` equals its attributed timeline duration; per-entity totals match |
| G17 | Estimate vs actual present on every done task | Each `task_done` task exposes `estimateMin` and wall-clock `actualMin`; a task marked "done, don't know when" records `actualMin` as unknown (excluded from accuracy) instead of a guess |

### B4. Performance goals

| ID | Metric | Target |
|----|--------|--------|
| G18 | App load → Focus view interactive | < 500 ms on a warm dev server |
| G19 | Check-in fires after `dueAt` | Surfaces within ≤ 5 s of the scheduled time (poll window) |
| G20 | Agent status reflects transcript change | `done`/`waiting` reflected within ≤ 5 s |

---

## Part C: How to measure (test harness)

- Launch with `tangent ui` (combined UI). Drive `trees-ui` via Playwright or chrome-devtools MCP.
- Seed `~/.tangent/focus/events.jsonl` with fixtures for state-dependent goals (e.g. a due check-in, a watching agent) so screenshots are deterministic. Use a temp `TANGENT` home to avoid touching real data.
- Action-cost (B1): write the minimal script that reaches the asserted end-state; the metric is the count of clicks + committed keystroke groups that script issues. Hill-climb = reduce count while the end-state assertion still passes.
- Visibility (B2): assert via DOM rects + computed styles (area, contrast) and capture a screenshot per state for regression.
- Invariants (B3): after each flow, re-read and project the event log; assert directly.
- Performance (B4): chrome-devtools performance trace / timestamps.

Each goal is independently checkable, so the agent can hill-climb them one at a time and report a per-goal pass/score.
