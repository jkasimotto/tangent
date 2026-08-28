# Area star focus: design record

Date: 2026-08-28. Status: implemented on 2026-08-28. Three deviations from the text below, all from evidence found while implementing: the star sits after the Area name, not before the fold triangle, because `work-view-affordances-ui.test.mjs` pins the triangle at the far left of the name. The `Other Areas` group still opens folded by default (Decision 5 applies to real Areas only), because the sub-areas design and `area-focus-ui.test.mjs` pin that. `f` on a Goal inside `Other Areas` stars the Goal's own Area, since that group has no Area header and this is exactly where a star brings an Area in.

Lenses: UI/UX, architecture and state (client state and its stored record). No API, migration, or operations lens: the change stays inside the browser client and one localStorage record.

Intent: `user-intent.md`.

## Problem contract

**Root problem.** Julian curates which Areas he looks at while he walks the Work tree. Today the only way to change the set is a separate picker (`f`) with a search box, checkboxes, and a submit button. That is a context switch away from the row he is on. He wants to star an Area from its row with one key, see the star on the row, and switch Work between all Areas and the starred Areas only.

**Constraints.**

- Keyboard first, mouse parity for every action (ADR-0038, navigation-model design record).
- One registry owns Work keys: `packages/agent-shell/app/public/work-commands.js`. Labels, captions, the `:` menu, and the `?` sheet all read it.
- Add one mechanism at a time (memory: focus-concept-deleted). The old "focus" that chose where Julian lands is gone and must not return. This design keeps scoping under Julian's hand only.
- Escape unwinds Work one constraint at a time (work-contract design record, lines 26 and 152-156).
- Julian must recognise the action in his own words: star, focused, only focused (memory: name-work-in-julians-words).

**Non-goals.**

- No server or vault change. Focus is a per-browser preference and stays that way.
- No change to the Areas screen (`area-map.js`) in this slice.
- No exclusion list ("hide this Area") as a second stored set. See rejected alternatives.

**Success conditions.**

1. On any Area row, one key stars or unstars that Area. The star shows on the row at once.
2. On a Goal row, the same key stars the Area that owns the Goal.
3. One key and one visible control switch Work between all Areas and starred Areas only. The switch state is visible without reading.
4. Every action has a pointer control that prints its key.
5. A reload keeps the stars and the switch state.
6. Escape still unwinds one constraint at a time.

## Current system (observed)

Source: `packages/agent-shell/app/public/`.

- `area-focus-core.js`: pure functions. Roots are the smallest non-overlapping Area paths (`normalizeAreaFocus`). `isInAreaFocus(path, roots)` is true when there are no roots or the path is under one root. Storage record `agent-shell.area-focus.v1` is `{ schema, areas: [] }` in localStorage. `readAreaFocus` returns all Areas for an unknown or damaged record.
- `shell-state.js:21-36`: `state.areaFocus` (roots), `state.areaFocusPicker` (staged copy or null), `state.areaFocusStorageError`.
- `work-desk-view.js:147-280`: `areaFocusRoots`, the picker (`openAreaFocusPicker`, `toggleAreaFocusDraft`, `updateAreaFocusQuery`, `applyAreaFocus`, `cancelAreaFocusPicker`, `clearAreaFocus`), `areaFocusPickerMarkup` (dialog with search, checkboxes, "Focus on N Areas" submit), and `areaFocusControl` (summary bar "Focus: A + B" with Change and Clear, or a "Focus Area" button).
- `work-desk-view.js:918-935` `deskAreas`: with roots, only Areas inside a root form the main desk. `otherDeskAreas` (1005) returns the rest. `workTable` (1988) prints them in one folded `Other Areas` group (`otherAreasGroupBody`, 1936). Comment at 2016: "Focus orders the desk; it never removes a subject."
- `work-desk-view.js:1755` `areaIsFoldedOnWork`: with a Focus, only the first root opens by default, the rest follow `expandedAreas`.
- `work-desk-view.js:2029`: the Focus control renders only when roots exist or the picker is open. With no Focus there is no visible control on the desk. `f` is the way in.
- `work-commands.js:20`: command `focus`, key `f`, scope `area`, label "Focus Area", help "Change the Areas that Work puts first." Area caption line does not print `f` (`captionKeysByRow.area`).
- `shell-event-bindings.js:773`: `executeWorkCommand("focus")` opens the picker. Pointer routes at 1355-1357 (open, change, cancel, clear), submit at 1959, checkbox at 2141, search input at 2065. `unwindWork` (2450): transient surface, staged picker, search, applied Focus, Work tab.
- `shell.js:1052` `reconcileCurrentAreaFocus`: drops roots whose Area no longer exists, on every vault refresh.
- Area header row (`work-desk-view.js:1541-1560`): fold triangle, name button (`data-work-cursor-control`, opens brain), count, note signal, state, then the brain button and the `⋯` menu. No star today.
- Tests: `app/area-focus-ui.test.mjs` opens Focus with the `f` key and pins the staged picker flow, scope of Work and questions, return focus, and recovery after Area deletion. `app/area-focus-core.test.mjs` pins the pure functions. `focus-shell-desk-hierarchy-ui.test.mjs` pins the `Other Areas` group.

