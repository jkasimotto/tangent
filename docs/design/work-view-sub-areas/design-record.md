# Work view: reach sub-Area brains. Design record

Date: 2026-08-28

Status: proposed. No code changes accompany this record.

Lenses applied: UI/UX. The change touches one interactive workflow (Work) and one stored browser preference (fold state). No package, API, migration, or operations contract changes.

Builds on `../work-view-affordances/vision.md` (triangle fold, printed keys, caption line), `../agent-shell-navigation-model/design-record.md` (one cursor, `{`/`}` between Areas), and `../agent-shell-operating-vision/vision.md` (`a` messages the brain, `b` opens it). This record does not reopen those decisions.

## 1. Problem contract

Julian's words: "I need to be able to access sub areas as well somehow. See how it's giving me goals from subareas? That is good and fine. But if I want to activate the brain of a subarea I have no way of doing that. We probably do want to see the subareas still I think. And { and } jump between the visible areas (ie those that are not hidden by collapse)."

Root problem: Work shows the Goals of every sub-Area under the top-level Area, but only the top-level Area has a header row. `b` and `a` act on the header of the group. A sub-Area brain has no row, so it has no key, no button, and no visible state.

Constraints, from Julian's standing rules:

- No hidden features. Every shortcut is printed.
- One way per action.
- One foundational surface. Work is the tree.
- Selection never spawns anything.
- No invented terms. "Sub-Area" is already in `agent-map-core.js` (`subAreaOf`) and in `AGENTS.md` ("nested Area").

Non-goals:

- No change to which Areas become top-level groups (`deskPanels`).
- No change to the `Other Areas` group.
- No change to the Areas map or to Go To.
- No new storage key.

Success conditions:

1. From Work, keys alone reach the brain of any sub-Area that has open work, in a predictable number of presses.
2. A sub-Area brain that needs a decision is visible while its rows are folded.
3. Neara with 25 open Goals does not get harder to scan than today.
4. `{` and `}` visit every Area header that is not hidden by a fold, at both levels.

## 2. Current system

All facts Observed on 2026-08-28 in the working tree unless marked.

### 2.1 Grouping

- `deskPanels` in `packages/agent-shell/app/public/area-map-core.js:175-190` makes one panel per top-level Area (`parts.slice(0, 2)`, that is `neara`, `otto`). Every deeper Area with open work becomes a `section` of that panel. Sections are provenance, not peer panels.
- `deskAreas` in `work-desk-view.js:952-1000` builds the panel records. `workOf(path)` (`:966`) collects only the Area's own trees. `openCounts` (`:971-976`) counts open Goals per exact Area.
- `workGroupBody` (`:1693-1713`) renders one `<tbody data-work-group="<root>">` per panel. It flattens `[{ area, trees }, ...sections]` into Goal rows in path order. There is no row for a section.
- `workGroupHasRows` (`:1677-1688`): an Area earns a header when it has an open Goal row anywhere in its sections, or a live brain.

### 2.2 The path tag

- `descendantLabels` (`:1508-1523`): the tag is the last path segment when unique inside the group, else the relative path. `descendantPath` (`:1497-1502`) joins `areaParts` with ` / `.
- `workGoalRow` (`:1626-1656`): the tag prints as `<small class="work-row-path">` after the title. CSS `shell.css:584` makes it 10px, uppercase, muted. On the screenshot, `ESSENTIAL / AUTODESIGN`, `PG&E`, `PG&E / AUTODESIGN`.
- The tag is not interactive. It is the only place a sub-Area appears on Work.

### 2.3 Brain state per Area

- `brainForAreaCard(areaPath)` (`:343-345`): exact path match only. "A parent card never shows a child brain."
- `brainStateLabel` (`:348-361`), `brainKind` (`:363-367`): `live` + `waiting` + `stateDetail === "decision"` is "Brain needs a decision". The amber dot is class `waiting`.
- `areaQuestions(path)` (`:845-849`) does roll up: it filters `brain.area === path || brain.area.startsWith(path + "/")`. So the top-level header's `1 question r` and its `r` review already include child brains. `areaBlockers` (`:857-872`) uses it. This is the one place a child brain reaches the parent header today.
- `state.brains` comes from `readAllBrains(BRAINS_ROOT)` (`server.mjs:5749`). Every `brain.json` record is sent, live or not.
- Server: `liveBrainForArea` (`server.mjs:4114-4118`) is exact-match too. A Goal's prompt names the brain of its own Area, never the parent.

