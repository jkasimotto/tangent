# Agent Shell unified navigation model: design record

Date: 2026-08-27

Status: proposed. No code changes accompany this record.

Lenses applied: UI/UX; architecture, types, and data.

This design builds on `../agent-shell-work-contract/design-record.md` and ADR-0038. It does not reopen their decisions. It extends them from the Work and Document surfaces to the whole product, and it names the object grammar that makes "jump anywhere, act on anything" a single model instead of a pile of shortcuts.

## 1. Problem contract

Julian wants Neovim-grade latency between intention and action, everywhere in Agent Shell. The named intentions are: enter a worker agent, enter a brain, stop or restart an agent inside a Goal's queue, change a running agent's harness, and jump between all of these without a mouse. The mouse must stay a full peer: every pointer action exists, and it teaches its keyboard path.

Success conditions:

1. Every reachable object (Area, Goal, assignment, attempt, session, Document, comment) can be reached, inspected, and acted on with keys alone, in a predictable number of keystrokes.
2. One grammar predicts the keys. A user who knows the grammar can guess an unlearned binding.
3. Every pointer path shows its shortcut; every shortcut has a pointer path (ADR-0038 decision, extended product-wide).
4. Escape and pointer Back follow one product-wide contract (already decided; this record consolidates the four competing implementations).
5. No dead surfaces, dead routes, or duplicate navigation engines remain.

Non-goals:

- No new terminal command language. The terminal keeps every key except visible `⌘J` (ADR-0038).
- No re-litigation of the Work-contract amendment (decisions 28 to 47) or of the permissive command authority model.
- No visual redesign. This record covers navigation, focus, and command structure only.

## 2. Current system

Full inventories were built from source on 2026-08-27. Line numbers cite that state (working tree, decisions 28 to 42 partially implemented and uncommitted). All facts below are Observed unless marked.

### 2.1 Surfaces

One static shell (`shell.html`): a fixed app bar, one `#screen` re-rendered wholesale from strings (`shell.js:837-888`) and selected by a single `state.view` string, plus four sibling layers that stack via `inert`: `#session-layer` (terminal), `#document-peek-layer`, `#modal-layer`, `#go-to-layer`.

Live screen views: `work` (default), `areas`, `prompts`, `document` (full reader, doubles as the Goal reader), `create`, `describe`, `area-edit`, `program-detail`, `program-create`, `harnesses`, `decision`.

Live layers: session layer, quick Document peek, modal (five shapes from one `openModal`: confirm, field, select, request, actions, key-sheet rows), Go To finder, launch popover (agent chooser, Goal launch editor, brain composer, default agents), Area Focus picker, shell menu, comment composer, Area map (inside `areas`), toast.

Dead or unreachable (Observed, verified by cross-grep):

- `state.view` values `agent`, `describe-agent`, `program-session` are read in ~20 places but never assigned. `renderProgramSession` is exported and never called.
- The agent decision view (`agent-decision-view.js`) is unreachable: its only trigger requires `state.view === "agent"`.
- The What-happened overlay is unreachable: no view renders `[data-what-happened-for]`. Its `transient` predicate term and its close branch are dead.
- `ask-core.js` (267 lines) is imported by no browser module (kept per the ADR-0033 audit window).
- ~20 pointer routes are handled but never rendered (`data-verdict-line`, `data-open-request-id`, `data-stop-goal`, `data-complete-goal`, `data-open-session`, and more).
- The `areas` tab is `hidden` in `shell.html:19` yet still bound and styled. `state.workFilter` is retired in a comment yet still mutated and still a return-point key.

### 2.2 Keyboard model

Key ownership follows ADR-0038: one capture-phase handler resolves a single owning context per event through `resolveKeyboardContext` (`keyboard-context.js`), priority `modal > go-to > document-peek > session > transient > focus-picker > text-entry > work > document > screen`. The Work context is registry-driven (`work-commands.js`: id, key, scope, kind, label, help, `aria-keyshortcuts`).

Current Work bindings: `j/k` rows, `gg/G` first/last, `{`/`}` Areas, `h/l` collapse-or-parent / expand-or-child, `b` brain, `s` stop brain, `d` defaults, `a` new Goal, `f` Focus, `r` questions, `n` note, `o` read Goal, `x` Goal status, `:` object actions, `/` filter, `?` keys, `⌘J` session, `⌘K` Go To, `⌘/` Work. Reader bindings: `j/k`, `Ctrl-D/U`, `gg/G`, `{`/`}` headings, `H/L` history, `n/N` comments, `c/e/r/x` comment lifecycle, `?` keys, staged Escape.