**Observed gap.** The picker is a bulk editor. Julian's path is one Area at a time while the cursor is already on it. The picker also has no way to remove the `Other Areas` group. Focus today orders, it never hides.

## Internal precedent

- Row verbs with a key, a pointer control that prints the key, and a `:` menu entry: `openBrain` (`b`), `questions` (`r`), fold (`h`/`l`, triangle). The star follows this exact shape.
- A per-row persistent mark in localStorage: `expandedAreas` (`agent-shell.expanded-areas`) and `foldedWorkAreas`. Both are sets of Area paths written on toggle, no staging, no submit.
- A Work-wide switch with a visible state: `state.workFilter` (`active` / `inactive` / all) in `filteredGoalTrees`. The starred-only switch is the same kind of constraint.
- Escape order is a written contract (work-contract design record, "Escape removes the latest search, focus, or filter constraint before it leaves Work").

## External precedent

- Vim marks and Neovim `harpoon`: mark a location from where you are, with one key, and see a list. No dialog. This matches "select as I navigate".
- Mail and file clients: a star toggled in place on the row, and a "Starred" view that shows only starred items. Julian used the word star, so this is the closest mental model.

## Lens analysis

### UI/UX

**Intent and common path.** Walk rows with `j`/`k`/`{`/`}`, press one key to star the Area under the cursor, keep walking. When the set is right, press one key to see only starred Areas. Later, press it again to see everything.

**Complete workflow (traced).**

1. Cursor on `otto/tangent` header. Press `f`. `state.areaFocus` gains `otto/tangent`. The record is written. Paint. The header prints `★` before the name. The desk reorders: starred Areas first, the rest in the folded `Other Areas` group. The cursor key `area:otto/tangent` still names the same row, so the cursor stays on it and scrolls into view.
2. Cursor on a Goal under `neara/pgande`. Press `f`. The owner Area `neara/pgande` is starred. Same paint.
3. Press `F`. `state.areaFocusOnly` becomes true. `otherDeskAreas` returns nothing, so the `Other Areas` group is gone. The summary bar reads `★ 2 Areas · only starred`. Press `F` again: the group returns.
4. In only-starred mode, cursor on `neara/pgande`, press `f`. The star goes. The Area leaves the desk. The cursor moves to the nearest remaining row (same rule `j`/`k` use when a row disappears). This is the "hide as I navigate" path.
5. Escape: only-starred off first. Escape again: stars cleared, as today.

**Visible state.** Three facts must be seen, not read:

- Which Areas are starred: a `★` glyph at the start of the Area name on its header row, top-level or sub-Area. Same colour as `--blue`, the colour the Focus summary already uses.
- Whether Work shows all or starred only: the existing summary bar stays and gains the switch as a segmented control, `All | Starred`, with `F` printed. The bar shows whenever stars exist. The bar is gone when nothing is starred, as today, so an unfocused desk has no new element.
- What `f` does on the current row: the Area and Goal caption lines print `f star`. The `?` sheet and `:` menu read the registry.

**Mouse parity.**

- The `★` on a starred row is a button: click unstars. On an unstarred row a dim `☆` button shows only while the pointer is over the row or the row holds the cursor, so the plain desk gains no noise. Both print `f` in their title.
- The `:` menu (`openObjectActions`) lists `Star Area` / `Unstar Area` for Area rows and Goal rows.
- The summary bar switch is two buttons. The bar keeps `Change` (opens the picker) and `Clear`.

**Edge states.**