### 2.4 Keys and the cursor

- Registry `work-commands.js:8-31`. `{`/`}` already exist as `previousArea` / `nextArea` (`:11-12`), help "Jump to the previous real Area header."
- `moveAreaCursor` (`shell-event-bindings.js:143-162`): collects visible `tbody[data-work-group]` that contain a `[data-work-command='openBrain']` button, so `Other Areas` is skipped. It clamps at both ends. No wrap.
- `j`/`k` (`:2572-2576`): move over `visibleCursorRows()` (`:119-121`), every `[data-work-cursor]` row that is not `hidden`.
- `h`/`l` (`collapseWorkTree`, `expandWorkTree`, `:193-215`). On a header row `h` folds the group. On a folded header `h` does nothing. On a Goal row `h` goes to the header. `l` unfolds or moves to the first child. `treeCommandAvailability` (`:631-642`) explains refusals with a toast.
- `b`, `a`, `r`, `s`, `d`, `n` (`executeWorkCommand`, `:645-676`) resolve `commandAreaForRow(row)` (`:129-133`). That is the `data-work-group` of the enclosing `tbody`, only when that group has a brain button. On any Goal row of Neara, `b` opens the Neara brain.
- `r` is two verbs (`:2604-2609`): questions on a header, resume on a Goal row.
- Caption (`workCaptionHint`, `work-desk-view.js:1936-1940`) prints `captionKeysByRow[kind]` from `work-commands.js:57-86`. Row kind is the cursor prefix (`area:`, `goal:`, `definition:`). `{`/`}` are not in the caption today. They are in the `?` sheet (`openWorkKeySheet`, `shell-event-bindings.js:536-543`, registry driven).
- Fold click: `data-work-tree-action` on the triangle (`work-desk-view.js:49`, handled at `shell-event-bindings.js:1570-1571`) runs the same `collapse`/`expand` command.

### 2.5 Fold state

- `state.foldedWorkAreas` and `state.expandedAreas` (`shell-state.js:32-33`), stored as `agent-shell.folded-work-areas` and `agent-shell.expanded-areas` in `localStorage`.
- `areaIsFoldedOnWork(path)` (`work-desk-view.js:1723-1730`) and `setWorkAreaFolded(area, folded)` (`:1733-1745`) take any path string. Nothing limits them to top-level paths. `OTHER_AREAS_KEY` already proves a non-Area key works.
- Without an Area Focus, a group is open unless Julian folded it. With a Focus, only the first root opens by default.

### 2.6 Other reach paths today

- Go To (`⌘K`) lists brains (`go-to-core.js:59-62`, `shell-coordinator.js:57`). This is the one keyboard path to a sub-Area brain today. It is a search, not a scan, and it shows no state on Work.
- The `areas` tab is hidden (`agent-shell-navigation-model/design-record.md` section 2.1).

## 3. The real shape

Observed from `tangent area list`, `tangent goal list`, and `~/.tangent/agent-shell/brains` on 2026-08-28.

- 2 top-level Areas: `neara`, `otto`. Only `neara` has open Goals, so Work shows one header. `otto` has no row.
- 34 Areas in the vault. Depth 2: 13. Depth 3: 15. Depth 4: 4.
- 17 `brain.json` records. Depth 1: 1 (`neara`, active, live, needs a decision). Depth 2: 10. Depth 3: 5. Depth 4: 1 (`viz-input`). Statuses: 1 active, 6 inactive, 7 ended, 3 stopped. One live brain in total.
- 33 open Goals by the CLI. Work shows 25. The 8 missing are under `neara/hackathon`, an Area with `status: done`. Its `live-edit` sub-Area alone holds 7 open Goals. This record treats the done Area as hidden by design and does not reopen that.

The 25 Goals on the Neara header, by exact Area, in path order:

| Area | Depth | Open | Brain record |
|---|---|---|---|
| `neara` | 1 | 2 | active, live |
| `neara/essential/autodesign` | 3 | 1 | inactive |
| `neara/pgande` | 2 | 1 | inactive |
| `neara/pgande/autodesign` | 3 | 5 | none |
| `neara/pgande/benchmarking` | 3 | 3 | none |
| `neara/pgande/dashboards` | 3 | 1 | none |
| `neara/pgande/megabranch` | 3 | 2 | ended |
| `neara/pgande/megabranch/viz-input` | 4 | 8 | inactive |
| `neara/pgande/standards` | 3 | 1 | ended |
| `neara/portland` | 2 | 1 | inactive |

So: 9 sub-Areas with own open work under one header, 6 of them with a brain record, 5 of them with exactly one Goal. 23 of the 25 Goal rows carry a path tag today. `PG&E / AUTODESIGN` repeats 5 times, `PG&E / MEGABRANCH / VIZ-INPUT` 8 times.

Julian's example in the brief, "4 or 5 sub-Areas", is the depth-2 count (essential, pgande, portland) plus the two autodesign branches. The exact-Area count is 9. The design must fit 9, not 4.

## 4. Internal precedent

- Subgoal rows (`workGoalRow` with `subgoal: true`, CSS `shell.css:579-580`): one indent level, 30px, smaller and lighter title, a fold triangle on the parent, `collapsedGoalTrees` remembered. This is the in-product pattern for "one level below, foldable, remembered".
- `Other Areas` group (`work-desk-view.js:1903-1930`): a header row with counts and no brain button. It shows that a header without a brain button is already a thing, and that `moveAreaCursor` skips it on purpose.
- The Areas map (`area-tree-row`, `shell.css:786`) indents by `--area-depth * 25px`. Depth indent is an existing visual language.
- `areaQuestions` roll-up (section 2.3): the parent already summarises child questions. The design keeps this.

## 5. External precedent

These are recalled product behaviors, not inspected in this session. Marked Assumption where the detail matters.

- Linear: issues group under a header per project or per team with a count on the header, and each group collapses. Transfers: a thin group header with a count, folded groups keep their count. Assumption: Linear has no `{`/`}` group jump, its group headers are pointer targets.
- Things: headings inside a project, each with its own disclosure, to-dos under them. Transfers: a heading is a light row, not a card, and it folds alone while the project stays open.
- macOS Finder list view and Mail: an outline with a disclosure triangle per level, Option-click opens all levels. Transfers: one triangle glyph per level, the same glyph at every depth. Also the warning: three or more nesting levels are hard to scan in a list, Finder users fold deep trees.
- GitHub Projects: group by field, each group header shows a count and collapses. Transfers: counts on headers.
- Gmail and Superhuman: `[` and `]` archive and move, `{`/`}` are not section jumps. Vim: `{`/`}` move by paragraph, no wrap. Transfers: `{`/`}` as "previous or next block boundary", clamped, which is what Work does today.

## 6. UI/UX lens

Intent and common path: Julian scans Work and sees a sub-Area with work or a decision. He wants to talk to that sub-Area's brain (`a`) or open it (`b`). Second path: `{`/`}` to hop between blocks without reading Goal titles.

What exists and stays: one cursor, `j`/`k`, `h`/`l`, `b`/`a`/`r`/`s`/`d`/`n` on the header that owns the row, the caption line, the `?` sheet, the triangle, `foldedWorkAreas`.

State that must stay visible: a brain that needs a decision (amber), a working brain, the open count of a folded block. Today the parent header rolls child questions into `N questions r`, so the parent already goes amber for a child. The sub-Area row must also show it, so Julian knows which brain.

Empty and partial states: a sub-Area with a live brain and no Goal earns a row (same rule as the top level). A sub-Area with an inactive brain and no Goal earns no row. It is reachable by Go To, as today. A done Area stays hidden with its sub-Areas, as today.

Consequence and feedback: `b` on a sub-Area with no brain record starts one after Julian types a message, as on a top-level header (`openOrStartBrain`). Selection never starts anything. The button label already says which: Open, Resume, or Start.

