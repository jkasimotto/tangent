# Area archive: design record

Date: 2026-08-28. Status: designed, not implemented. Request: `user-intent.md`.

Revision 2026-08-28: Julian said "done can also hide as well. done and archived are different states though good to keep them separate." Decision 3 and the Migration section changed. The first version made `archived` the only hidden state.

## Problem contract

Julian wants to archive an Area. A brain does it when he asks. He can also do it in the UI. The archived state must live in the vault Markdown.

Root problem: Areas are durable subjects, and they accumulate. `neara/hackathon` and its four sub-Areas are finished. Nothing removes a finished subject from the daily surfaces. Each stale Area costs a Work row, a Go To row, an `area list` line, and a possible brain or process run.

Success conditions:

- One command, one UI action, and one Markdown fact put an Area out of view.
- An archived Area is not in Work, not in the Areas directory by default, not in Go To, and not in `tangent area list` by default.
- No brain starts on an archived Area. No process note in it becomes due.
- The archive is reversible with one command and one UI action. Git keeps the history.
- Nothing inside the Area is deleted or rewritten. Goals keep their files and their status.

Non-goals:

- Deleting or pruning vault files.
- Changing Goal status on archive. Goals are Julian's or the brain's word, one at a time.
- Moving the Area directory. See Rejected alternatives.

## Current system

**Observed.** An Area status already exists, and it does most of the job under the word `done`.

