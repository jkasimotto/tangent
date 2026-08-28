# Brain launch surface: keyboard first

Date: 2026-08-28. Status: design, no code written.

## Problem contract

Julian opens the brain chooser from the keyboard (`b` on an Area row) and cannot finish from the keyboard. Two symptoms, in his words: "I can't actually launch the brain" and "I can't see some of the interface a lot of the time."

The blocked outcome is one intention: start or wake the brain of an Area. This is the most common brain action. Changing the harness, model, or effort is the rare case.

Constraints:

- Keyboard first, with Vim-grade latency between intention and action (navigation-model record, section 1).
- ADR-0038: one visible surface owns each key. The chooser is a transient surface. Tab stays inside it until it closes.
- The work-contract record already decides: brain launch, Goal launch, and Area defaults share one picker component and one focus contract. `j/k` move within a region, `h/l` move across Harness, Model, and Effort, Enter selects.
- No hidden features. Every key is printed on the surface. Every pointer control shows its key (ux-discoverability memory).
- No instruction box. A brain starts from its Area note (commit `b8364ab`).

Non-goals:

- The Describe work composer and the Area defaults editor. They share the picker and get the mechanical fixes for free, but their layout is not redesigned here.
- The harness registry editor.
- Server-side launch resolution (`launch-environment.mjs`). Unchanged.

Success conditions:

1. From an Area row, `b` then `Enter` starts or wakes the brain with the Area default. Two keys.
2. Every control the surface has is reachable and visible when the cursor is on it, at any viewport height from 600px up.
3. Changing one axis costs at most a few `h/l/j/k` presses plus `Enter`.
4. The mouse can do everything the keyboard can, and each pointer control prints its key.

## Current system (Observed)

Source: `packages/agent-shell/app/public/shell.js` (`launchPopover`, `launchPopoverVerticalStyle`), `goal-launch-view.js` (`launchPickerBlock`), `shell-event-bindings.js` (`handleLaunchPopoverKey`, `requestLaunchFocus`, click routes at lines 1681 to 1735), `work-desk-view.js` (`toggleBrainPopover`, `seedBrainDraft`, `startBrain`), `agent-shell.css` (`.launch-popover`, `.launch-option`).

### Layout

- The chooser is a `position: fixed` popover anchored under the trigger. `launchPopoverVerticalStyle` caps its height at `min(360, viewport - 32)` pixels and sets `overflow-y: auto`.
- Content for the brain target is: header, wake note, three columns of radio buttons (7 harnesses, up to 6 models, 5 efforts at about 55px each), the "Brain launch" summary with a "Change default" button, the Start or Wake button, the Start over button, Close, and "Edit harnesses and models…". This is about 800px tall.
- Result: a 360px window over an 800px document. The screenshot shows the fold under the sixth harness. The Start button, the summary, Start over, and Close are below the fold on every open.

### Keyboard

- `requestLaunchFocus` focuses the selected harness option. Every focus call in the chooser uses `{ preventScroll: true }` (`handleLaunchPopoverKey` lines 461, 480, 487, 431, 438, `restoreScreenFocus` line 1010). Focus moves under the fold and the popover never scrolls to it. This is the "cannot see" symptom.
- `j/k` and `h/l` move DOM focus between option buttons. They do not change the selection. Enter or Space clicks the focused button, which sets `state.launch.choice` and repaints. The selection and the cursor are two things, so a choice costs move plus Enter.
- No key starts the brain. The only path to Start is Tab. Tab stops include every radio option, so the harness column alone is 7 stops. From the default position to Start is about 15 to 18 Tab presses, all invisible under the fold. This is the "cannot launch" symptom.
- The header hint prints `j/k choices · h/l columns · Enter select · Esc back`. It does not name a start key because none exists.
- The "Start over" button has no `data-focus-key`. Focus restore after a repaint drops it.
- `Escape` closes the chooser and restores the Work row (tests in `launch-keyboard-ui.test.mjs` pin this). This part works.

### State and actions

- `seedBrainDraft` opens the chooser with `state.launch.choice = null`. The picker shows the Area default as selected with a `default` tag. An untouched picker sends only `expectedLaunch`; a touched picker sends a one-launch `choice` override (ADR-0037). The Area default stays unchanged.
- `startBrain({ resume })` posts `/api/brains/start`, closes the chooser, and opens the brain session. Resume is true when a brain record exists and is not live. Two buttons: "Wake brain" (resume) and "Start over" (new brain).
- A live brain never opens the chooser; `b` opens its session directly.

### What already works and must stay

- Escape and Back return to the opener's focus key.
- Nested Defaults editor returns to the brain chooser.
- The chooser loads options once per Area and traps Tab while loading.
- A pointer click on an option selects it.

## Internal precedent