Workflow traced (after): Julian presses `}` from the Neara header. The cursor lands on `Essential / Autodesign`. `}` again: `PG&E`. `}` again: `PG&E / Autodesign`. `a`, type, `⌘↵`. The brain of `neara/pgande/autodesign` starts with that message. Four keys plus the message. Today there is no path.

## 7. Candidate designs

Row counts are for the Neara block on the real data of section 3.

### A. Sub-Area sub-headers inside the open top-level Area

One thin row per sub-Area that has its own open Goals (or a live brain). Its Goals sit under it. The path tag on those Goal rows goes away because the sub-header names the Area. Each sub-header has its own triangle and folds alone. Sub-headers sit flat under the top-level header, one indent level, named by their path relative to the top-level Area (`PG&E / Megabranch / Viz-input`).

- Headers: 1 top-level + 9 sub-headers. Rows: 35 (was 26).
- Rows the eye passes to reach the `pgande/autodesign` brain: 8 rows down, or `}` three times.
- `{`/`}` visit: Neara, then each of the 9 sub-headers, in order. A folded Neara hides all 9.
- Decision dot: on the sub-header, folded or not. Also on the Neara header through the existing question roll-up.
- Clutter: 9 rows of 24px. Removes 23 tags. Net text on screen goes down. The 5 one-Goal sub-Areas each cost one extra row.
- One mechanism: `b`/`a` act on the nearest header above the cursor, as today. No new rule.

### B. Keep the flat list and tags. Keys act on the Goal's own Area

No new rows. On a Goal row, `b` and `a` act on the brain of the Goal's own Area, and the caption says `b brain of pgande/autodesign`.

- Headers: 1. Rows: 26.
- Reach the `pgande/autodesign` brain: read tags until one says `PG&E / AUTODESIGN` (row 6), then `b`.
- `{`/`}`: nothing to visit but Neara. Julian's `{`/`}` request has no meaning.
- Decision dot: nowhere on a row. Only the parent's rolled-up `N questions`. Julian cannot see which brain.
- Clutter: none added, but the 23 tags stay.
- Two mechanisms: `b` on a header acts on the header, `b` on a Goal acts on the tag. The header no longer owns the rows under it. This breaks `commandAreaForRow` and the "one header owns its rows" rule that `s`, `d`, `n`, `r` all use.
- Sub-Areas with no Goal are unreachable.

### C. A and B together, sub-headers only above a threshold

Sub-headers for sub-Areas with a brain record or 3 or more Goals, tags for the rest.

- On the real data: 8 sub-headers, only `dashboards` stays a tag. Almost A, plus a rule Julian must learn.
- Two mechanisms as in B, for the tagged rows.
- Rejected: the threshold is an invented rule, and it saves one row.

### D. Flatten: every Area with own work is a top-level header

- Headers: 10 peers. `Neara` becomes a header with 2 Goals next to `PG&E / Autodesign` with 5.
- Loses the roll-up: no `25 open · 2 blockers`, no parent amber, no one fold to hide Neara.
- `{`/`}` pass 10 headers with no way to skip a subtree.
- With `otto` active too, 20 or more peers. Rejected.

### E. Nest by direct child only, tags for deeper Areas

Sub-headers for `Essential`, `PG&E`, `Portland`. Deeper Areas as tags relative to the sub-header (`AUTODESIGN`, `MEGABRANCH / VIZ-INPUT`).

- Headers: 1 + 3. Rows: 29. The lightest tree.
- But `viz-input` (8 Goals, a brain record) and `pgande/autodesign` (5 Goals) have no row. Reaching them needs B's second mechanism. Rejected for the same reason as B. Kept here as the strongest low-clutter alternative.

### Comparison

| | Headers on Neara | Rows | Reach `pgande/autodesign` brain | `{`/`}` visits | Amber visible when folded | Mechanisms |
|---|---|---|---|---|---|---|
| Today | 1 | 26 | no path | 1 | parent only | 1 |
| A | 10 | 35 | `}` x3 then `a` | 10 | sub-header and parent | 1 |
| B | 1 | 26 | read tags, `j` x5, `b` | 1 | parent only | 2 |
| C | 9 | 34 | as A | 9 | as A | 2 |
| D | 10 | 35 | `}` x3 | 10 | own header only | 1 |
| E | 4 | 29 | read tags, `b` | 4 | depth 2 only | 2 |