- `f` on an Area inside a starred ancestor: it is already inside Focus. `normalizeAreaFocus` would drop it at once. Show the toast "Inside starred <ancestor>. Unstar <ancestor> first." Do not silently change the ancestor. One mechanism at a time.
- `f` on the `Other Areas` header: toast "Choose an Area row." (`OTHER_AREAS_KEY` is not an Area.)
- `f` on a done or archived Area with open Goals: allowed. The root already scopes today.
- Only-starred with zero stars: not a state. Unstarring the last Area clears `areaFocusOnly` too, and the desk shows everything. `F` with no stars: toast "Star an Area first with f."
- Storage failure: same toast path as today (`persistAreaFocus`).
- Area deleted or moved: `reconcileCurrentAreaFocus` and `rewriteAreaFocus` keep working on the same roots. When reconciliation empties the roots, `areaFocusOnly` resets.
- The staged picker stays reachable from `Change` and from the `:` menu as `Choose Areas…` with no key. Bulk edits over many Areas still have a home.

**Cognitive cost.** One new glyph on a row that Julian chose to mark, one new switch inside a bar that already exists only when Focus exists. No new persistent element on the plain desk.

**Accessibility.** The star button has `aria-pressed` and a label "Star <Area>" / "Unstar <Area>". The switch is a `role="group"` of two `aria-pressed` buttons. Caption text is `aria-hidden`, as today.

### Architecture and state

- **State.** `state.areaFocus` keeps its meaning: the roots. New `state.areaFocusOnly: boolean`. No new stored set.
- **Stored record.** `agent-shell.area-focus.v1` gains an optional `only: true`. `readAreaFocus` today accepts any record with the right schema and an `areas` array, so an old client reads a new record and ignores `only`. A new client reads an old record as `only: false`. No schema bump.
- **Pure core.** `area-focus-core.js` gains `toggleAreaFocusRoot(roots, path)` that returns `{ roots, change: "added" | "removed" | "insideAncestor" }`. The view maps `insideAncestor` to the toast. Reading and writing `only` lives in the same module. All of this is unit-testable without a DOM.
- **Projection.** `otherDeskAreas` returns `[]` when `state.areaFocusOnly`. That is the whole hiding change. `deskAreas` is untouched.
- **Registry.** Replace `focus` with three records:
  - `starArea`: key `f`, scope `area`, palette, label "Star Area", help "Star this Area so Work puts it first. Press again to unstar. On a Goal, stars its Area."
  - `starredOnly`: key `F` (`shiftKey: "any"` on `f` is wrong; match `key: "F"`), scope `work`, palette, label "Only starred Areas", help "Show only the starred Areas. Press again to show every Area."
  - `chooseAreas`: no key, scope `area`, palette, label "Choose Areas…", help "Pick several Areas to star at once."
- **Dispatch.** `executeWorkCommand("starArea", row)` uses `commandAreaForRow(row)` for the Area. Pointer route `[data-star-area]`. `starredOnly` has no row dependency.
- **Paint key.** `shell.js:638` lists the paint dependencies for Work. Add `state.areaFocusOnly`.

## Candidate designs

### A. Star from the row, one switch for starred only (selected)

Described above. Reuses roots, storage, projection, and the summary bar. Adds one pure toggle, one boolean, three registry records, one glyph.

### B. Keep the picker, make `f` open it with the current row pre-checked

Smallest change. Still a dialog, still a submit. Does not meet "as I navigate". Rejected.

### C. A hide list ("inverse of focus") as a second stored set

`f` stars, `x`-like key hides. Two sets can disagree (starred and hidden), so every projection needs a precedence rule, and Escape needs a third stage. Julian's own sentence corrects the idea mid-way: "or rather I need a way to use the keyboard shortcuts to select areas to focus". Hiding falls out of A as unstar in only-starred mode. Rejected.

### D. Drop `Other Areas` always when any star exists (no switch)

Fewer keys. But it deletes today's "orders, never removes" behaviour, which the sub-areas record and desk-hierarchy tests pin, and it removes the way to reach an unstarred Area's brain from Work. The switch keeps both modes one key apart. Rejected.

## Evidence and counterexamples

- `normalizeAreaFocus` drops nested roots. This is why `f` on a descendant of a starred Area needs its own answer (toast), and why the record must not pretend a star on a sub-Area of a starred parent exists.
- `areaIsFoldedOnWork` opens only the first root by default under a Focus. With stars added one by one, the first root by path sort is not the one Julian starred first. Decision 5 below.
- `area-focus-ui.test.mjs` opens Focus with `f` and expects the picker. That test changes: `f` stars, the picker opens through `Change` or the `:` menu.

## Decisions