- Goal status modal (`shell-event-bindings.js` line 585 onward): a state-owned action surface in the modal layer. Each action is a row with one printed letter (`d`, `w`, `p`, `r`). Enter confirms. This is the decided shape for "pick one of few, then commit" (work-contract decisions 28 to 42).
- Harness editor: `⌘↵` saves, `Esc` backs out, both printed on the buttons as `<kbd>`. The one existing "commit from anywhere in the surface" key.
- Key sheet modal: `j/k` move, `gg/G` ends, printed in a hint line.
- Work rows: the cursor is the selection. `j/k` move `state.workCursor`; there is no separate "press Enter to select the row" step. The navigation-model record (decision 3.2) retires DOM-focus-only navigation everywhere in favor of one cursor.

## External precedent

- WAI-ARIA radio group pattern: arrow keys move focus and check the radio in one step. Enter or Space is not needed to select. The chooser already declares `role="radiogroup"` and `role="radio"`, so today's behavior contradicts the pattern it declares.
- Vim and Magit transient menus: a menu prints its letters, one key commits, Escape backs out. Height follows the terminal, never a fixed cap.

## Lens: UI/UX

Intent and common path: start the brain with its default. Today: `b`, then 15+ Tabs into invisible space, then Enter. Target: `b`, `Enter`.

Visible state: the resolved launch (`claude/sonnet-5/medium`), its source (Area default or one-launch override), and whether Enter will Start or Wake. Today the summary that shows this is under the fold.

States that occur:

- Loading options: surface owns Tab, shows "Loading". Exists.
- No registry: "No harness registry" message. Exists.
- Default has an error (`presetError`): the summary shows the error, Start is disabled. Must stay visible above the fold.
- Inactive brain with a record: Wake is primary, Start over is secondary. Both need keys.
- Start request fails: toast, chooser stays open. Exists.

Danger: "Start over" discards the old brain's plan. It must not be the Enter action, and its key must not be adjacent in meaning to Wake. A printed distinct letter is enough; no confirm modal, because a new brain does not delete vault history.

Feedback: the toast plus opening the session layer already match the action's weight.

Expert efficiency versus accessibility: moving the checked radio with arrows is the accessible standard and the fastest path. Both goals align.

Product-wide cost: no new pattern. The change makes the chooser obey the already decided cursor idiom and the radio pattern it already declares.

## Candidate designs

### A. Mechanical fix only

Remove the 360px cap for the brain target, scroll focus into view, add `⌘↵` for Start.

- Fixes both symptoms.
- Keeps move-then-Enter selection and 18 Tab stops. Still not Vim-grade.

### B. Cursor is the selection, Enter commits (selected)

Keep the three columns. `h/l` move between columns, `j/k` move the checked value inside the column. There is no separate select step. `Enter` anywhere on the surface starts or wakes. Printed letters for the secondary actions. Surface height follows the viewport and scrolls to the cursor.

- Two keys for the common path, a few keys for any change.
- Matches the ARIA radio pattern and the Work cursor idiom.
- One picker component, so Describe and Defaults inherit it.
- Cost: a selection change now repaints on every `j/k`. `paint(true)` already runs on click selection and restores scroll and focus by key, so this is the same cost per step as one click today.

### C. Collapsed rows with an inline list per axis

Three rows (Harness, Model, Effort) show the current value. Enter on a row opens that axis as a list. Pick, return.

- Smallest surface. Fits any viewport without scrolling.
- Adds a level: change one axis costs open, move, pick, return. Slower than B for the rare change, equal for the common path.
- New pattern in the product. Rejected for cognitive cost; B reaches the same common-path speed without it.

### D. Status-modal shape

Render the chooser as a Goal-status style modal with letter rows: `c` Claude, `o` Claude Otto, and so on.

- Letters run out: 7 harnesses, 6 models, 5 efforts collide within one surface.
- Rejected.

## Decisions