## 8. Evidence and counterexamples

- Counterexample to "sub-headers add clutter": today 23 of 25 rows already carry a tag in uppercase. A repeats the same 8 characters 8 times for `viz-input`. Sub-headers print each Area once.
- Counterexample to "one indent level is enough": `neara/pgande/megabranch/viz-input` is depth 4. A flat sub-header list handles it as one row named by its relative path. A nested outline needs a `Megabranch` row with 2 Goals holding a `Viz-input` row with 8. Flat wins on rows and on the "three levels are hard to scan" precedent.
- Failed generalization: "the parent header can act on child brains" (a `b` menu listing child brains). Rejected. It hides a list behind a key, against "no hidden features", and it makes `b` a chooser on some rows and an action on others.
- The `Other Areas` group already shows that a header without a brain button is skipped by `{`/`}` on purpose. Sub-headers print a brain button, so the existing filter in `moveAreaCursor` includes them with no rule change.

## 9. Decisions

1. **Decision: candidate A.** One sub-header row per sub-Area with its own open Goals or a live brain. The rows sit flat under the top-level header, one indent level, in path order. Each is named by its path relative to the top-level Area. The Goal rows under it drop their path tag. The `Other Areas` group keeps tags, it is a view over many Areas.
2. **Decision: one mechanism.** `b`, `a`, `r`, `s`, `d`, `n` act on the nearest header above the cursor, as today. A sub-header owns its Goal rows. The caption on a sub-header row prints the same keys as a top-level header. The brain button on the sub-header says Open, Resume, or Start, as on the top level.
3. **Decision: state on the sub-header.** The sub-header prints its open count. When a brain is live or has a question, it also prints the desk state (`● Brain needs a decision r`, `Brain working`). A sub-Area with no brain and no question prints only the count. The top-level header keeps its rolled-up questions and blockers, so it stays amber when a folded child needs a decision.
4. **Decision: `{` and `}` visit every visible Area header, top-level and sub, in document order, clamped at both ends, no wrap.** `Other Areas` stays skipped. The registry help becomes "Jump to the previous Area header that is not folded away." Both keys join the Area row caption as `{ } areas`. They sit next to `h/l fold`. The `?` sheet already lists them.
5. **Decision: `j`/`k` walk sub-headers like any row.** `h` on a sub-header folds it. `h` on a folded sub-header moves to the top-level header. `l` unfolds it or moves to its first Goal. `h` on a Goal row moves to its sub-header. Same tree rules as today, one level deeper.
6. **Decision: a folded sub-Area hides its Goal rows.** Its row stays with its count and its state. The top-level count still includes those Goals. This is what fold means everywhere else in Work. See the open question for Julian below.
7. **Decision: default open, remembered.** Sub-headers open by default. A fold is stored in the existing `agent-shell.folded-work-areas` set, keyed by the full Area path. No new key. `areaIsFoldedOnWork` and `setWorkAreaFolded` already accept any path.
8. **Decision: a sub-header is a cursor row with id `area:<path>`.** The row kind stays `area`. The caption, the `:` menu, and `commandAreaForRow` need no new kind.

## 10. Rejected alternatives

- **E, nest by direct child only** (strongest). Lightest tree, but two `b` rules and no row for the two busiest sub-Areas. Lost on "one way per action".
- **B, tags plus context-sensitive `b`.** No clutter, but no scan, no `{`/`}`, no visible state, two rules.
- **D, flatten.** Loses the roll-up and turns 1 header into 10 peers.
- **C, threshold.** An invented rule that saves one row.
- **A brain chooser behind `b` on the parent.** Hidden list.

## 11. Risks, assumptions, unknowns

- **Assumption:** 35 rows in one open block scan well because sub-headers are visually distinct (24px, muted, indented, triangle). If not, Julian folds the one-Goal sub-Areas once and the fold is remembered.
- **Assumption:** `moveAreaCursor` can treat a sub-header as a group with a brain button without a rewrite. If sub-headers render inside the parent `tbody`, the filter needs to select rows, not `tbody` elements. Implementation detail, low cost.
- **Unknown:** whether the done-Area rule (`neara/hackathon` hidden with 8 open Goals) is what Julian wants. Out of scope here, noted because it changed the count from 33 to 25.
- **Risk:** `focus-shell-desk-hierarchy-ui.test.mjs` pins the path tag. Dropping the tag under a sub-header changes that test.
- **Risk:** the `Other Areas` group keeps tags while focused Areas use sub-headers. Two looks for the same fact. Acceptable because `Other Areas` is folded by design and has no brain.

