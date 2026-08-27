# Work view affordances: fold, cursor, and shortcut hints

Date: 2026-08-27. Status: proposed. No code changes accompany this record.

Lenses applied: UI/UX. No other lens applies. The change touches markup, CSS, and one registry entry. No boundary, storage, or API changes.

This record builds on `../agent-shell-work-contract/design-record.md`, `../agent-shell-navigation-model/design-record.md`, and `../agent-shell-operating-vision/design-record.md`. It does not reopen their decisions. Line numbers cite the working tree on 2026-08-27 evening.

## 1. Problem contract

Julian's words, verbatim: "this ui for expanded / collapsed is shit. /design consistent ui with other systems. Also the caret is confusing since that is normally a treeview thing. It would be great if all actions had keyboard shortcut reminders."

The root problem is not the pill. Julian scans Work under load. Three things on the screen need reading instead of recognition:

1. The fold control reads as `+ 1`. It looks like a count or an add button. It is neither.
2. The `▸` glyph looks like a tree disclosure. It marks the cursor instead.
3. Action buttons (`Start agent`, `Open`) print no key. The user has to remember or open `?`.

Constraints that stay:

- No hidden features. Every shortcut is printed in the UI. One way per action. Selection never spawns anything.
- One command registry teaches keys, pointers, tooltips, `:` menus, and `?` sheets (work contract, "One object-command registry").
- `h` and `l` fold and unfold. Decision 28 of the work contract superseded `z`.
- No invented terms. The words on screen are Julian's: Area, Goal, brain, agent, open, fold.

Non-goals:

- No change to which rows exist or how they sort.
- No change to key ownership (ADR-0038).
- No redesign of the `:` menu or the `?` sheet content beyond what the registry already gives.

Success conditions:

1. A fold control looks like a fold control in Finder, Xcode, and VS Code: a triangle that rotates.
2. Only one glyph on the screen means expand or collapse.
3. Every button with a verb label shows its key, right-aligned, in one style.
4. A glyph-only control has its key printed on the same screen, in the caption line.
5. Nothing on an Area header needs reading to know if it is folded.

## 2. Current system (Observed)

### 2.1 The `+ 1` pill

The pill is the fold button `.work-tree-toggle` (`packages/agent-shell/app/public/work-desk-view.js:1540`). Its content is `+` when folded and `−` when open, followed by `<kbd>l</kbd>` or `<kbd>h</kbd>`. The `kbd` is 8px Menlo (`shell.css:548`). At 8px, Menlo `l` reads as `1`. The pill therefore reads `+ 1` in screenshot 1 and 2.

The pill counts nothing. The count lives in a separate span `.work-group-count` right after the pill (`work-desk-view.js:1541`). Its text is `N open`, then `M moving`, `K blockers`, `Q questions` when non-zero (`work-desk-view.js:854-865`). It shows in both fold states.

A Goal with Subgoals has a second variant `.work-subgoal-toggle` (`work-desk-view.js:1625`). It renders `+` or `−`, then the Subgoal count, then the key. Example: `+ 2 l`. The same 8px Menlo `kbd` applies (`shell.css:548`, `579`).

The `Other Areas` group has a third copy of the same button (`work-desk-view.js:1884`).

### 2.2 The `▸` caret

`shell.css:512` paints `▸` before the name of the cursor row: `.work-row.cursor .work-cell-title::before, .work-group-row.cursor .work-group-name::before { content: "▸" }`. It is the cursor marker. The cursor row also gets a blue inset bar and a tinted background (`shell.css:510-511`). The cursor therefore has three marks. The triangle is the one that lies, because a triangle means disclosure in every desktop tree.

Screenshot 2 shows both at once: `▸ Neara [+ 1]`. Read from the left: a disclosure triangle that is not one, then an add button that is not one.

The caret entered with commit `b6cfad6` ("navigate Work sessions with a cursor"). The pill entered with commit `caa4db6` ("unify Work keyboard interactions").

### 2.3 How fold works today

