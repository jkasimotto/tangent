# One enter key in Agent Shell: design record

Date: 2026-08-28

Status: implemented 2026-08-28, in the commit that adds this record. Amends one row of `../agent-shell-navigation-model/design-record.md` (section 3.3, verb "Enter").

Lens applied: UI/UX. No boundary, storage, or runtime contract changes.

## 1. Problem contract

Julian wants one key that goes into a thing and comes back out of it. Commit `3b1b953` made `⌘⇧↵` enter and leave the live session. He asks whether the same key should open and close a Goal reader too, and how he then picks between the Goal and its agent.

Root problem: a Goal row has two things to enter. The Goal itself is a Document (the reader). The Goal's agent is a tmux session (the terminal). One key with one meaning cannot pick between them without a second rule.

Constraints:

- ADR-0038: the terminal keeps every key except one visible leave key. Any key that must work inside the terminal must be that key.
- `⌘↵` submits forms across the product (`handleCommandEnter`). It is not free.
- Plain `↵` inside the terminal is the shell's Enter. It cannot leave the terminal.
- Escape is the product-wide Back (ADR-0038). It already leaves the reader. Tmux owns Escape inside the terminal.
- Nothing is discoverable that the UI does not print (UX principle: no hidden features).

Success conditions:

1. From any Work row, one key enters the live agent, and the same key comes back. Observed today: true for `⌘⇧↵`.
2. From any Work row, one key opens the Goal, and the same key comes back.
3. Julian can predict which of the two he gets without reading anything.
4. The key that opened a layer is printed on that layer's close control.

Non-goals: no change to `⌘K`, `⌘/`, letter verbs, or the terminal byte sequences for `⇧↵` and `⌘↵`.

## 2. Current system (Observed, working tree at `3b1b953`)

| Key | Work row: Goal with an agent or a launchable step | Work row: Goal with no agent | Area row | Inside reader | Inside terminal |
|---|---|---|---|---|---|
| `↵` | opens the session, or the launch editor (`data-open-goal-run`, `work-desk-view.js:1689`) | opens the reader (`data-open-close` → `openDocument`, `shell-event-bindings.js:1626`) | fold or open Area | reader's own Enter | shell Enter |
| `o` | opens the reader (`readGoal`, `:776`) | same | Area note | none | shell `o` |
| `⌘⇧↵` | opens the session, else toast "no live session" (`enterCursorSession`, `:605`) | toast | opens the live brain, else toast | swallowed (`:2600`) | leaves the session (`:2609`) |
| `Escape` | nothing to leave | same | same | `leaveReader` → return point (`shell.js:1120`) | owned by tmux |

Two things follow from the table.

- Plain `↵` already changes meaning by row state. On a Goal with an agent it enters the agent. On a Goal without one it opens the reader. Julian cannot predict it from the key alone; he must read the row's state.
- `⌘⇧↵` and `↵` are duplicates on a Goal row with a live agent. Two keys, one action, no key for the other object.

Precedent inside the product: the reader already has a "return to the live thing" idea. `openReaderAgent` (`shell-event-bindings.js:49`) opens the Goal's agent from inside the reader, and `returnsToBrain` (`shell.js:1125`) decides where the reader goes back to. The return-point mechanism restores the opener when a layer closes.

## 3. Candidate designs

### A. One key that cycles: `⌘⇧↵` goes Work → reader → agent → Work

Rejected. The key's meaning depends on where you are. From the reader it means "go deeper", from the terminal it means "go back". A user who wants the agent must pass through the reader. It hides a mode in the key.

### B. Two keys, two nouns: `↵` opens the object, `⌘⇧↵` opens the live thing (selected)

- `↵` on a row opens the object under the cursor: a Goal opens its reader, an Area folds or unfolds as today. `↵` never starts or attaches an agent.
- `⌘⇧↵` on a row opens the live thing: the Goal's agent session, the step's session, the Area's brain. It never opens a document. With no live thing, the toast stays as today.
- Both keys are toggles. `⌘⇧↵` inside the terminal leaves it (today). `Escape` inside the reader leaves it (today). The reader's close control prints `Esc`; the session header prints `⌘⇧↵`.
- The two layers stack. `⌘⇧↵` inside the reader opens that Goal's agent, and `⌘⇧↵` inside that terminal returns to the reader, because the return point is the reader. Today the reader swallows `⌘⇧↵` (`:2600`); that branch becomes a call to `openReaderAgent`.
- `o` becomes an alias of `↵` on Goal rows, kept for one release so the printed `o read` caption does not lie. It can be retired later.

Why this is predictable: Shift is the only difference, and Shift means "the hot one". Plain Enter reads. Shifted Enter runs. The rule holds on every row and inside both layers.

Cost: plain `↵` on a Goal with a running agent changes from "enter agent" to "open reader". This is the one behaviour Julian may feel as a regression. It is also the case where today's `↵` already duplicates `⌘⇧↵`, so nothing becomes unreachable.

### C. `⌘⇧↵` is universal; a second chord (`⌘↵`) opens the reader

Rejected. `⌘↵` submits forms in the launch editor, harness editor, and comment composer. Reassigning it inside Work only creates the sibling-context collision the navigation record forbids (section 3.3, last paragraph).