Cracks in the model (Observed):

- A second, unregistered document-level keydown listener exists per Area-map instance (`area-map.js:467`); listeners accumulate per visited Area and Escape in `areas` runs both handlers.
- The `screen` context has no Escape branch for `areas` or `prompts`: Escape there does nothing.
- The `session` predicate matches any `.terminal-host` target even with no `sessionPeek`; in that state no key at all is handled.
- Registry drift: `firstLast` has no `shortcuts` array so its behavior is hardcoded; `editAssignments` executes by id but is not in the registry; a reader toast advertises a Work `c` binding that does not exist.
- Three independent `gg` chord engines with three 650 ms timers (Work, reader per-surface, key sheet). Two text-entry detectors. Two Tab traps. Two comment cursors (numeric and identity).
- Two parallel Work row navigations: `j/k` moves `state.workCursor`; `↓/↑` moves DOM focus over title buttons. They can disagree. A mouse click sets the cursor without paint or focus, so click-then-`j` and `j`-then-`j` differ.
- Go To is the only list without `j/k` (arrows only); the Area Focus picker is the only list with no key navigation (Tab only); modals are the only lists where letter keys activate.
- Letter collisions across contexts: `d` is Defaults (Work), Done (Goal status modal), delete step (launch popover). `r` is questions (Work), Reopen (modal), reply (reader). `n` is note (Work), next comment (reader). `a` is new Goal (Work), add step (popover).

### 2.3 Focus, selection, and return

Four independent return-point mechanisms coexist (Observed): `captureReturnPoint`/`restoreReturnPoint` (15 keys plus scroll and reader trail), `captureNavigationPoint`/`restoreNavigationPoint` (view, cursor, focusKey, scroll; launch popover and harness editor), `modalReturnPoint` (element, id, focusKey), and the peek/Go-To `returnFocus`/`returnFocusKey` pair. The work-contract design (section "One surface and navigation contract") already decides a single surface-registration contract with semantic focus keys; the working tree implements it partially.

Selection is per-surface with distinct representations: `workCursor` string id, `areaSelection`, `goTo.selected` index, `commentCursorIdentity`, launch `active` step index, map-local `selected`.

### 2.4 Domain model and where each fact lives

The navigation design must sit on the real object model:

- A **Goal** is one Markdown file `~/.tangent/trees/<area>/goal-<slug>.md`. Vault git owns title, done condition, State, brief, story, Subgoal and dependency links, `status`, `session`, `waiting_on`, `due`. Statuses: `open`, `done`, `dropped`, `parked` writable; `active` machine-owned and written only with a session binding.
- The **queue** (routes still say "pipeline") is one JSON record per Goal at `~/.tangent/agent-shell/pipelines/<area>/<slug>.json`, schema `area-goal-queue.v2`: ordered assignments with `instruction`, `launch {harness, model, effort}`, `kind`, `status` (`pending, running, waiting, complete, stopped, skipped, ended`), attempts, reports, receipts, revision, idempotency keys. Controls: start, advance, skip, end, append, edit/mutate pending suffix, replace attempt, guarded recovery. Restart and send-on are removed (410).
- A **brain** is one logical record per Area (`area-brain.v3`), lifecycle `active`/`inactive`, generations as attempts.
- **tmux** is the session authority. The session name is the join key across all stores: Goal frontmatter `session:`, assignment `session`, brain generation `session`, and the terminal WebSocket `/term?session=<name>`. `@tangent_*` options cache durable facts so a pane is identifiable without files.
- **Launch** is three axes concatenated (`harness/model/effort`), registry in `harnesses.md`, per-Area defaults in the Area note, brain-default disclosure into the record before launch.
- The browser owns only ephemera: cursor, drafts, popover state, trails.

Three synonym vocabularies coexist at boundaries (node/outcome, Area/Goal, pipeline/queue/assignment). Routes say `pipelines`; records and docs say Goal queue and assignment.

### 2.5 Internal precedent

