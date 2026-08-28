# Work search like Vim: design record

Date: 2026-08-28. Status: implemented 2026-08-28 (`work-search-bar.js`, `work-search-core.js`). Keys are governed by `../agent-shell-keymap/design-record.md`.

Lenses: UI/UX, architecture and state. No API, migration, or operations contract changes. Read `user-intent.md` first.

## 1. Problem contract

**Root problem.** Julian wants to move the Work cursor to a row by typing part of its name. Today `/` focuses a filter field at the top of the page. The filter hides rows. It does not move the cursor, and it does not remember a pattern for repeat jumps. A jump costs: press `/`, type, press Escape, then `j` or `k` to the row. Vim does the same jump in `/`, type, Enter, and repeats it with `n`.

**Constraints.**

- ADR-0038: one visible surface owns each key. A context-local letter is legal only inside a surface that displays it.
- One Work command registry (`work-commands.js`) is the source of keys, labels, and help.
- Escape unwinds only the top Work constraint, in the settled order: transient surface, staged Focus, search, applied Focus, then the Work tab (ADR-0038, `unwindWork`).
- The navigation model record (`../agent-shell-navigation-model/design-record.md`, 3.2) decides: where a text input owns focus, arrows move the list and letters type. A full Vim command line is rejected there (candidate B). This design adds no command line. It adds a search line, which Vim also separates from `:`.
- Background polls never rebuild the screen while a text field has focus (`editingSurfaceOnScreen`).

**Non-goals.**

- Regular expressions, `?` backward search, search offsets, search history. `?` stays the key sheet.
- Search in the Document reader, Go To, or the Area page. Go To already covers global teleport. The reader has its own `n`/`N` for comments.
- Persisting the pattern across reloads.

**Success conditions.**

1. From any Work row: `/`, type three letters, Enter. The cursor sits on the first matching row after the origin, the row is on screen, and its control has focus.
2. `n` and `N` move between matches with no repaint delay that Julian notices. The bar shows which match this is (`2/5`).
3. Escape while typing returns the cursor and scroll to where `/` was pressed. Escape after Enter clears the pattern and the highlights.
4. A row inside a folded Goal or sub-Area is reachable by search.
5. No top search field remains. The filter behavior is gone with it.
6. Every key the bar accepts is printed in the bar.

## 2. Current system (Observed)

- `/` is the registered `filter` command (`work-commands.js`, id `filter`, scope `work`). `executeWorkCommand("filter")` focuses `#work-search` (`shell-event-bindings.js:701`). `⌘/` (`KEYMAP.findWork`) and the app-bar `Find work` button call `showWork({ focus: true })`, which focuses the same input (`shell-coordinator.js:289-297`).
- The input lives inside `renderWork()` (`work-desk-view.js:2055`). Every keystroke sets `state.query`, re-renders the whole Work screen, then re-finds the input and restores the caret (`shell-event-bindings.js:2065-2072`). Tests re-query the input after each keystroke for this reason.
- `filteredDeskAreas(query)` (`work-desk-view.js:821`) drops whole Areas whose text lacks any query term. Terms come from `searchTerms`, which normalizes text and removes filler words. The empty case prints `No work matches "..."`.
- `#filter-count` (`shell.html:86`) is a polite live region outside `#screen`. `announceWorkCount()` writes the caption count or the empty-state text into it.
- `state.query` is part of the return point (`shell.js:628`) and of the Go To capture keys (`go-to-core.js:18`). Command-J and Back restore it. Six test files prove that (`area-focus-ui`, `document-peek-ui`, `focus-shell-goal-brain-ui`, `focus-shell-work-navigation-ui`, `keyboard-ownership-ui`, `work-table-ui`).
- `unwindWork()` clears `state.query` as the third Escape stage and refocuses the input.
- Cursor movement: `visibleCursorRows()` returns `[data-work-cursor]` rows that are not `hidden`; `setWorkCursor(row, focus)` remembers, repaints, and focuses the row control. `j`/`k`, `gg`/`G`, `{`/`}` use it (`shell-event-bindings.js:2577-2586`).
- Hidden rows exist in the DOM: subgoals under a collapsed Goal carry `hidden`; rows under a folded sub-Area are hidden by the fold. The `expand` command (`l`) opens one level. `firstChildWorkRow` and `ownerHeaderRow` walk the tree.
- `n` is taken: the `note` command (scope `area`, "Capture note"). `N` is free. In the Document reader `n`/`N` move between comments.
- `.toast` is a fixed element at bottom right, outside `#screen`, so it survives repaints (`shell.css:1555`). It is the only fixed bottom chrome.
- The Area page has its own `#area-search` with staged Escape and an expand-parents-on-match rule (`shell-event-bindings.js:2050-2058`). That rule is the closest internal precedent for "reveal a hidden match".