### D. Keep plain `↵` as "primary route" and only add reader-leave to `⌘⇧↵`

Rejected. It keeps the state-dependent `↵` and makes `⌘⇧↵` mean "leave whatever is open" from inside a layer but "enter the agent" from Work. That is candidate A's hidden mode with fewer steps.

## 4. Lens analysis: UI/UX

Traced workflow, "check what a Goal says, then talk to its agent":

1. In Work, `j` to the Goal. `↵`. Reader opens; return point is the Work cursor.
2. Read. `⌘⇧↵`. The Goal's agent terminal opens over the reader; return point is the reader.
3. Type to the agent. `⌘⇧↵`. Back in the reader at the same scroll position.
4. `Escape`. Back on the same Work row.

Every step is one key. No step needs the row's state. The mouse path exists for each: the row title, the reader's "Open agent" button, the session header's "Work" button, the reader's close control.

States that can occur:

- Goal with no session: `⌘⇧↵` toasts "This Goal has no live session to enter." (today). Plain `↵` on the same row asks the brain to start an agent. Decision 6 gives `⌘⇧↵` that route.
- Goal file removed: `↵` toasts "removed from the vault" (today).
- Reader opened from a brain terminal (`returnsToBrain`): `⌘⇧↵` in the reader opens the Goal's agent, not the brain; `Escape` returns to the brain as today. No change.
- Definition rows: `⌘⇧↵` enters the definition session (today). `↵` on a definition row has no document; it keeps today's route.

Feedback: opening a layer is instant; no progress state is needed. Starting an agent from the launch editor is the only slow path and already has its own surface.

Accessibility and expert efficiency: `aria-keyshortcuts` and the key sheet come from the registry (`work-commands.js`), so the new meaning of `open` prints itself. Both keys remain reachable on every keyboard layout; `⌘⇧↵` needs no character key.

Cognitive cost: this removes a rule (Enter depends on row state) and adds none. The product-wide pattern "plain key reads, shifted key runs" is one sentence.

## 5. Decisions

1. `↵` on a Work row opens the object: Goal reader, Area fold. It never enters or starts an agent. (Decision; amends navigation-model 3.3 row "Enter".)
2. `⌘⇧↵` is the only "live thing" key: agent, step session, brain. It toggles from Work, from the reader, and from inside the terminal. (Decision)
3. Inside the reader, `⌘⇧↵` opens the Goal's agent through `openReaderAgent`; the terminal returns to the reader. (Decision)
4. `Escape` stays the reader's leave key and gets printed on the reader's close control. `⌘⇧↵` inside the reader does not close it. (Decision; ADR-0038 Back contract unchanged)
5. `o` on a Goal row stays as an alias of `↵` for one release, then is removed with its caption. (Decision)
6. When a Goal has no live session, `⌘⇧↵` takes the route the row's Open control already takes: it asks the Area brain to start an agent (`askBrainToStart`), because only the brain starts agents (D8, `work-table-ui.test.mjs` "no Goal row opens a launch chooser"). There is no launch editor on a Goal row; an earlier draft of this record assumed one. (Decision; keeps "the live thing" reachable from one key on every Goal)

## 6. Rejected alternatives

- Cycling key (A): hides a mode in one key.
- `⌘↵` for the reader (C): collides with form submit.
- Keep state-dependent `↵` (D): keeps the rule this design exists to remove.

## 7. Risks, assumptions, unknowns

- **Unknown (Julian):** whether losing "plain Enter enters the running agent" feels like a regression in daily use. The agent stays one chord away. If it does, the fallback is D with its cost stated above.
- **Assumption:** the Goal reader can be a return point for the session layer. `state.documentReturn` and the session layer's return path are separate mechanisms today (navigation record 2.3). The layering in decision 3 depends on the return-point consolidation that record already decided, or on a small local case for reader → session → reader.
- **Risk:** tests pin plain Enter on a Goal row to the run route (`work-table-ui.test.mjs`, `focus-shell-work-navigation-ui.test.mjs`). They change with the behaviour; they are not evidence against it.
- Reconsider if a third enterable thing appears on one row (for example an Assignment row with both an instruction document and a session). The same rule applies: plain opens the document, shifted opens the session.

## 8. Sources

- `packages/agent-shell/app/public/shell-event-bindings.js`: `enterCursorSession` (605), `executeWorkCommand` open/readGoal (776, 793), `data-open-close` (1626), `data-open-goal-run` (1445), reader `⌘⇧↵` swallow (2600), session leave (2609), `leaveReader` (2734)
- `packages/agent-shell/app/public/work-desk-view.js`: `titleRoute` (1689), route decisions (1311-1314, 1407-1408)
- `packages/agent-shell/app/public/shell.js`: `KEYMAP` (55-59), `leaveReader` and `returnsToBrain` (1120-1129)
- `packages/agent-shell/app/public/work-commands.js`: `open`, `readGoal`, `session` records
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md`
- `docs/design/agent-shell-navigation-model/design-record.md`, sections 2.2, 3.3, 3.5
- Commit `3b1b953` (Command-Shift-Enter enters and leaves the live session)