This is the fourth unification attempt. The first three: an editable keymap (2026-08-07, abandoned), "one tree everywhere" (three rewrites on 2026-08-09), and a single flat global keymap table (2026-08-19, named by ADR-0038 as the failure it corrects). ADR-0038 plus the work-contract record is the first attempt with an ownership model, a registry, and a governance lint that resists re-accretion. The lesson: a keymap is not a model; ownership plus a registry is. This record therefore extends that mechanism instead of inventing a fifth.

### 2.6 External precedent

- **Vim/Neovim**: the power Julian names is a composable grammar, not the specific keys. Motions move one cursor over a buffer; operators act on the object under the cursor; the same operator works on every object a motion can reach. Counts and text objects compose. The transferable idea: verbs are object-generic, objects are cursor-addressable.
- **tmux**: a prefix key plus a session/window/pane tree with a chooser (`prefix s`, `prefix w`). Transferable: live processes form a navigable tree; a finder over that tree is first-class.
- **Magit / lazygit**: object rows with single-letter verbs and a trailing transient menu that shows keys as it opens. Transferable: `:`-style scoped action menus that teach keys are a proven bridge between discoverability and speed. The current object-actions modal already follows this shape.

## 3. The unified model

The model has four parts: an object tree, one cursor, object-generic verbs, and a layer stack. Everything a user does is "move the cursor to an object, apply a verb, possibly enter a layer, and Back out". Mouse and keyboard are two encodings of the same three primitives: point (move cursor), act (verb), dismiss (Back).

### 3.1 The object tree (Decision)

One product-wide object hierarchy, matching the domain model exactly:

```
Area
├── Brain            (zero or one logical brain, live or not)
├── Goal             (recursive through Subgoals)
│   └── Assignment   (queue step; ordered; started history read-only)
│       └── Attempt  (a launch; live attempt = a tmux session)
├── Definition       (work-definition session)
├── Program
└── Document
```

Facts that already support this shape: the Work table renders Area, Goal, and definition rows with a tree cursor; the queue record holds assignments and attempts; the Goal detail read model (decision 36) already projects `currentAssignment`, `currentAttempt`, `blockers`, `commands`. The tree adds no new domain concept. It only makes two existing levels (Assignment, Attempt) cursor-addressable.

### 3.2 One cursor (Decision)

`state.workCursor` generalizes to a product cursor: one string id naming one object (`area:<path>`, `goal:<file>`, `assignment:<goal>#<id>`, `definition:<name>`, `document:<file>`, `comment:<identity>`). Every list surface moves this cursor with the same idiom:

- `j`/`k` and `↓`/`↑` are synonyms on every list where no text input owns focus. Where a text input owns focus (Go To, filters), arrows move the list and letters type. This one rule resolves today's Go-To/Focus-picker/modal inconsistency.
- `h`/`l` collapse-or-parent and expand-or-child on every tree (Work already; the object tree extends this to Assignment rows under a Goal).
- `gg`/`G`, `{`/`}` as today. One shared chord engine replaces the three `gg` timers.
- A pointer click on any row moves the same cursor through the same function (`setWorkCursor`, not the paint-free `rememberWorkCursor`), so click-then-key and key-then-key are identical.

The `↓/↑` DOM-focus-only navigation (`moveBetweenWorkRows`) is retired as a separate system; DOM focus follows the cursor, never the reverse.

### 3.3 Object-generic verbs (Decision)

A small verb set that means the same thing on every object. The existing registry (`work-commands.js`) grows a per-object availability matrix instead of new per-surface keymaps:

| Verb | Key | Area | Goal | Assignment | Attempt/session | Document | Comment |
|---|---|---|---|---|---|---|---|
| Enter (go into the live thing) | `Enter`, `⌘J` | open/start brain | open live worker, else launch editor | open that step's live session, else its editor | attach terminal | open reader | jump to anchor |
| Read | `o` | Area note | Goal reader | assignment instruction (read-only when started) | attempt context | reader | expand |
| Status / lifecycle | `x` | done/reopen | done, won't do, park, reopen | skip / end | replace / retire | resolve-adjacent lifecycle | resolve |
| All commands | `:` | scoped menu | scoped menu | scoped menu | scoped menu | Goal actions | comment menu |
| New child | `a` | new Goal | new Subgoal or assignment | insert step after | (none) | new comment | reply |
| Help | `?` | one generated key sheet per context, always from the registry | | | | | |

