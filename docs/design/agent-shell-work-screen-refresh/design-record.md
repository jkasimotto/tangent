# Work screen refresh: design record

Status: designed, not implemented. Date: 2026-08-28.

Lens: UI/UX only. No persistence, API, or server contract changes. Every change is a projection change in `packages/agent-shell/app/public/` (`work-desk-view.js`, `work-commands.js`, `shell.css`) and its tests.

Companion: [user-intent.md](user-intent.md). Parent designs: [work contract](../agent-shell-work-contract/design-record.md), [navigation model](../agent-shell-navigation-model/design-record.md), [compressed hierarchy](../agent-shell-compressed-work-hierarchy.md), [affordances](../work-view-affordances/design-record.md), [sub-Areas](../work-view-sub-areas/design-record.md).

## 1. Problem contract

Julian scans Work to answer one question per row: is it moving, or does it wait for me, and for how long. The screen answers that today, but it prints each answer two or three times, and it prints facts that do not change a decision. The two supplied screenshots (two Goals, three Areas) use about 430 px of height and repeat the launch string three times on one row.

Constraints:

- Keep every key that exists today, and keep it printed on the screen (ADR-0038, work contract decisions 44 to 48).
- Keep the one command registry as the source of every key and label (`work-commands.js`).
- Keep the table semantics: one `<table>`, one `<tbody>` per Area, `<tr>` rows at every width (work contract, "Narrow-width behavior").
- Keep the state-owned `?` sheet and the `⋯` route into it (decision 48).
- Do not change what a Goal, a queue, or a brain is.

Non-goals: the Goal reader, the Area page, the launch editor, search, the `?` sheet, the process sections below the table.

Success conditions (observable):

1. The two-Goal fixture from the screenshots renders in at most 60 percent of today's height from the caption to the last row.
2. Each fact prints once per row at every width: the launch string, the step, the state word, the elapsed time.
3. No colour-only element remains. The bar is gone.
4. Every key printed today is printed after the change, on the caption line, on a row control, or in the `?` sheet.
5. Every state word has a one-sentence hover title.
6. "moving", "lines", "Current N days old", and "Brain waiting for you" do not appear on Work.

## 2. Current system (observed)

### 2.1 What one Area header prints

`workGroupHeaderRow` (`work-desk-view.js:1636`) prints, left to right: fold triangle, name button, star, `deskAreaSummary` text, the note signal, the state pill, then in the controls column the brain button (`Open brain b`) and the `⋯ ?` menu trigger.

- `deskAreaSummary` (`:975`) prints `N open · N moving · N blockers · N questions`. "moving" counts sessions with `state === "working"`.
- `deskAreaState` (`:989`) prints the pill. Rank: questions, then `N working`, then the live brain's word, then `N Goals ready`, then `Reference Area`. "working" counts the same sessions as "moving". So `1 moving` and `1 working` are one number printed twice with two words. That is the "moving versus working" confusion.
- The note signal (`area-note-links.mjs:143`) is `N lines · Current N days old | no Current | Current age unknown`, orange past 100 lines or 14 days. It is a note-hygiene reminder for the brain's memory file. The Area page prints the same signal (`area-directory-view.js:268`). Julian: not useful on Work.
- `brainStateLabel` (`:465`) prints `Brain waiting for you` when a live brain sits at an empty composer with no decision pending. That is the normal resting state of a brain between turns (pane-state.mjs: static screen, empty composer). It asks nothing of Julian. `Brain needs a decision`, `Brain did not start`, `Brain has a problem`, and `Brain recovering` are real conditions.

### 2.2 What one Goal row prints

`workGoalRow` (`:1731`) prints four cells:

- Work: fold space, title, then `agentMeta` = `<agent name> · <launch>` (line 2), then `stepMeta` = `Step i of n · <step label>` (line 3). The step label is the launch again in words (`Pi Code · GLM 5.2 · Extra high`).
- State: one word from `deskPipelineAction` or `deskGoalAction` (`Working`, `Waiting for you`, `Needs your decision`, `Ready`, `Check it`, `Complete`, ...).
- Time: elapsed label (`45m`, first start to now) and the bar (`deskGoalBar`, `:1506`). The bar's length is elapsed relative to the longest Goal on the desk, sqrt curve. Its blue and amber split is worked against current wait.
- Action: `desk-launch-ref`, the launch string a third time, as a button that enters the run, printed with the `↵` key. Then `⋯ ?`.

Observed defect: the launch-ref button prints `↵`, but Enter on the row runs `openWorkRow` (`shell-event-bindings.js:825`), which clicks the title and opens the Goal reader. The registry says `open ↵` reads the Goal and `session ⌘⇧↵` enters the agent. The row teaches the wrong key.