## 3. Precedent

**Internal.**

- Go To (`⌘K`): text input owns focus, arrows move the list, Enter acts, Escape closes. Same shape as the proposed bar while it is open.
- Area search: typing expands parent Areas so a match is visible. Reused for folded rows.
- Document reader `n`/`N`: "next and previous thing" letters already mean movement on a surface that displays them.
- `#filter-count` and `.toast`: chrome outside `#screen` is the established way to keep an element alive across repaints.

**External.** Vim `/` with `incsearch` and `hlsearch`: the cursor follows the pattern while typing, Enter keeps the pattern and the cursor, Escape restores the origin, `n`/`N` repeat, wrap prints a notice, `:noh` clears highlights. Vim opens a closed fold when a search lands inside it (`foldopen` includes `search`). Julian named Vim as the model, so the analogy is the requirement, not a decoration.

## 4. Lens analysis

### 4.1 UI/UX

**Intent and common path.** "Get to that row." The path is `/`, three letters, Enter. Repeat with `n`. The bar must not need reading; the count and the printed keys are enough.

**Complete workflow.**

1. Cursor on a row. Press `/`. The bar appears at the bottom, left aligned: `/` then an empty input, then a count slot, then printed keys `↵ jump  ↑↓ next/previous  esc cancel`. Input has focus. The cursor, scroll, and fold state are saved as the origin.
2. Type. After each keystroke: matching rows get a `search-match` class; the cursor moves to the first match at or after the origin, wrapping; the matched row is scrolled into view (`block: "nearest"`); the count reads `1/5`. Focus stays in the input. No match: count reads `no match` in the quiet red used for errors, cursor stays at the origin, highlights clear.
3. `↓` / `↑` while typing move to the next or previous match. Same as Go To arrows.
4. Enter. The bar stays visible in quiet style: `/pattern  2/5  n next  N previous  esc clear`. The input loses focus. Focus and the cursor go to the match row control. Keys return to Work.
5. `n` / `N` in Work while a pattern is set: move between matches, update the count. At the wrap, the count slot prints `wrapped` for one move, like Vim's notice.
6. Escape while typing: restore origin cursor, scroll, and folds opened by this search. Close the bar. Pattern is dropped.
7. Escape in Work with a pattern set: clear the pattern and highlights, close the bar. Same slot as today's query clear in `unwindWork`. Folds opened by the search stay open; Julian is looking at that row on purpose.
8. `⌘/` or the `Find work` button from any view: go to Work, then step 1.

**Visible state.** The bar is the only mode indicator. Bar absent means no search. Bar open with focus means typing. Bar quiet means pattern set and `n`/`N` live. This satisfies the ADR-0038 rule for context-local letters: `n` means "next match" only while the bar prints `n next`.

**Empty, stale, and error states.** No rows on the page: `/` still opens, count reads `no match`. A poll repaints the table while the pattern is set: highlights are re-applied from state during paint, so they survive. A match row disappears after a repaint: `n` moves to the nearest following match; when none is left the count reads `0/0`.

**Dangerous actions.** None. Search never opens a session or changes a Goal. The only side effect is opening folds.

**Accessibility.** The input has `aria-label="Search Work"`. The count writes into `#filter-count`, the existing polite live region, so a screen reader hears `2 of 5`. `n` and `N` get `aria-keyshortcuts` through the registry. The bar's printed keys are buttons, so a pointer user has the same three actions.