"Stop an agent in the pipeline" and "restart an agent in the pipeline" become verbs on the Assignment/Attempt rows: stop = end or skip that assignment; restart = replace the attempt (the domain's only restart; the old restart action is gone by design, ADR-0034). "Change the harness" is the same replace-attempt verb with a different launch choice, reachable as `:` then change-agent on the focused Goal or Assignment. This closes the current gap where queue control hides behind the launch editor and a toast advertises a `c` binding that does not exist.

Letter collisions inside one visible modal surface (the Goal-status `d/w/p/r`) are acceptable and Magit-proven; the modal shows its keys. Collisions between sibling contexts with no visible mode change are not acceptable; the verb table keeps the generic verbs (`Enter o x : a ?`) identical everywhere, and context-local letters are only legal inside a surface that displays them.

### 3.4 Layers, Back, and returns (Decision)

The ADR-0038 layer stack stands. This record adds one consolidation: the four return-point mechanisms collapse into the single surface-registration contract already decided in the work-contract record (surface identity, object identity, opener, initial focus key, ordered focus keys, commands, draft policy, Back action). `captureReturnPoint`, `captureNavigationPoint`, `modalReturnPoint`, and the peek `returnFocus` pair become one implementation with one payload shape. Back always restores the opener's semantic focus key, never a DOM node.

Escape gains the two missing branches: `areas` and `prompts` return to Work. Every screen has a pointer Back with the same parent as Escape. The Area map's private document keydown listener moves into the owned dispatch (a `map` context term or a scoped subtree handler), removing the double-handling of Escape and the listener accumulation.

### 3.5 Jump model (Decision)

Two jump ranks, both existing today, made symmetric:

- **Go To (`⌘K`)** is the global teleport over all objects. It gains Assignment and live-session rows (it already lists brains and Documents), so "enter the worker for goal X" is `⌘K`, type, `Enter`. Arrows move while typing; `Enter` acts by object kind through the same verb table (a session row enters the session, a Document row peeks).
- **The cursor tree** is the local walk: `{`/`}` between Areas, `j/k/h/l` within, `Enter` to descend into the live thing, `⌘J`/Back to surface.

The tmux session name stays the single join key: any object with a live session resolves Enter to `openSessionLayer(<session name>)`; nothing else is needed to make every level "enterable".

### 3.6 Mouse parity (Decision)

Already decided in ADR-0038 for Work; extended product-wide with three rules:

1. Every cursor row is a pointer target that moves the cursor (single click) and applies Enter (double click or the row's primary control). The Area map keeps double-click-opens; it gains the same single-click-moves-cursor semantics.
2. Every verb has one visible control per surface (a row-end `⋮` opening the same `:` menu), and every control shows its key. Menus render from the registry, so drift is impossible by construction.
3. Hover never carries exclusive information; anything hover reveals is also in the `:` menu.

## 4. Candidate designs considered

**A. Extend the ADR-0038 registry model to an object grammar (selected).** One cursor, object-generic verbs, registry-driven surfaces, one back router. Incremental over the uncommitted work-contract implementation; every mechanism it needs already exists in some form.

**B. Full modal editor (Vim modes, a `:` command line with names and arguments).** Rejected. It creates the second command language ADR-0038 forbids next to tmux, adds a mode indicator burden, and the existing scoped action menus already give the composability Julian actually uses. Counterexample from history: the editable-keymap attempt (2026-08-07) died precisely because free-form key power without an ownership model leaks.

**C. URL/router navigation (every surface a route, browser Back as the back router).** Rejected. The layer stack is deliberately not a history stack: Back removes exactly one layer and restores a semantic focus key, and a child cannot have two parents. Browser history cannot express the draft policy or the focus contract. URLs stay as deep-link entry points only (`?view=`, `?document=`, extended cheaply to `?goal=` if wanted).

**D. Leave navigation per-surface and only fix the bug list.** Rejected. It is the accretion pattern that produced four return systems and three chord timers; history shows per-surface fixes regrow (three prior attempts).

## 5. Decisions

1. Adopt the object tree of 3.1 as the navigation spine. Assignments and attempts become cursor-addressable rows under their Goal in Work.
2. One product cursor with one movement idiom (3.2). Retire `moveBetweenWorkRows` as an independent system; unify click and key cursor paths.
3. One verb table (3.3) in the existing command registry, extended with per-object availability. Queue control (advance, skip, end, replace attempt, edit pending steps) is expressed only through these verbs.
4. "Restart an agent" is the replace-attempt operation; "change harness" is the same operation with a new launch. No restart action returns.
5. Collapse the four return-point mechanisms into the surface-registration contract (3.4). One chord engine, one Tab trap, one text-entry detector, one comment cursor.
6. Escape/Back coverage becomes total: `areas` and `prompts` gain Back parents; the Area map joins owned dispatch.
7. Go To indexes every object kind including assignments and live sessions; Enter routes through the verb table (3.5).
8. Mouse parity rules of 3.6 apply product-wide; menus and key sheets render from the registry only.
9. Delete the dead surface set: `agent`, `describe-agent`, `program-session` views, the decision view, the What-happened overlay, dead pointer routes, the hidden Areas tab binding, `state.workFilter`. Extend the ADR-0033-style governance lint so each deleted builder cannot return.
10. Vocabulary: navigation-facing code and docs say Goal queue and assignment; `pipeline` survives only in route paths and storage filenames until a separately-scoped rename.

## 6. Risks, assumptions, unknowns

- **Assumption:** assignment rows in the Work tree will not overwhelm the table. Mitigation: they render only when a Goal is expanded (`l`), and most Goals have one assignment. Needs live-use validation.
- **Assumption:** the uncommitted decisions-28-to-42 implementation lands substantially as-is; this design layers on it. If it changes shape, 3.4 consolidations need re-anchoring.
- **Unknown:** whether Go To should rank live sessions above Documents by default. Cheap to tune later; not a structural question.
- **Unknown (for Julian):** should `Enter` on a Goal with no live worker open the launch editor (current decision 36 behavior) or first the Goal reader? The verb table keeps today's choice (launch editor); `o` reads. Confirm during live use.
- **Risk:** deleting dead views collides with the two-release audit window for `ask-core.js` (ADR-0033). Sequence deletions after that window or extend the window note.
- **Risk:** unifying click-sets-cursor with paint may cause visible repaints on click-heavy use. The existing repaint-suppression rules (no rebuild under hands, editing-surface suppression) must cover the cursor paint path.

## 7. Rejected alternatives (strongest first)

- **Vim modes / command line (B in 4).** Strongest because it is the literal reading of "I like Vim". Rejected because the value Julian names is latency and composability, both delivered by the object grammar, while modes add the one cost (a second command language over a terminal) the product has already ruled out.
- **Fixing surfaces individually (D).** Rejected on direct historical evidence of regrowth.
- **Browser-history-based Back (C).** Rejected because the decided back contract (one layer, one parent, draft policy, semantic focus) is stricter than history semantics.

## 8. Sources

- `../agent-shell-work-contract/design-record.md` and `user-intent.md` (governing prior design)
- `docs/decisions/ADR-0038-agent-shell-keyboard-ownership.md` (keyboard ownership stack)
- ADR-0017 (+5 amendments), 0022 (ownership), 0023 (pipelines), 0024 (brains), 0031 (capability ownership), 0033 (logical brain, audit window), 0034 (audited workflow, permissive authority), 0035 (launch disclosure), 0036 (session ownership), 0037 (attempt launch override)
- Frontend: `packages/agent-shell/app/public/` (`keyboard-context.js`, `work-commands.js`, `shell-event-bindings.js`, `shell.js`, `shell-state.js`, `shell-coordinator.js`, `document-reading-commands.js`, `terminal-controller.js`, `area-map.js`, `go-to-core.js`)
- Server: `packages/agent-shell/app/server.mjs`, `pipeline-record.mjs`, `brain-record.mjs`, `goal-lifecycle.mjs`, `launch-environment.mjs`, `terminal-transport.mjs`, `gateway.mjs`
- History: `git log --follow -- packages/agent-shell/app/public/shell.js` (110 commits, 2026-08-07 to 2026-08-27); prior unification attempts at `ae69b8d`, `e7ebe62`..`ff7d64d`, `76c658b`, `001899d`
- Tests pinning conventions: `keyboard-ownership-ui.test.mjs`, `focus-shell-work-navigation-ui.test.mjs`, `work-table-ui.test.mjs`, `area-focus-ui.test.mjs`, `document-reading-*.test.mjs`