- Keys: `h` folds or moves to the parent. `l` unfolds or moves to the first child (`work-commands.js:19-20`, `shell-event-bindings.js:177-211`).
- Pointer: only the pill toggles (`shell-event-bindings.js:1568-1569`). The Area name is a button that opens or starts the brain (`work-desk-view.js:1540`, `route`). The rest of the header row is not a pointer target for fold.
- Folded Areas persist in `localStorage` under `agent-shell.folded-work-areas` (`work-desk-view.js:1737`). Folded Goal trees persist under `agent-shell.collapsed-goal-trees` (`shell-state.js:33`).
- A folded Area renders its header only (`work-desk-view.js:1692-1693`).

### 2.4 Every action in Work, its key, and where the key is printed

| Row | Control | Key | Registered | Printed where |
|---|---|---|---|---|
| Area header | Area name (opens or starts brain) | none | no | nowhere |
| Area header | fold pill | `h` / `l` | yes | inside the pill, 8px |
| Area header | `N questions` button | `r` | yes | tooltip only |
| Area header | `Open brain` / `Resume brain` / `Start brain` | `b` | yes | inside the button, 9px Menlo (`work-desk-view.js:1533`) |
| Area header | `⋯` menu | `:` | yes | tooltip only |
| Area header | New Goal, Stop brain, Defaults, Focus, Note | `a` `s` `d` `f` `n` | yes | `⋯` menu and `?` sheet |
| Goal row | Goal title (opens session, launch, or reader) | Enter | no | nowhere |
| Goal row | Subgoal pill | `h` / `l` | yes | inside the pill, 8px |
| Goal row | `Start agent` | none | no | nowhere |
| Goal row | `Open` | none | no | nowhere |
| Goal row | launch reference button (`claude-otto/opus-5/medium`) | none | no | nowhere |
| Goal row | `⋯` menu | `:` | yes | tooltip only |
| Goal row | Read Goal, Change agent, Goal status | `o` `c` `x` | yes | `⋯` menu and `?` sheet |
| Definition row | `Open <name>` | none | no | nowhere |
| Caption | static hint line | `j / k`, `⌘J`, `?` | yes | caption (`work-desk-view.js:1907`) |
| Any row | `?` | `?` | yes | caption and `?` sheet |

Enter on a Goal title is not a registered command. `setWorkCursor` focuses the title button after each move (`shell-event-bindings.js:101`). The browser then presses the focused button on Enter. This is why Enter works and why nothing prints it.

The `?` sheet exists. `openWorkKeySheet` opens a modal titled "Move around Work" with one row per registry command (`shell-event-bindings.js:588-596`). The `:` menu prints keys in 10px Menlo (`shell.css:1448`).

Tooltips carry `help (key)` through `workCommandAttributes` (`work-desk-view.js:23-28`). They show on hover only.

### 2.5 Printed key styles today

Six different `kbd` styles exist in Work and its surfaces: 8px Menlo (fold pills), 9px Menlo (brain button), 10px Menlo (`⋯` menus, tool buttons), 10px caption, 11px inherited (`primary-button`), 11px Menlo (`?` sheet). The fold pill is the smallest and the only one that misreads.

## 3. Internal precedent

- `goal-launch-view.js:66`, `109`, `531`, `934`: every launch and defaults button prints its key inside the label, right of the verb, in the label font at 11px. `Create and choose agent ⌘↵`, `Add assignment a`, `Back Esc`. This is the house style for a button with a verb.
- `shell.js:316-318`: comment actions print `Edit e`, `Reply r`, `Resolve x` the same way.
- `shell-coordinator.js:755`: the `?` sheet renders from the registry.
- `docs/design/agent-shell-compressed-work-hierarchy.md`: "Counts summarize children, not machinery" and "Root Goal/Subgoal hierarchy keeps the existing disclosure pattern". The `N open` count follows the first rule already.
- Work contract, "The registry must prove both directions. Every registered shortcut has a visible pointer action. Every command pointer shows its registered shortcut." The `Start agent`, `Open`, and title buttons break the second sentence today.