### 2.3 What sits above the table

`renderWork` (`:2086`) prints `.work-tools`: four 46 px buttons (`Starred F`, `Active A`, `Search rows /`, `Keys ?`) with a 32 px bottom margin. The caption line below it already prints `WORK · 2 Goals` and the cursor-following key line, which includes `/ search` and `? all` on Area rows. The `<thead>` prints `WORK STATE TIME ACTION`, so the word Work appears twice within 30 px.

### 2.4 Widths

`shell.css:522` fixes State 156 px, Time 150 px, Action 196 px. Breakpoints: 959 px hides the bar and shrinks columns; 639 px collapses State and Time into `.work-cell-facts` under the title and hides the key line.

### 2.5 The bar's history

The bar was removed in the compressed-hierarchy design (2026-08-24, decision 3: "absolute elapsed text and remove the bar"), came back in compact-work-desk (Julian's word 2026-08-20, relative length), and the elapsed text returned beside it on 2026-08-22. Julian now says the bar is colour only. Three reversals mean the bar has no stable meaning to him. This record removes it and records why, so it does not return without a new reason.

### 2.6 Tests that pin the current shape

- `work-table-ui.test.mjs:63` and `:695-720`: bar aria-label and the 54 + 8 + 68 px Time geometry.
- `work-area-note-signal-ui.test.mjs`: the note signal on Work headers.
- `work-table-ui.test.mjs:743-748`, `focus-shell-desk-hierarchy-ui.test.mjs:76`, `focus-shell-goal-brain-ui.test.mjs:100`, `work-sub-area-headers-ui.test.mjs:271`: `Open brain` long label and `Brain waiting for you` pill.
- `brain-wake-needs-message-ui.test.mjs:96-109`, `focus-shell-work-navigation-ui.test.mjs:386`, `area-star-ui.test.mjs:34`: `.work-tools`, `[data-work-keys]`, `[data-starred-only]`.
- `work-table-ui.test.mjs:342-346`, `focus-shell-live-step-ui.test.mjs:70-110`: `.work-row-agent` and `.work-row-step` text.
- `work-view-affordances-ui.test.mjs:29-126`: the caption key line follows the cursor.

## 3. Internal precedent

- The Area page prints the note signal and the full brain state. Work can drop both and lose nothing, because `b` and the Area name are one key away.
- The narrow layout already merges state and time into one text line (`.work-cell-facts`). The wide layout can use the same merge.
- The registry already has `session ⌘⇧↵` with the help text "Open the live agent, step, or brain for this row". The row only has to print it.
- `work-view-affordances` D6 put the keys on the caption line so they follow the cursor. That line is the place for the four toolbar toggles too.

## 4. Decisions

### D1. Remove the note signal from Work

Delete the `work-group-note` span. The Area page keeps `area-note-signal`. The server keeps computing `noteSignal`. Rationale: the signal is about the brain's memory file, not about work; Julian read it as noise.

### D2. One word for a running agent: "working"

`deskAreaSummary` prints `N open`, `N blockers`, `N questions` only. Delete the `moving` part. The pill keeps `N working`. Rationale: two words for one count is the confusion; the pill's word matches the Goal row's `Working`.

### D3. The Area pill speaks only when the Area needs Julian or moves

Pill rank, unchanged where it is not listed:

1. `N questions` (amber, opens the review).
2. `N working` (blue).
3. Live brain, only these: `Brain needs a decision` (amber, opens the brain), `Brain did not start`, `Brain has a problem`, `Brain recovering`. A live brain that works with no agent prints `Brain working`.
4. A live brain at an empty composer prints nothing. The header row still exists for it (2026-08-26 rule), with the brain control at the row end.
5. `N Goals ready`, then nothing. `Reference Area` is removed; an Area with no work and no brain prints only its count.

`brainStateLabel` keeps `Brain waiting for you` for the Area page and hover titles; `deskAreaState` stops returning it.

### D4. Remove the Action column; row-end controls appear on the cursor row, hover, and focus

Delete `WORK_COLUMNS.action` and `workActionCell`. Move the two row-end controls into the last cell of the row:

- Area row: `brain b` (short text, no `Open`/`Resume`/`Start` prefix; the verb lives in the title and aria-label) and `⋯ ?`.
- Goal row: `⋯ ?` only. The run entry moves into the Agent cell (D5).

CSS: `.work-row-controls { visibility: hidden }` and visible on `tr.cursor`, `tr:hover`, and `tr:focus-within`. The buttons stay in the DOM and in the accessibility tree; `visibility: hidden` removes them from the tree, so use `opacity: 0` plus `pointer-events: none` instead, and restore both on the three selectors. Rationale: every verb keeps a visible control with its key on the row the eye is on (mouse parity from the navigation design), and the standing chrome that Julian called redundant leaves the resting screen.

### D5. One Agent cell replaces three launch copies, and prints the right key

The Goal row has three cells: Goal, Agent, Status.

Agent cell content, one line: `<agent name> · <launch> · step i/n` as one button that enters the run, printed with `⌘⇧↵`. Example: `Pi Code · pi-code/glm-5-2/xhigh · 1/4 ⌘⇧↵`. The hover title carries the step instruction (today's `stepTitle`) and the cwd. A Goal with no agent prints `—` and no key. A finished run prints the last launch in the muted colour with no key.

Delete `work-row-agent`, `work-row-step`, and `desk-launch-ref`. The `↵` on the run entry was wrong (section 2.2); `⌘⇧↵` is the registered key, and the Goal reader keeps plain `↵`.

### D6. Status cell merges state and time, and the bar is gone

Status cell content: `<state word> · <elapsed>`. Example: `Working · 45m`, `Waiting for you · 2h 05m`, `Ready`. The elapsed hover keeps `Started <date>`; the wait hover keeps the reason (`waitReason`). Delete `deskGoalBar`, `deskMaxElapsedMs`, `factsBarShares`, `elapsedLengthShare`, and the bar CSS. `goal-card-core.js` keeps `durationLabel`, `elapsedLabel`, `goalCardFacts`, and `factsSegments`.

Every state word gets a `title` from one table in `work-desk-view.js`:

| Word | Title |
|---|---|
| Working | The agent is producing output now. |
| Waiting for you | The agent stopped at its prompt and needs your next message. |
| Needs your decision | The agent shows a choice only you can make. |
| Finished · ready for you | The agent reported done. Read it and close the Goal. |
| Holding your draft | You typed a message there and did not send it. |
| Agent did not start | The session opened but no agent runs in it. |
| Ready | No agent runs. Enter starts one. |
| Check it | You asked to verify this yourself. |
| Complete | Done. |

Rationale: the bar encoded a ratio no decision needs (section 2.5); the number is what Julian reads. One cell for one question ("moving, or waiting, and how long") matches the card's stated purpose (`goal-card-core.js:4`).

### D7. The toolbar folds into the caption line

Delete `.work-tools`. The caption line becomes: `WORK · 2 Goals · ☆ Starred 1 F · ● Active 4 A` on the left and the cursor key line on the right. The four controls keep their data attributes (`data-starred-only`, `data-active-only`, `data-work-search`, `data-work-keys`) as small caption buttons; `Search rows /` and `Keys ?` render only in the right-hand key line, where every row kind already prints `/ search` and `? all` (add `search` and `keys` to the `goal` and `definition` caption sets). The key line entries become buttons that run the command on click; today they are `aria-hidden` spans.

Height: the caption line is 24 px with an 8 px gap to the header row. Today's toolbar plus margin is 78 px.

### D8. Column set and widths by viewport

Columns: `Goal` (auto, min 280 px), `Agent` (260 px), `Status` (190 px), controls (56 px, no header). The `<thead>` prints `GOAL AGENT STATUS`; the caption keeps `WORK`, so the word appears once.

- 1200 px and wider: four cells as above. A Goal row is one line, 34 px.
- 640 to 1199 px: the Agent cell moves under the title as line 2 (`display: block` of the same markup via CSS grid order; the `<td>` gets zero width like today's 639 px rule). Rows are two lines, 48 px.
- Below 640 px: Status also collapses into the facts line under the title, as today. The Area brain control prints `brain` only. The key line hides, as today; `?` still opens the sheet.

Spacing rhythm: header row 28 px, Goal row 34 or 48 px, sub-Area row 26 px, 10 px horizontal cell padding everywhere, 8 px between caption and table. The identity line of the header uses one 10 px gap between name, star, count, and pill.

### D9. Keyboard discoverability is unchanged in substance

- The caption key line follows the cursor (work-view-affordances D6) and now also lists `/` and `?` on Goal rows.
- Each visible control prints its key with the shared `kbd` style.
- `?` opens the one sheet for the cursor row. Its rows do not change.
- New teaching: `⌘⇧↵` is printed on the Agent cell of every running row. Today it is printed nowhere on the table.

## 5. Workflow trace

Julian opens Work with the two-Goal state from the screenshot.

1. He sees three header rows and two Goal rows in about 200 px. Neara: `1 open · ● 1 working`. Launcher: `0 open`. Tangent: `1 open · ● 1 working`.
2. `j` moves to the Tangent Goal. The caption line prints `↵ open · o read · b brain · f star · x status · c agent · r resume · h/l fold · / search · ? all`. The row's `⋯ ?` fades in at the row end.
3. The Agent cell reads `Codex · codex/sol/low · 2/2 ⌘⇧↵`. He presses `⌘⇧↵` and enters the agent. The same key comes back.
4. The Status cell reads `Working · 6m`. After the agent stops it reads `Finished · ready for you · 9m` with the hover explaining the word.
5. With the mouse, he hovers the Neara row; `brain b` and `⋯ ?` appear. He clicks `brain`.

## 6. Rejected alternatives

- **Keep the Action column and only drop the launch text.** Loses the width the Agent cell needs at 1200 px and keeps `Open brain` on every header, which Julian named as redundant.
- **Always-visible `⋯` on every row.** Matches the navigation design's "every row a pointer target" more literally, but it is the chrome Julian objects to. Hover, cursor, and focus reveal keeps the target and removes the resting noise. Flagged as the one open question.
- **Move Starred and Active into the `?` sheet only.** Hides a two-state filter whose current state must stay visible (UI/UX lens: scope must remain visible). The caption toggles keep the state on screen.
- **Replace the bar with a relative age colour on the elapsed number.** Colour alone again. Rejected by the existing rule "a status is never colour alone".
- **Show `done_when` on the row to use the width.** Adds reading. The width goes to a one-line row instead.

## 7. Risks, assumptions, unknowns

- Assumption: hover reveal of row controls satisfies Julian's mouse use. If not, print `⋯` always and keep `brain` on reveal. Ask him at implementation review.
- Risk: `focus-shell-goal-brain-ui.test.mjs:171-180` builds the `Open brain` button by hand; its aria-label contract (`Open brain for <Area>`) stays, only the visible text shortens.
- Risk: the 639 px rule uses `visibility: hidden` on cells; the reveal rule in D4 must not reuse `visibility` or the narrow layout hides the controls for good. D4 uses opacity.
- Unknown: the exact 1200 px threshold. Measure with the longest launch label in the registry (`claude-otto/fable-5/medium`, 26 characters) and the longest state (`Finished · ready for you · 365d 23h`).

## 8. Implementation and proof (for step 2)

Files: `work-desk-view.js` (`deskAreaSummary`, `deskAreaState`, `workGroupHeaderRow`, `workGoalRow`, `workDefinitionRow`, `workStateCell`, `workTimeCell`, `workActionCell`, `WORK_COLUMNS`, `renderWork`, `workCaptionHint`), `work-commands.js` (caption sets), `goal-card-core.js` (delete bar functions), `shell.css` (sections at lines 345, 425-460, 500-670).

Tests to change: the ones in section 2.6. Tests to add:

- `work-table-ui`: each launch string appears exactly once per row; no `.desk-goal-bar`; Status cell text matches `/^\S.* · \d/` for a started Goal; every `.desk-state` has a non-empty `title`.
- `work-table-ui`: the Agent cell button prints `⌘⇧↵` and carries `data-open-goal-run`; no element in the table prints `↵` beside a run route.
- `work-area-note-signal-ui`: Work prints no `.area-note-signal`; the Area page still does.
- `work-table-ui` brain rows: an idle live brain prints a header with a `brain` control and no pill; a brain with `stateDetail: "decision"` prints `Brain needs a decision`.
- `work-view-affordances-ui`: the caption contains `[data-starred-only]`, `[data-active-only]`; `.work-tools` does not exist; the Goal caption set includes `/` and `?`.
- CSS assertion: `.work-row-controls` uses `opacity`, not `visibility`.

Visual proof (verify-app skill, chrome-devtools): screenshots at 1600, 1000, and 600 px of the two-Goal fixture; measure caption-to-last-row height at 1600 px against the current build and assert the 60 percent condition; tab through one Goal row and confirm the controls appear on focus.

Validation: `npm run check`, `npm run test`, `npm run governance`, then rebuild and restart the server on port 4321.

## 9. Sources

- `packages/agent-shell/app/public/work-desk-view.js` lines 45, 465-500, 975-1010, 1487-1560, 1636-1760, 2048-2112
- `packages/agent-shell/app/public/goal-card-core.js`
- `packages/agent-shell/app/public/work-commands.js`
- `packages/agent-shell/app/public/shell.css` lines 345-347, 425-460, 500-530, 596-670
- `packages/agent-shell/app/public/shell-event-bindings.js` lines 805, 825, 2765
- `packages/agent-shell/app/area-note-links.mjs` lines 130-152
- `packages/agent-shell/app/pane-state.mjs` lines 1-12
- Screenshots: `/var/folders/jl/.../codex-clipboard-FsiJoB.png`, `codex-clipboard-ZO9NbN.png` (2026-08-28)