**Expert efficiency.** Home row only. No Escape before `n`. No caret restoration dance, because the bar is outside `#screen` and is never rebuilt.

**Cognitive cost of a new persistent element.** The bar is present only during and after a search. It replaces the always-present top field, so the page loses one element in the idle state.

### 4.2 Architecture and state

**Where the pattern lives.** `state.search = { pattern: "", origin: null }` replaces `state.query`. `origin` is `{ workCursor, scrollTop, openedFolds: [] }` and is non-null only while the bar has focus. The return-point capture (`shell.js:628`, `go-to-core.js:18`) records `search.pattern` in place of `query`, so Command-J and Back restore a live `n`/`N` after a session visit. No new return mechanism is added; the navigation record's consolidation (decision 5) applies later and unchanged.

**Matching.** One pure function, `workSearchMatches(rows, pattern)`, in a new `work-search-core.js` with no DOM writes: input is `[{ cursor, text, hidden }]`, output is the ordered cursor ids that match. Text is the row's title, Area path, and state text, normalized with the existing `normalizedSearchText` from `go-to-core.js`. A pattern with spaces matches when every word is present, the convention Go To and the Area search already use. The row builder writes the searchable text into `data-search-text` so the matcher does not read rendered markup.

**Ordering and wrap.** Rows in document order. "First match at or after the origin" is `matches.find(index >= originIndex) ?? matches[0]`. `n` is the next index after the cursor, wrapping; `N` the previous.

**Reveal.** When the target row is hidden, the search opens each ancestor: the collapsed Goal for a subgoal (`data-subgoal-of` chain), and the folded sub-Area or Area header for rows under it (`ownerHeaderRow`). Each opened fold id is pushed to `origin.openedFolds`, so Escape while typing can close them again. This reuses the existing `expand` logic rather than a new fold writer.

**Paint.** Highlights are a class computed during `paint` from `state.search.pattern`, the same way `cursor` is. The bar element is static in `shell.html` next to `#toast`; `paint` updates its text and hidden state. No caret restoration is needed because the input is never replaced.

**Registry.** `filter` is replaced by three records: `search` (`/`, scope `work`, "Search rows"), `nextMatch` (`n`, scope `work`, "Next match"), `previousMatch` (`N`, scope `work`, "Previous match"). `nextMatch` and `previousMatch` are available only while `state.search.pattern` is set. This is the per-object availability the navigation record decides in 3.3, applied to state instead of object kind.

**Keyboard ownership.** The open bar is `text-entry` in `resolveKeyboardContext`; no change to the priority list. A `handleSearchBarKey` owns Enter, Escape, `↓`, `↑` in the input, following `handleAreaSearchKey`. `⌘K` in the bar is handed to the global handler as the other inputs do.

## 5. Candidate designs

**A. Jump search in a bottom bar, filter removed (selected).** Matches Vim and the request. Removes one input and one rebuild-per-keystroke path. Cost: six test files change, and the "narrow the table" use is lost.

**B. Jump search in a bottom bar, filter kept under another key.** Keeps narrowing. Cost: two search mechanisms with two state fields and two Escape stages. Contradicts the one-way-per-action rule and Julian's "instead of". Area Focus (`f`) already narrows by Area, and Go To teleports across everything, so the filter's remaining use is small.

**C. Keep the top field, add `n`/`N` to it.** Cheapest. Fails the request on position and on feel: the field is rebuilt each keystroke, and a filter cannot express "next match" because non-matches are gone.

**D. Fold the search into Go To.** Go To is a global teleport that switches views and objects. A local walk inside the current table is a different intent (navigation record 3.5 keeps both ranks). Rejected.

## 6. Decisions