## 4. External precedent

These are product-knowledge references. None was inspected tonight.

| System | Fold control | Count | Shortcut hint |
|---|---|---|---|
| macOS Finder list view | `▸` rotates to `▾` at the far left. Click on the triangle only. `→` and `←` fold. | none | menus only |
| Xcode navigator | same triangle, same click target | none | menus only |
| VS Code explorer | chevron at the left, rotates. The whole row toggles a folder. | none | Command Palette and hover |
| GitHub file tree | chevron at the left, rotates. Whole row toggles. | none | none |
| Linear | chevron at the left of a group header. Whole header toggles. | muted count at the right of the header, always shown | key printed at the right of each command in the palette and on hover |
| Things | triangle at the left. Whole header toggles. | muted count at the right, always shown | menus only |
| macOS menus | none | none | key right-aligned in the same row, system font, muted |
| Gmail, Superhuman | none | none | a `?` overlay lists all keys. Superhuman prints the key at the right of each command in its palette. |

What a fast-scanning eye gets right: a triangle at the far left that rotates means fold, in every system above. A number at the right of a header with a noun means a count. A muted key at the right of a verb means a shortcut. A `+` prefix means add in every system above. That is why the pill fails.

## 5. Lens analysis: UI/UX

Intent and common path: Julian lands on Work, reads the folded Area headers, unfolds one, moves to a Goal row, and acts. He does this many times an hour.

Existing behavior that stays: `j` `k` move, `h` `l` fold, `b` brain, `:` menu, `?` sheet, cursor bar and tint, fold persistence.

State that must stay visible: fold state (triangle direction), the Area count and state, the cursor row, and each button's key.

Empty and partial states: an Area with zero open Goals still renders a header. The triangle still rotates, and the count reads `0 open`. A folded Area with a live brain keeps its state label (`work-desk-view.js:875-881`). A Goal without Subgoals renders no triangle and keeps the indent, so titles align.

Consequence and feedback: fold is instant and reversible. No confirmation.

Accessibility: the triangle button keeps `aria-expanded` and the registry `aria-keyshortcuts`. The `kbd` in each button is `aria-hidden`, and the accessible name stays the verb.

Cognitive cost: this design adds no new element. It removes one (the caret), changes one (the pill becomes a triangle), and makes the printed key uniform.

One traced workflow: Julian sees `▸ Neara  3 open · 1 moving`. He presses `l` or clicks the triangle. The triangle turns to `▾` and rows appear. He presses `j` to a Goal row. The row shows `Open ↵` and `⋯ :`. The caption line reads `↵ open · o read · x status · : more · ? all`. He presses `↵`.

### 5.1 Mockups

Before, Area header with the cursor on it (screenshot 2):

```
| ▸ Neara [+ l]  3 open · 1 moving   1 question        Open brain b   ⋯ |
```

After, folded, cursor on the row (bar and tint only, shown here as `|`):

```
| ▸ Neara   3 open · 1 moving   1 question r        Open brain b   ⋯ : |
```

After, open:

```
| ▾ Neara   3 open · 1 moving   1 question r        Open brain b   ⋯ : |
|     Fix login timeout               Working    12m         Open ↵  ⋯ : |
|     Ship onboarding   2 Subgoals    Ready       -          Open ↵  ⋯ : |
|   ▸ Other Areas   4 Areas · 9 open                                      |
```

Goal row with Subgoals, folded and then open:

```
|   ▸ Ship onboarding   2 Subgoals    Ready       -          Open ↵  ⋯ : |
```

```
|   ▾ Ship onboarding                 Ready       -          Open ↵  ⋯ : |
|       Write the welcome email       Working    4m          Open ↵  ⋯ : |
|       Add the first-run tour        Ready       -          Open ↵  ⋯ : |
```

Caption line under the table, cursor on a Goal row:

```
Work   12 Goals            ↵ open · o read · x status · : more · ? all
```

Caption line, cursor on an Area row:

```
Work   12 Goals            b brain · a new Goal · h/l fold · : more · ? all
```

## 6. Candidate designs

**A. Rotating triangle at the far left, count stays as it is, caret deleted, keys printed in one style (selected).** The triangle is the only fold glyph. The cursor keeps its bar and tint. Every verb button prints its key at the right in the `primary-button kbd` style. Glyph-only controls print their key in the caption line.

**B. Keep the pill, fix its font.** Replace 8px Menlo with the 11px label font so `l` reads as `l`. Rejected. `+ l` still reads as add. A key printed inside a glyph-only control still needs reading. It also stays inconsistent with every system in section 4.

**C. Triangle plus a hidden-row count when folded (`▸ Neara  3`).** Rejected. The count `3 open · 1 moving` exists in both fold states and carries a noun. A second bare number beside it is a duplicate that needs reading.

**D. Whole header row toggles, like VS Code and Linear.** The Area name is the brain route today (`work-desk-view.js:1540`). A whole-row toggle removes that pointer path or makes one click do two things. Held as a decision for Julian, see section 8. Recommendation: triangle only, like Finder and Xcode, because the header carries a name button, a state button, a brain button, and a menu.

**E. Keys on hover or focus only.** Rejected. Julian's rule is "shortcuts printed in the UI". Tooltips exist today and did not stop the complaint.

## 7. Evidence and counterexamples

- Counterexample to "print the key inside every control": the fold pill did exactly that and produced `+ 1`. A key inside a glyph-only control has no verb to sit beside. Rule: a key sits at the right of a verb. A glyph-only control gets its key in the caption line and the `?` sheet.
- Counterexample to "delete the cursor triangle and nothing is lost": with the caret gone, the cursor has the bar and the tint. Both survive in the screenshots at a glance. No third mark is needed.
- Counterexample to the `+` glyph: Linear and Things use `+` for "new item" on the same header line where they show a count. A `+` beside a count reads as add there too.
- Failed hypothesis: "the pill counts hidden Goals". It does not. `1` is `l`.

## 8. Decisions

**D1. One fold glyph: a triangle at the far left of the row.** `▸` folded, `▾` open. It replaces the pill on Area headers, `Other Areas`, and Goal rows with Subgoals. Click on the triangle toggles. `h` and `l` stay. The triangle prints no key. (Decision)

**D2. The cursor loses its triangle.** Delete the `::before` rule at `shell.css:512`. The bar and tint stay. After this, a triangle means fold and nothing else. (Decision, low cost, no word from Julian needed)

**D3. The count stays where it is and how it is.** `3 open · 1 moving` after the name, muted, both fold states. No `+`, no bare number. A Goal with folded Subgoals shows `2 Subgoals` as muted small text after its title. When open, the Subgoal rows are the count. (Decision, Julian to confirm, see Q2)

**D4. Every button with a verb prints its key, right-aligned, in one style.** The style is the existing `.primary-button kbd`: label font, 11px, muted. Replace the 8px, 9px, and 10px Menlo `kbd` rules in Work with this one class. Examples: `Open ↵`, `Open brain b`, `1 question r`, `⋯ :`. Hints are always visible, not on hover. (Decision)

**D5. Enter becomes a registered command.** Add `enter` to `work-commands.js` with `keyDisplay: "↵"`, scope `work`, label "Open", help "Open the live session, the launch chooser, or the Goal reader for this row." The title button and the `Open` button print `↵`. The native focus path stays as the implementation. (Decision)

**D6. The caption line shows the keys of the current row.** The static `j / k rows · ⌘J session · ? keys` line becomes row-aware. Area row: `b brain · a new Goal · h/l fold · : more · ? all`. Goal row: `↵ open · o read · x status · : more · ? all`. This is where glyph-only controls print their keys. The `?` sheet stays as it is. (Decision)

**D7. `Start agent` prints no key today, because it has none.** Under the operating vision D8 the button goes. Adding a key now creates a binding that is deleted next. (Decision)