1. **`f` toggles the star of the Area under the cursor, or the owner Area of the Goal under the cursor.** Decisive evidence: the picker is the only blocker to "select as I navigate", and every other row verb already works this way.
2. **`F` toggles starred-only.** Shift of the same letter reads as "more of the same". `state.areaFocusOnly`, stored as `only` in the existing record, no schema bump.
3. **The star is `★` before the Area name, only on root rows.** A descendant shows no star. It is inside because its ancestor is starred, and the desk order already shows that.
4. **The summary bar stays the mouse home for Focus.** It gains the `All | Starred` switch and keeps `Change` (picker) and `Clear`. It shows only when stars exist.
5. **Starring never changes which groups are open.** Drop the "only the first root opens by default" rule from `areaIsFoldedOnWork` under a Focus. With stars added one at a time, that rule folds the Area Julian just starred when it sorts after another root. Fold state follows `foldedWorkAreas` and `expandedAreas` alone, as it does without a Focus. Proposed generalization: the sub-areas record says the same rule was already loosened once (`z` works on the plain desk). Observed: no UI test pins "first root opens" (grep of `app/*.test.mjs` for the rule finds none). `area-focus-ui.test.mjs:171` pins only that `Other Areas` opens folded, which stays true.
6. **Escape order.** Transient surface, staged picker, search, starred-only, stars, Work tab. One constraint per press, as the contract says.
7. **The picker stays, without a key.** It is the bulk path. Reconsider deletion after two weeks of use of `f`.
8. **Cursor after `f` and `F`.** The cursor key names the row (`area:<path>`), so it survives reordering. When the row leaves the desk (unstar in only-starred), the cursor moves to the nearest remaining row and Work scrolls to it.

## Rejected alternatives

- Candidates B, C, D above. C was the strongest reading of "inverse of focus", rejected because two sets create precedence rules and Julian's own words moved to "select areas to focus".
- A star on every Area inside Focus, not only roots: makes `f` on a descendant look like an unstar that fails. Rejected.
- Number keys or `⌘1..9` to jump between starred Areas: this was the deleted focus set (memory: focus-concept-deleted). Not proposed.
- `*` as the star key (Vim word-search): free in Work, but `f` already means Focus in the registry, the caption, and Julian's habit. Keeping `f` costs nothing.

## Risks, assumptions, unknowns

- **Observed:** `F` is free in the Work context. `shell-event-bindings.js`, `motion-keys.js`, and the registry contain no `"F"` binding.
- **Assumption:** the hover-only `☆` on unstarred rows does not conflict with the row's pointer targets. The header already shows the brain button and `⋯`. Place the star before the fold triangle so the name button keeps its position.
- **Risk:** Decision 5 changes default fold behaviour under a Focus. No test pins it (observed above), but Julian may have relied on it. Say so in the commit.
- **Risk:** the `Other Areas` group also carries descriptions (live sessions without a Goal). In only-starred mode these vanish with the group. Acceptable: they are outside the stars by definition, and `F` brings them back.
- **Unknown:** whether Julian wants the Areas screen (`area-map.js`) to show stars. Out of scope until asked.

## Implementation slices (for `/impl`)

1. Core: `toggleAreaFocusRoot`, `only` in read and write, unit tests in `area-focus-core.test.mjs`.
2. Registry: replace `focus` with `starArea`, `starredOnly`, `chooseAreas`. Caption lines for `area` and `goal` print `f star`.
3. View: star glyph and button on header rows, switch in the summary bar, `otherDeskAreas` honours `areaFocusOnly`, drop the first-root fold rule.
4. Dispatch: `executeWorkCommand` for the three ids, pointer routes, `openObjectActions` entries, `unwindWork` order, paint key.
5. Tests: rewrite `area-focus-ui.test.mjs` for the star path and the switch, keep the picker test through `Change`.

## Sources

- `packages/agent-shell/app/public/area-focus-core.js`
- `packages/agent-shell/app/public/work-desk-view.js` (147-280, 918-935, 1005, 1541-1560, 1755, 1936-2040)
- `packages/agent-shell/app/public/shell-event-bindings.js` (773, 859, 1355-1357, 1959, 2065, 2141, 2450, 2660-2720)
- `packages/agent-shell/app/public/work-commands.js`
- `packages/agent-shell/app/public/shell-state.js`, `shell.js` (638, 1052)
- `packages/agent-shell/app/area-focus-ui.test.mjs`, `area-focus-core.test.mjs`, `focus-shell-desk-hierarchy-ui.test.mjs`
- `docs/design/agent-shell-work-contract/design-record.md` (Escape order, Area header verbs)
- `docs/design/work-view-sub-areas/design-record.md` (Focus roots own their subtree, `Other Areas` group)
- `docs/design/agent-shell-navigation-model/design-record.md` (keyboard-first, mouse parity)
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md`