1. `/` opens a search bar fixed at the bottom of the shell, outside `#screen`. The top filter field and `filteredDeskAreas` are removed. Reason: Julian's words, and one input fewer to rebuild.
2. Search moves the cursor and highlights matches. It never hides rows. Reason: Vim semantics; `n` needs non-matches to stay in place.
3. Incremental: the cursor follows the pattern while typing, from the origin row forward with wrap. Enter confirms, Escape restores the origin. Reason: Vim `incsearch`; the origin restore is what makes exploratory typing safe.
4. `n` and `N` repeat forward and backward, wrapping, while a pattern is set. The bar prints them. Reason: Vim. Julian removed the `note` shortcut on 2026-08-28 ("I don't care about it"), so `n` has one meaning in Work. Capture note stays a `:` menu entry only. Superseded text: an earlier draft let `note` yield to search while a pattern was set.
5. `↓` and `↑` move between matches while the bar has focus. Reason: the arrows-move-while-typing rule from the navigation record 3.2.
6. Hidden rows are searchable; landing on one opens its ancestors. Escape while typing closes the folds this search opened. Reason: Vim `foldopen`, and a folded Goal must not be a dead zone.
7. Multi-word patterns match when every word is present, case-insensitive, no regex. Reason: the existing `searchTerms` and Go To convention; internal consistency over Vim's literal match.
8. The pattern is part of the return point in place of `query`. Reason: Command-J to a session and back must keep `n` working.
9. The bar prints its keys in every state and offers them as buttons. Reason: mouse parity (navigation record 3.6) and the printed-shortcuts rule.
10. Count and no-match text go to `#filter-count`. Reason: reuse the live region that already exists for search feedback.
11. `⌘/` and `Find work` open the bar from any view. Reason: keep the one global entry to Work search.

## 7. Rejected alternatives

- **Inline `<mark>` on the matched letters.** Better scanning, but the row renderer would need to split titles on every paint. A row-level highlight reads well enough at table density. Reconsider if Julian asks for it.
- **Persist the pattern in `localStorage` like the cursor.** A stale pattern after a reload would put `n` in a mode Julian did not choose. Vim's register persistence is a shell feature, not a page feature.
- **`?` as backward search.** `?` is the key sheet everywhere in Agent Shell and the reader. `N` covers backward movement.
- **Smartcase.** Titles are mixed case and Julian types lowercase. Always case-insensitive is one rule fewer.
- **Search only visible rows.** Simpler, but a subgoal folded under its parent becomes unreachable, which is the trap the request is about.

## 8. Risks, assumptions, unknowns

- Julian confirmed on 2026-08-28: delete the search field, Area Focus (`f`) is his filter. Candidate B is closed.
- **Risk:** a repaint per keystroke on large tables. Today's filter already repaints per keystroke over the same table. If it is slow, apply and remove the `search-match` class directly instead of a full paint.
- **Unknown:** whether a match count in the bar is enough, or whether the matched rows should also get a gutter mark visible when scrolled far away. Cheap to add later.
- **Reconsider when:** assignment rows land under Goals (navigation record 3.1). They should be searchable through the same `data-search-text` attribute with no matcher change.

## 9. Sources

- `packages/agent-shell/app/public/work-commands.js` (registry, `filter`, `note`)
- `packages/agent-shell/app/public/shell-event-bindings.js:79-105, 118-126, 695-705, 2044-2072, 2282-2286, 2350-2364, 2422-2440, 2555-2640`
- `packages/agent-shell/app/public/work-desk-view.js:805-840, 2030-2060`
- `packages/agent-shell/app/public/shell-coordinator.js:289-297`
- `packages/agent-shell/app/public/shell.js:628, 1155-1165`
- `packages/agent-shell/app/public/keyboard-context.js`
- `packages/agent-shell/app/public/shell.html:15-30, 80-87`; `shell.css:350-370, 510-511, 1555-1559`
- `docs/decisions/ADR-0038-*.md`
- `docs/design/agent-shell-navigation-model/design-record.md` (3.2, 3.3, 3.5, 3.6, candidate B)
- Tests that drive the current filter: `area-focus-ui`, `document-peek-ui`, `focus-shell-goal-brain-ui`, `focus-shell-work-navigation-ui`, `keyboard-ownership-ui`, `work-table-ui` (`.test.mjs`)