## 12. Open questions for Julian

1. Fold hides Goals (Decision 6), or a folded sub-Area still lists its Goals under the parent with tags? Recommend hide. A row that folds and hides nothing is not a fold.
2. Brain button printed on every sub-header (muted, aligned right), or caption only? Recommend printed, same as the top header, so a mouse user sees it.
3. Flat sub-headers with relative path names (Decision 1), or a nested outline per level? Recommend flat. `viz-input` at depth 4 stays one row.

## 13. Mockups

Neara folded (unchanged from today):

```
▸ Neara   25 open · 2 blockers   58 lines · no Current   ● Brain needs a decision r      Open brain b   ⋯ :
```

Neara open with sub-headers (real data, first rows):

```
▾ Neara   25 open · 2 blockers   58 lines · no Current   ● Brain needs a decision r      Open brain b   ⋯ :
    Propose codebase structure v3 (GLM 5.2)                    Ready      -          Open ↵   ⋯ :
    Propose codebase structure v3 (Sonnet)                     Ready      -          Open ↵   ⋯ :
  ▾ Essential / Autodesign   1 open                                               Resume brain b   ⋯ :
      Design a structure/pole diff to replace the ops key-eq…  Ready      -          Open ↵   ⋯ :
  ▾ PG&E   1 open                                                                 Resume brain b   ⋯ :
      Wire a valid RESETDATA_API_KEY into the speedrun pipel…  Ready      -          Open ↵   ⋯ :
  ▾ PG&E / Autodesign   5 open                                                     Start brain b   ⋯ :
      Guy clearances: scope what they are and how work starts  Ready      -          Open ↵   ⋯ :
      Improved drill-down: find Dan's branch                   Ready      -          Open ↵   ⋯ :
      Julian: understand the existing autodesign code          Ready      -          Open ↵   ⋯ :
      Pole diff: define what it actually is                    Ready      -          Open ↵   ⋯ :
      Suppress checks and remediations per element             Ready      -          Open ↵   ⋯ :
  ▾ PG&E / Benchmarking   3 open                                                   Start brain b   ⋯ :
      …
  ▸ PG&E / Megabranch / Viz-input   8 open   ● Brain needs a decision r           Open brain b   ⋯ :
  ▾ Portland   1 open                                                             Resume brain b   ⋯ :
      …
```

The last block above shows a folded sub-header with its amber dot. The 8 Goals are hidden. The count and the state stay. `{`/`}` land on it.

Caption line when the cursor is on a sub-header:

```
b brain · a message · h/l fold · { } areas · r questions · : more · ? all
```

## 14. Sources

- `packages/agent-shell/app/public/work-desk-view.js` (`:343-367`, `:845-872`, `:952-1000`, `:1497-1523`, `:1626-1656`, `:1677-1760`, `:1903-1940`)
- `packages/agent-shell/app/public/area-map-core.js` (`:143-190`)
- `packages/agent-shell/app/public/work-commands.js` (`:8-31`, `:57-86`)
- `packages/agent-shell/app/public/shell-event-bindings.js` (`:119-215`, `:536-543`, `:631-676`, `:1570-1571`, `:2564-2630`)
- `packages/agent-shell/app/public/shell-state.js` (`:32-33`)
- `packages/agent-shell/app/public/shell.css` (`:536-556`, `:579-584`)
- `packages/agent-shell/app/server.mjs` (`:4114-4118`, `:5749`)
- `~/.tangent/agent-shell/brains/**/brain.json`, `tangent area list`, `tangent goal list` (2026-08-28)
- Screenshots `4.png` (Neara folded) and `5.png` (Neara open) from Julian, 2026-08-28
- `../work-view-affordances/vision.md`, `../agent-shell-navigation-model/design-record.md`, `../agent-shell-operating-vision/vision.md`