- `tangent area done <area>` and `tangent area reopen <area>` post to `/api/areas/status` (`packages/agent-shell/src/cli/commands/area.ts:178-190`). The route accepts only `done` and `active` (`packages/agent-shell/app/server.mjs:6669-6678`).
- `setAreaStatus` writes `status: done` or `status: active` into the Area note frontmatter, creates the note when the Area has none, commits `update: <area> area done|reopened`, and returns the count of open Goals under the Area (`server.mjs:1332-1342`). Goals are not changed.
- The UI has `Mark done` and `Reopen` under the `Area settings` disclosure on the Area screen (`public/area-directory-view.js:278`), with an Undo toast (`area-directory-view.js:51-66`).
- Hiding: the Areas directory folds a done Area and its subtree unless it is selected. A `Show N done Areas` toggle exists, stored in `localStorage` (`area-directory-view.js:43-48, 109-111`, `shell-state.js:37`). Work gives a done Area no top-level header. A done sub-Area keeps a row only while it has open Goals (`work-desk-view.js:930-937`, work-view-sub-areas record).
- Not hidden: `tangent area list` (all 35 Areas print, `neara/hackathon` included). Go To lists every Area and its brain (`public/go-to-rows.js:58`). The brain start path has no Area status guard (`server.mjs:4517`). The process scheduler reads only the process note's own `status: active|paused` (`process-scheduler.mjs:142`).
- Vault: only one Area note carries `status: done` today: `neara/hackathon/hackathon.md`. It hides 8 open Goals (work-view-sub-areas record, line 93 and line 235, marked Unknown there).
- The vault README allows Area note `status` values `planned | active | waiting | paused | done`. `archived` is not in the list.
- The root `AGENTS.md` tells brains: "Only Julian's words change what a Goal is for or close an Area." The brain command list in `~/.agents/AGENTS.md` names `tangent area done|reopen` "only when Julian says so."
- `moveArea` moves a directory with `git mv` and renames the note (`area-operations.mjs:96-118`). Root groups cannot move. `TREE_SKIP` hides `shared`, `.git`, `.obsidian`, `node_modules` from the tree (`server.mjs:523`).
- Area path is the join key for runtime state: the Goal queue lives at `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, brain records are per Area path, tmux sessions carry `@tangent_area`, and process notes resolve by Area (navigation-model record, Domain model).

**Unknown.** The comment on `setAreaStatus` cites "design-area-map Decision 11". That document is not in this repository. Its text was not inspected.

## Internal precedent

- Goal `parked`: "Hide the Goal from default Work without deleting its history" (`shell-event-bindings.js:600`). Archive is the Area-level twin of Park: out of view, nothing deleted, reversible.
- Goal status menu: one modal with lettered options, each with `enabled` and `reason` (`shell-event-bindings.js:597-602`). Archive fits this shape for the Area header.
- The `Show N done Areas` toggle is the exact disclosure pattern an archive needs.
- Journal rollover uses the word `archive` for a file moved beside the active one (`area-brain-domain.mjs:106-114`). That is a file rollover, not a subject state. The two uses do not conflict: one is a Journal file name, the other an Area status.

## External precedent

- Obsidian and most note tools archive by moving a folder into `archive/`. That works when nothing keys on the path. Tangent keys runtime state on the path (Current system), so the analogy fails on the join key.
- Trello, Linear, and GitHub archive a container by a flag: the object keeps its id and URL, leaves default lists, is excluded from search by default, and restores in one action. Nothing inside changes. This matches Tangent's Area path as identity.
- Gmail archive: reversible, one verb, one restore verb, no confirmation. Undo toast after the fact. The UI already does this for Mark done.

## Lens analysis

### UI/UX

- Where the verb lives: the Area header row on Work and the Area screen. Both already have an Area menu or `Area settings`. The navigation-model record assigns `x` to lifecycle on the cursor object. For an Area, `x` opens a status modal with `Mark done`, `Archive`, or `Reopen` when hidden. The mouse gets the same modal from the Area menu and from `Area settings`.
- Wording: `Archive` beside `Mark done`, and `Reopen` for both. Toast: `Hackathon is archived. 8 open Goals stay open and hidden.` with Undo. Directory toggle: `Show N hidden Areas`. The row mark reads `done` or `archived`.
- Refusal reads as a reason on the disabled option, the pattern the Goal modal uses: `A brain is live: neara-hackathon-brain. Stop it first.`
- Open Goals stay hidden with the Area. The count in the toast is the only trace. This is today's behavior for done and is accepted in the work-view-sub-areas record.
- A hidden Area that is selected still shows. That keeps Reopen reachable and keeps a Go To hit readable.

### Architecture, types, and data

- The state is one frontmatter line in the Area note: `status: archived`. The note is the Area's only Markdown record, and the README already reserves `status` there. Git commit is the provenance. This is Julian's "md representation".
- Two hidden states, one meaning each. `done` says the subject reached its end. `archived` says nobody works here anymore, finished or not. Both fold away. One toggle shows both, and the row mark tells them apart.
- Runtime state (queue JSON, brain record, tmux options) stays keyed by the same path. Nothing moves.
- Invariant: archive never changes a Goal file. Reads that filter by Area status filter Goals by ancestor path, as `underDoneArea` does today.

### API

- HTTP: `/api/areas/status` accepts `done`, `archived`, and `active`. Response keeps `{ file, status, openGoals }` and adds `liveSessions` on refusal (HTTP 409).
- CLI: `tangent area archive <area>` beside the existing `tangent area done <area>`. `tangent area reopen <area>` returns either state to active. `tangent area list` omits done and archived Areas. `tangent area list --all` includes them with a status column. `tangent area show` works on an archived Area and prints the status line first.
- Brain contract: `~/.agents/AGENTS.md` and the vault root `AGENTS.md` add `area archive` to the `area done|reopen` line, still "only when Julian says so". Brains already read these files each turn. No new mechanism.
- Brain start: `startBrainUnlocked` and `tangent brain` refuse a done or archived Area with `Area is archived. Reopen it first.` (or `done`). A brain live at archive time blocks the archive (Decision 5).

### Migration and compatibility

- `neara/hackathon/hackathon.md` carries `status: done`. It keeps that status and stays hidden. Nothing migrates.
- README status list adds `archived`. `tangent area done` and `reopen` keep their behavior.
- `localStorage` key `agent-shell.show-done-areas` keeps its name and now shows both hidden states.

### Operations

- Process scheduler: a process note under an archived Area is not due. `tangent process list` prints it with `archived Area` as the state word. No note is rewritten.
- Sessions: archive refuses while any session in the subtree is live. This avoids a reaper rule and a silent kill.

## Candidate designs

| Candidate | Markdown fact | Path stable | Hides everywhere | Reversible | Cost |
|---|---|---|---|---|---|
| A. `status: archived` in the Area note, guards in shell | yes | yes | yes, with the guards listed | one command | low: extends `setAreaStatus`, adds four read filters and one start guard |
| B. `git mv` the Area into `<root>/archive/` and skip that directory | by location | no | yes, by omission | `git mv` back | high: queue dir, brain record, tmux options, process notes, `--path` defaults all key on the path. `moveSessionBindings` covers tmux only. Root groups cannot move today |
| C. Keep `done` as is and add the missing guards | yes | yes | yes | one command | lowest, but keeps the wrong word. "Done" for a durable subject reads as finished work. Julian asked for "archive" |
| D. A and B together | yes, twice | no | yes | two steps | highest, two sources of truth |

## Evidence and counterexamples

- Counterexample to B: the queue file `~/.tangent/agent-shell/pipelines/neara/hackathon/live-edit/<slug>.json` would go stale after a move. `moveArea` today does not touch it. A restore would need the reverse. This was not tried and is inferred from the path layout, not from a failed run.
- Counterexample to two hidden states: work-view-sub-areas already had to special-case done sub-Areas with open Goals. A second hidden state doubles that branch.
- Failed generalization: "archive means the Goals are dropped". Rejected by the README lifecycle: Goal state is written on the user's word, one Goal at a time. An archive that drops 8 Goals silently would break that.

## Decisions

1. **Decision:** Archive is an Area note frontmatter status, `status: archived`, written by `setAreaStatus` and committed as `update: <area> area archived`. Reopen writes `status: active` and commits `update: <area> area reopened`, as today. Reason: the note is the Area's only Markdown record, and the mechanism exists.
2. **Decision:** The directory does not move. Reason: the Area path is the join key for the queue, brains, sessions, and process notes.
3. **Decision:** `archived` is a second fold-away Area status beside `done`. Both hide the same way and obey the same guards (Decisions 4, 5, 7). They differ in meaning and in the row mark: `done` is a finished subject, `archived` is a shelved one. `tangent area reopen` returns either to active. Reason: Julian's word on 2026-08-28, and the two facts are different facts in the Markdown.
4. **Decision:** Done and archived Areas leave Work, the Areas directory (behind `Show N hidden Areas`), Go To, and `tangent area list` (behind `--all`). A selected hidden Area still shows. Reason: the success conditions. Selection keeps Reopen reachable.
5. **Decision:** Archive is refused while a brain or worker session in the subtree is live. The refusal names the sessions. Reason: a session is never taken from another live agent, and a silent kill hides work.
6. **Decision:** Goals are not touched. The response and toast report the open count. Reason: Goal state is the user's word.
7. **Decision:** No brain starts on a done or archived Area, and no process note under it becomes due. Reason: cost stops at archive time.
8. **Decision:** The UI verb sits on the Area status modal reached by `x` on an Area row and by the Area menu and `Area settings`. Undo toast after the fact, no confirm dialog. Reason: same grammar as the Goal status modal and the existing Mark done flow.

## Rejected alternatives

- **Folder move (B).** Strongest alternative because it is the most visible Markdown representation and matches Obsidian habit. It lost on the join key: four runtime stores key on the path, and only tmux has a move hook. A later design can add a `tangent area move` into `archive/` once every store keys on a stable id. Nothing in this design blocks that.
- **Keep `done` alone and add guards (C).** Lost on meaning. A shelved subject is not a finished one, and Julian wants the two facts separate.
- **Archive drops or parks all Goals.** Lost on the README lifecycle rule.
- **Archive stops live sessions.** Lost on the ownership rule and on silent loss of a worker's state. Refusal with names costs one extra step and loses nothing.

## Risks, assumptions, unknowns

- **Superseded:** the first version made `archived` the only hidden state and turned `done` into a visible label, for one word per effect. Julian keeps both states. Every guard and read filter in this record keys on "hidden status" (`done` or `archived`), not on one value.
- **Assumption:** Brains stop themselves or Julian stops them before he asks for an archive. If refusals turn out to be frequent, add `--stop` to `tangent area archive` that stops the brain through `stopBrain` first.
- **Weak evidence:** the queue path is inferred from the navigation-model record, not from a run against a moved Area.
- **Unknown:** the "design-area-map Decision 11" text. If it forbids a status other than `done`, revisit Decision 3.
- **Reconsider when:** runtime stores key on an Area id instead of a path. Then the folder move becomes cheap and the Obsidian-style `archive/` folder becomes the better Markdown representation.

## Sources

- `packages/agent-shell/app/server.mjs:523-548, 1310-1342, 4517, 6669-6678`
- `packages/agent-shell/app/area-operations.mjs:6, 71-118`
- `packages/agent-shell/app/process-scheduler.mjs:128-142`
- `packages/agent-shell/app/public/area-directory-view.js:20, 43-66, 104-111, 245, 278`
- `packages/agent-shell/app/public/work-desk-view.js:930-937`
- `packages/agent-shell/app/public/go-to-rows.js:58`
- `packages/agent-shell/app/public/shell-event-bindings.js:597-602, 1494-1495`
- `packages/agent-shell/src/cli/commands/area.ts:17-19, 178-190`, `src/cli/spec.ts:60-61`
- `~/.tangent/trees/README.md` (Node notes, Outcomes), `~/.tangent/trees/AGENTS.md:24`, `~/.agents/AGENTS.md`
- `docs/design/work-view-sub-areas/design-record.md:5, 93, 139, 235`
- `docs/design/agent-shell-navigation-model/design-record.md` (Domain model, object-generic verbs)