**D8. The future shortcut table.** Today's differences are marked.

| Row | Action | Key | Today |
|---|---|---|---|
| Area | Message the brain | `a` | `a` is New Goal. Vision D8 changes it. |
| Area | Open the brain session | `b` or `↵` | `b` only. `↵` presses the name button, which is the same route. |
| Area | Fold, unfold | `h`, `l` | same |
| Area | More | `:` | same |
| Area | Stop brain, Defaults, Focus, Questions, Note | `s` `d` `f` `r` `n` | same, in `:` |
| Goal | Open | `↵` | not registered |
| Goal | Read | `o` | same |
| Goal | Status: done, won't do, park, verify | `x` | `verify` is new, vision D12 |
| Goal | Change agent | `c` | same |
| Goal | Start agent | none | button exists, goes with vision D8 |
| Attempt | Resume | `r` | no attempt rows in Work yet, vision D23 and navigation model 3.1 |
| Brain row | Restart | in `:` | no brain row in Work yet, vision D10 |
| Any | Keys | `?` | same |

Collision note: `r` is Review questions on an Area row and Resume on an attempt row. The navigation model allows this only when the surface prints the key. The caption line of D6 prints it for both rows.

## 9. Rejected alternatives

- Candidate D (whole row toggles) is the strongest. It matches VS Code and Linear. It lost on the name button, which is the brain route, and on "one way per action". It is Q1 for Julian.
- Candidate B (fix the pill font) is the cheapest. It lost because `+` still means add.
- Candidate E (hover hints) lost on Julian's standing rule.
- A `?`-only approach with no inline keys lost on the same rule.

## 10. Risks, assumptions, unknowns

- Assumption: the 11px label-font key fits inside the 196px Action column beside `⋯`. The launch reference button (`claude-otto/opus-5/medium`) is the widest control. If it does not fit, the reference button drops its key and the caption line carries `↵`.
- Assumption: `work-table-ui.test.mjs` pins the pill markup and the caret. Both change.
- Unknown: whether Julian wants the count hidden when an Area is open (Linear shows it always). Q2.
- Risk: the row-aware caption repaints on every cursor move. The existing cursor paint path already repaints the table, so no new cost is expected.
- Condition for reconsideration: when assignment and attempt rows land in Work (navigation model D1), the Goal row gains a triangle for them. D1 already covers that shape.

## 11. Questions for Julian

- Q1. Fold on click of the triangle only (Finder, Xcode), or on click of the whole header row (VS Code, Linear)? The name button opens the brain today. Recommendation: triangle only.
- Q2. Keep `3 open · 1 moving` on every header in both fold states, or show it only when folded? Recommendation: both states.
- Q3. Keys always visible on buttons (recommended), or on hover and focus only?

## 12. Sources

- `packages/agent-shell/app/public/work-desk-view.js:23-28`, `854-884`, `1512-1552`, `1580-1640`, `1652-1662`, `1692-1739`, `1884`, `1907`
- `packages/agent-shell/app/public/shell.css:452-459`, `510-512`, `536-556`, `579`, `1099`, `1448`
- `packages/agent-shell/app/public/work-commands.js:9-28`
- `packages/agent-shell/app/public/shell-event-bindings.js:98-103`, `150-211`, `588-596`, `700-731`, `765-800`, `1568-1569`, `2690-2740`
- `packages/agent-shell/app/public/shell-coordinator.js:755`
- `packages/agent-shell/app/public/goal-launch-view.js:66`, `109`, `531`, `934`
- `packages/agent-shell/app/public/shell.js:316-318`
- `packages/agent-shell/app/work-table-ui.test.mjs`
- `docs/design/agent-shell-work-contract/design-record.md`, `docs/design/agent-shell-navigation-model/design-record.md`, `docs/design/agent-shell-operating-vision/design-record.md`, `docs/design/agent-shell-compressed-work-hierarchy.md`
- Commits `b6cfad6`, `caa4db6`
- Screenshots 1 to 3 from Julian, 2026-08-27