1. **Cursor is the selection.** `j/k` change the checked value in the active column and repaint. `h/l` move the active column, landing on its checked value. Arrow keys are synonyms. Pointer click on an option does the same as moving the cursor onto it. This replaces move-then-Enter. (Departs from the work-contract wording "Enter selects" for the picker region only; the record's intent, one cursor and one idiom, is preserved.)

2. **Enter commits from anywhere on the surface** where no text field owns focus. For the brain target Enter runs the primary action: Start brain, or Wake brain when a record exists. `⌘↵` is a synonym so the harness editor's key also works here. The primary button prints `↵`.

3. **Printed letters for secondary actions**, following the status-modal precedent. Proposed set, to be checked against collisions on the surface: `n` Start over (new brain), `d` Change default (opens the nested Defaults editor, already returns here), `e` Edit harnesses and models. Each button shows its `<kbd>`. `Escape` stays Back.

4. **Height follows the viewport.** The 360px cap goes for all three targets: `max-height: viewport - 2 * gap`. The flip-above rule stays for anchoring. Every focus inside the chooser is followed by `scrollIntoView({ block: "nearest" })`, or the `preventScroll` flag is dropped for this surface only. `restoreScreenScroll` already keeps the popover scroll across repaints.

5. **Summary and primary action sit above the columns.** Order: header, wake note, resolved launch line (`claude/sonnet-5/medium · Area default`, or `one launch only`), primary and secondary actions, then the three columns. The common path never needs the columns on screen. The columns stay visible for the rare change and for the mouse.

6. **The header hint prints the real grammar**: `h/l column · j/k choose · ↵ start · n start over · Esc back`. Generated from the same command list that renders the buttons, so the hint cannot drift (registry rule from ADR-0038).

7. **`Start over` gets a focus key** (`launch:brain:start-over`) so repaints keep focus on it.

8. **Tab stops shrink to controls, not options.** Tab moves between the action row, the columns as one stop each (landing on the checked value), and the registry link. Inside a column `j/k` move. This keeps ADR-0038's "Tab stays inside" and removes the 18-stop walk.

## Complete workflow traced

Start a brain with the default:

1. Cursor on an Area row in Work. Press `b`.
2. Chooser opens, sized to the viewport. Focus is on the primary action. The launch line reads `claude/sonnet-5/medium · Area default`. Press `Enter`.
3. Toast "Brain started." Session layer opens on the brain.

Wake with a different model:

1. `b`. Chooser opens, primary reads "Wake brain ↵", note says a brain ran here before.
2. `Tab` to the columns, or `l` from the action row, lands on Harness at Claude. `l` to Model at Sonnet 5. `j` moves the check to Opus 4.6. The launch line updates to `claude/opus-4.6 · one launch only`.
3. `Enter`. Toast "Brain awake." Session opens.

Mouse: click the brain button on the Area row, click any option to check it, click "Start brain ↵". Same states, same repaints.

## Evidence and counterexamples

- Radio semantics already declared: `role="radiogroup"`, `aria-checked` (`goal-launch-view.js` lines 296, 303, 309, 354 to 356). Decision 1 makes behavior match markup.
- The 360px cap was added for the Describe popover near the viewport bottom (`launch-keyboard-ui.test.mjs`, "a chooser near the viewport bottom flips above its trigger"). Decision 4 keeps the flip and removes only the fixed cap, so that test's intent survives.
- `paint(true)` on selection already exists for clicks (`shell-event-bindings.js` 1681 to 1704) and focus survives by `data-focus-key`. Decision 1 reuses this path. Counterexample checked: the model focus key embeds the harness id, so a harness change moves focus to the new harness's first model on the next `l`, which is the wanted result.
- Failed generalization: "make Enter select the option, as the hint says" was the previous fix. It left the surface with no commit key. Enter must be the commit.

## Rejected alternatives

- **C, collapsed rows** (above): more levels for the rare change, a new pattern.
- **D, letter per option**: letters collide.
- **Keep the popover cap and add inner column scrolling**: three independent scroll regions in a 360px window hide even more.
- **A modal in the modal layer instead of the anchored popover**: cleaner stacking, but the nested Defaults editor and the Describe composer share the popover and its return contract. Moving one target breaks the shared component. Revisit when the layer consolidation (navigation-model decision 3.4) lands.

## Risks, assumptions, unknowns

- Assumption: repainting on every `j/k` is fast enough. The screen repaint is the same as one click today. If it is not, paint only the popover subtree.
- Assumption: `n`, `d`, `e` do not collide with text entry on this surface. The brain target has no text field. The Describe target has a textarea; there the letters are only active outside the textarea, which the existing text-entry detector already handles.
- Resolved 2026-08-28: Julian confirmed the three lists stay visible every time. No "Change agent" row hides them.
- Condition for reconsideration: when the navigation-model's single layer stack lands, the chooser can move to the modal layer and drop the anchor code.

## Sources

- `packages/agent-shell/app/public/shell.js` lines 565 to 605
- `packages/agent-shell/app/public/goal-launch-view.js` lines 284 to 368
- `packages/agent-shell/app/public/shell-event-bindings.js` lines 338 to 490, 685 to 698, 1611 to 1735
- `packages/agent-shell/app/public/work-desk-view.js` lines 450 to 527
- `packages/agent-shell/app/public/agent-shell.css` lines 1138 to 1212
- `packages/agent-shell/app/launch-keyboard-ui.test.mjs`, `brain-wake-needs-message-ui.test.mjs`
- `docs/design/agent-shell-work-contract/design-record.md`, "Unified launch editor"
- `docs/design/agent-shell-navigation-model/design-record.md`, sections 3.2 to 3.6
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md`, ADR-0037
