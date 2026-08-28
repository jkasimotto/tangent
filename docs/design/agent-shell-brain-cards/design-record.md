# Brain-presented cards: design record

Date: 2026-08-28. Status: designed, not implemented. Goal: `~/.tangent/trees/otto/tangent/goal-build-brain-presented-declarative-interfaces.md`. Product contract: `~/.tangent/trees/otto/tangent/design-brain-presented-interfaces.md` (approved, one open comment). Builds on `../agent-shell-presented-documents/design-record.md` and `../agent-shell-presented-documents-persist/design-record.md`. Written in Simple English, pragmatic mode.

Section 12 is the implementation-ready contract. Sections 1 to 11 hold the evidence and the reasoning.

## 1. Problem contract

The product design is settled. A brain presents a **card**: a small JSON record with a `kind`, a title, and typed fields. Tangent renders each kind with its own component. This record decides how the code and runtime change.

Constraints that the product design fixes:

- First delivery: `copy`, `link`, `links`, `progress`, `checklist`, `commits`, `reviews`.
- The brain reuses `tangent goal present` with `--card`, the same record folder, and the same keys.
- A card lives beside presented Documents in `~/.tangent/agent-shell/presented/<area>/<slug>.json`. It is never committed.
- Presenting is idempotent on Goal, kind, and title. Re-presenting updates the card in place.
- A brain presents only on open Goals in its own Area. A worker cannot present a card.
- A `progress` card is refused on a Goal with a live pipeline.
- Cards show as child rows under their Goal on Work and under a `Presented` heading in the Goal reader. They never enter For you and never ring.
- `Enter` does the card's one action. `o` opens the Goal reader. `x` withdraws. No new key.
- Actions never write state. Text is plain and escaped. URLs are `http`, `https`, or a vault or repository file.
- A card stays until withdrawn, dismissed, or the Goal closes. No timers.

Non-goals: `results`, `compare`, `waiting`, `meter`, `timeline`, `diff`. Cards on an Area without a Goal (that is a separate design, `design-brains-present-area-documents.md`, not implemented). Cross-Area cards (refused until `design-let-julian-authorize-cross-area-brain-commands.md` lands). A `git log` helper that fills `commits`.

Success conditions, observable:

1. A live brain runs `tangent goal present <slug> --card copy --title "Review request" --text "..."`. Within one refresh, Work shows one child row under the Goal.
2. The same command again with new text changes the row in place. The row does not move.
3. `Enter` on the row copies the text and the status line reads `Copied`.
4. `x` hides the row. The same fields again do not bring it back. Changed fields do.
5. A worker, a stopped brain, another Area's brain, a bad kind, a `javascript:` URL, or a `progress` card on a running Goal gets a printed reason and no record change.
6. `tangent goal done <slug>` removes every card with the Goal.
7. A screen reader announces each row as `<kind>: <title>, presented by <session>`.

## 2. Current system (Observed)

### 2.1 Store

`packages/agent-shell/app/goal-presentations.mjs`. Schema string `goal-presentations.v1` (line 5). One file per Goal, `recordPath(root, area, slug)` = `<root>/<area segments>/<slug>.json` (lines 8-10). The root is `TANGENT_PRESENTATIONS_ROOT`, else `~/.tangent/agent-shell/presented` (`server.mjs:204-205`). The record is `{ schema, area, slug, goal, items: [] }` (line 16). Saves are atomic: temp file, then `rename` (lines 22-29).

An item has `id`, `file`, `root` (`vault` or `repository`), `title`, `presentedBy { session, role, assignmentId }`, `presentedAt`, `presentedHash`, `note`, `openedAt`, `openedHash`, `withdrawnAt`, `dismissedAt`, `dismissedHash` (lines 43-48). Idempotence: same `presentedHash` while not withdrawn is a no-op (line 42). New content resets the opened and dismissed fields. `withdraw` sets `withdrawnAt`. `dismiss` sets `dismissedAt` and `dismissedHash = presentedHash` (lines 55-73). `projectPresentations` returns items with `withdrawnAt === null && !dismissedAt`, newest first (lines 104-106). `removeGoalPresentations` unlinks the file (lines 87-90). `pruneMissingPresentations` drops items whose file is gone (lines 93-101).

Three real records exist under `presented/otto/tangent/` and two under `presented/neara/essential/autodesign/`. All are `goal-presentations.v1`, all with one item. The `persist` record added `dismissedAt` and `dismissedHash` to v1 without a schema bump. Absence reads as null.

### 2.2 Routes and fences

`packages/agent-shell/app/goal-presentation-routes.mjs`: POST-only table for `/api/goals/present`, `/withdraw-presentation`, `/dismiss-presentation`, `/presented-opened`. Handlers at `server.mjs:6264-6315`.

`present` resolves the Goal by file or slug and refuses `done`, `dropped`, `parked`, `deferred` with `404 no open Goal <x>`. Then `commandProvenance(session)` gives `{ session, area, role }` (`command-provenance.mjs:6-18`). The only actor check: a `worker` may present only on its assigned Goal (`403`). **There is no Area check.** A brain in one Area can present on any open Goal. Every file goes through `resolvePresentedDocument` (`server.mjs:758-782`) before any write. A vault path becomes `root: "vault"`. Another path must end in `.md` and sit inside the Area's bound work folder or one recorded attempt `cwd`, and becomes `root: "repository"`.

`withdraw` and `dismiss` have no actor check and no status filter. `opened` scans every Goal when the body names none.

`liveBrainForSession(sessionName)` (`server.mjs:4769-4779`) returns the brain record only when the record is `active`, the session is its current attempt, and the tmux session is live under this server instance. The cross-Area design names this helper as the caller rule for brain-originated Goal commands.

Goal closure: `server.mjs:7082` removes the record on `done`, `dropped`, `parked`. `deferred` is not in that list. `present` refuses `deferred`, so no record grows on a deferred Goal.

Pipeline liveness: `pipeline-record.mjs:95-104` treats an assignment with status `running` or `waiting` as current.

### 2.3 Work projection and refresh

`GET /api/vault` (`document-routes.mjs:6,25-27`, `server.mjs:6250-6254`) builds the projection in `buildVaultIndex`. For each Goal (`server.mjs:960-964`, `1047-1055`): `goal.presentations = projectPresentations(record)`, and each item is also unshifted into `goal.documents`. The worker prompt reuses the store through `goalContextDocuments` (`server.mjs:1779-1796`).

The browser refreshes on the `/api/events` SSE `changed` event and every 30 s (`refresh-lifecycle.js:98-117`). `paint()` rebuilds the screen with `innerHTML` when `renderKey()` changes (`shell.js:1134-1160`, `857`). `vaultRenderProjection()` (`shell.js:611-620`) keys a Goal on `file, title, status, doneWhen, mtime, changedAt, depth, waitingOn, storyText, agents, firstStartAt, lastEndAt, documents[].file, documents[].changedAt`. **`goal.presentations` is not in the key.** A presented Document still repaints because it enters `documents[]`. A card that is updated in place with the same title would not change the key and would not repaint. This is the one refresh defect the design must fix.

### 2.4 Work rows and keys

`work-desk-view.js:1958-1998` builds the Goal tree, then appends `(node.goal.presentations ?? []).slice(0, 3)` as child rows (line 1993) and an overflow row when more exist. The cap is render-only. `workPresentedDocumentRow` (lines 2000-2008) renders `<tr class="desk-document work-row presented-document">` with cursor `document:<file>`, `data-presentation-goal`, `data-presentation-file`, a title button `↳ Read · <title>` with `data-open-document`, a `<small>` note or session, and controls `o full` and `x dismiss`. There is no `aria-label` on the row or the title button. `shell.css` has no rule for `.desk-document` or `.presented-document`. The shared `.work-row` rules apply, and controls show on cursor, hover, or focus-within (`shell.css:560-561`).

`work-commands.js`: `open` (`↵`, scope `work`, line 17), `fullDocument` (`o`, scope `document`, line 31), `dismissPresentation` (`x`, scope `document`, line 32). Caption per row kind at lines 91-97. `workRowKind` reads the first cursor segment (line 114). `work-commands.test.mjs:10` asserts scope is one of `work|area|goal|document`.

`shell-event-bindings.js`: in the `work` context the presented-row `o` and `x` handlers (lines 2744-2751) run before the Goal-scoped `readGoal` and `goalStatus` handlers, so the child row wins. `Enter` goes through `openWorkRow`, which clicks the row's title button (lines 833-838). `executeWorkCommand` (lines 734-826): `fullDocument` calls `openDocument(file)`. `dismissPresentation` posts `/api/goals/dismiss-presentation { goal, file }` then `refresh()`, with no confirm and no `.catch`. Pointer: any click inside `[data-work-cursor]` sets the cursor (lines 1397-1399). A title click on a presented row opens the quick reader (lines 1667-1671).

Quick reader: `document-reader-controller.js:184-224` `openDocumentPeek(file, { origin })`. The peek is `role="dialog" aria-modal="true"` with `← →` siblings, `Open full reader`, and `Close esc` (`document-reader-view.js:248-284`). Escape closes it and refocuses the origin element (controller 248-275). `paint()` early-returns while a peek is open (`shell.js:1139`).

Goal reader: `goalDetailPanel()` (`document-reader-view.js:191-219`) renders `Dependencies`, `Related Documents`, `Queue`, `Attempt history`. Presented Documents appear inside Related Documents with `Presented by <session>`. **There is no `Presented` heading.** Data comes from `GET /api/goals/detail`.

Announce: `showToast` (`shell.js:393-410`) writes `#toast`, `role="status" aria-live="polite"`. `announceWork(text)` (`shell-event-bindings.js:92-96`) writes the hidden `#filter-count` live region. No presented-row path announces anything today.

### 2.5 CLI

`packages/agent-shell/src/cli/commands/goal.ts:42-58` `presentCommand`: `<slug> <file...>`, `--note`, `--withdraw` (boolean), `--session`, `--server`. It requires at least one file. Spec at `src/cli/spec.ts:174-179`. `send.ts:21` shows the parser supports `repeatable: ["present"]` and `stringsArg` for repeated flags. Errors print `error.message` and exit 1 (`src/cli/index.ts:243-245`).

### 2.6 Brain instruction and first message

`brainFirstMessage` (`server.mjs:4564-4566`) returns Julian's text or `Start.`. ADR-0041: Tangent generates no brain prompt. `focus-shell-workflow-http.test.mjs:735-736` asserts that no prompt composer exists. The vault root `~/.tangent/trees/AGENTS.md` and `packages/agent-shell/app/vault-root-AGENTS.md` do not mention `tangent goal present`. A brain learns the command from `tangent goal present --help`.

### 2.7 Tests

`app/goal-presentations.test.mjs` (store, three tests). `app/work-table-ui.test.mjs` (two presented-row tests: cap and dismiss route, Enter and o and x). No HTTP test exercises the present routes. No CLI test covers `tangent goal present`. HTTP tests boot the server with `startServer(root, trees, port, ...)` (`app/brain-notices.test.mjs:222`). Runner: `node --test`. App tests run with `npm run test:app` in `packages/agent-shell`.

### 2.8 Concurrent work

`goal-x-dismisses-presented-documents` is active in another session and edits `shell-event-bindings.js`. The working tree already shows that file modified. Implementation of cards must rebase on that change.

## 3. Precedents

- **Presented Documents** (`../agent-shell-presented-documents/`, `../agent-shell-presented-documents-persist/`). The same folder, record, routes module, row shape, keys, and fences. Every card decision below extends this precedent instead of creating a parallel one. Decisive because the product design says so (decision 9) and because the code is one week old and small.
- **Content-fenced dismissal** (persist record, decision 2 and 3). Julian's `x` is fenced to a hash. A repeated identical presentation cannot return. Cards reuse this with a hash over the fields.
- **Pure validation modules** (`goal-presentations.mjs`, `pipeline-record.mjs`, `command-provenance.mjs`). Server logic lives in small pure modules with co-located tests. The card validator follows the same shape.
- **`liveBrainForSession`** (`server.mjs:4769`). The cross-Area design names it as the identity rule for brain-originated Goal commands. Cards use the same helper, plus an Area comparison, because the product design demands one.
- **Work command registry** (ADR-0038, `work-commands.js`). One registry owns keys, scopes, labels, and caption text. Card verbs join it under a new scope.
- **Live regions** (`#toast`, `#filter-count`). `Copied` and `Could not open` use them.

External precedent: Slack Block Kit and Adaptive Cards are closed sets of typed blocks rendered by the host. Both confirm the product rule and add nothing the code needs.

## 4. Lens analysis

Selected lenses: architecture, types, and data. API. Migration and compatibility. Operations. All four apply because the change adds a persisted shape, a CLI and HTTP contract, coexists with v1 records, and runs under many brains.

### 4.1 Architecture, types, and data

**Invariants.**

1. One card is identified by `(goal, kind, title)`. The title is trimmed and compared exactly. The `id` is a UUID for cursor stability and audit.
2. A card record is valid as a whole or absent. The validator runs before the store writes. A record never holds a half-valid card.
3. Only a live brain of the Goal's Area writes a card. The server owns this fact. The CLI sends identity, never permission.
4. A card changes no Goal file, no queue, no session, and no brain record. The store and the routes never call any Goal write.
5. Kinds are a closed set. The set lives in one module. A kind absent from the set is refused.

**Ownership.** Brain: what and when. Server: validation, identity fence, persistence, projection, removal on close. Client: rendering, keys, actions, announcement. Julian: dismissal.

**State model of one card.** `presented` (renders), `dismissed` (hidden, Julian, fenced to `dismissedHash`), removed (brain withdraw, or Goal closed). A brain withdraw deletes the card entry. It does not set a `withdrawnAt`, because a withdrawn card has no file to return to and re-presenting after withdraw is a new card. This is simpler than Documents and loses nothing observable.

**Where untrusted data becomes a domain value.** In `validateCard(kind, title, fields, resolveFile)` in `goal-cards.mjs`. Output is a frozen `{ kind, title, fields }` with every string trimmed, every list clipped to its limit, every URL classified. The client renders only validated records and still escapes every string with `escapeHtml`, because the client must not trust the store either.

**Duplication check.** The card fields are not derivable. Tangent does not read git for `commits` (product, section 3.6). `progress` is refused where Tangent already draws the pipeline. So no field duplicates server knowledge.

**Dependency direction.** `goal-cards.mjs` imports only `node:crypto`. `goal-presentations.mjs` gains card functions and stays free of server imports. `server.mjs` composes them. `work-desk-view.js` gains `work-card-view.js` for card rows and the card peek body. No new package.

**Representation that becomes expensive to change.** The `cards[]` item shape in the record file. It is written by one server and read by one client and one CLI (`goal show`). It can change with a schema bump and a lazy read adapter, as v1 items did. Kept small on purpose.

**Abstraction test.** One `kind` table with per-kind `fields` schema, `action`, and row summary. Demonstrated variation: seven kinds now, four more named for later. A per-kind table is justified. A generic layout language is not, and the product forbids it.

### 4.2 API

**Representative calls.**

```
tangent goal present review-flow --card copy --title "Review request for #412" --text "Please review D12345 ..."
tangent goal present review-flow --card link --title "Preview" --url https://preview.example/412 --label "Preview build"
tangent goal present review-flow --card links --title "Verify" --label PR --url https://... --label CI --url https://... --label Preview --url https://...
tangent goal present migrate --card progress --title "Repository migration" --step "web:done" --step "api:current" --step "docs:todo" --current 2
tangent goal present review-flow --card checklist --title "Done when" --item "Tests pass:yes" --item "Docs updated:no"
tangent goal present review-flow --card commits --title "Landed" --repo /Users/julianotto/Projects/polez --commit "a1b2c3d:fix pole default:https://phab/D1"
tangent goal present review-flow --card reviews --title "Waiting on people" --review "D12345:Fix pole default:https://phab/D12345:Needs review"
tangent goal present review-flow --withdraw-card "Review request for #412"
```

HTTP, three new routes in the existing presentation router, all POST, all JSON:

```
POST /api/goals/present-card    { goal, session, card: { kind, title, fields } }
  200 { goal, card: <stored card>, changed: boolean }
  400 { error }   validation, printed to the brain verbatim
  403 { error }   not a live brain of this Goal's Area, or a worker
  404 { error }   no open Goal
  409 { error }   progress on a Goal with a live pipeline
POST /api/goals/withdraw-card   { goal, session, title }
  200 { ok: true } | 404 { error: "no card with that title" }
POST /api/goals/dismiss-card    { goal, id }
  200 { ok: true } | 404 { error: "no card with that id" }
```

The CLI builds `card.fields` from flags and sends them raw. The server owns validation, so the CLI never duplicates rules. The CLI validates only shape that the parser must know: `--card` needs `--title`, `--withdraw-card` needs no other card flag, and paired `--label`/`--url` counts must match.

**Effects and errors.** `present-card` writes one record file atomically. It is idempotent on `(goal, kind, title)`: `changed: false` when the validated fields hash equals the stored `fieldsHash` and the card is not dismissed. Errors are structured strings the brain can act on: `link card: url must be http, https, or a vault or repository file`, `progress card: this Goal has a live pipeline`, `card kind "meter" is not available`, `links card: at most 3 items`.

**Why `dismiss-card` takes `id` and `withdraw-card` takes `title`.** Julian's row knows the id. The brain knows the title it chose. Both resolve to the same entry. The `id` never appears in the CLI.

**Error mapping.** `403` and `409` are new for this router. The router already passes through any status the handler returns, so no router change is needed.

**Read side.** `GET /api/vault` adds `goal.cards: Card[]` (presented only, oldest first, see 4.4). `GET /api/goals/detail` adds `cards` with the same shape for the `Presented` heading. `GET /api/goals/show` output (`tangent goal show`) prints a `Presented` section with each card's kind, title, and a one-line field summary, so a restarted brain can read its cards.

### 4.3 Migration and compatibility

- `goal-presentations.v1` gains one array, `cards`. The schema string does not change. Absence reads as `[]`. This is the same additive move the persist record made. No migration, no backfill.
- Old records: five files exist. All lack `cards`. All stay readable.
- Rollback: an older server ignores `cards`. Records with cards stay readable. Nothing corrupts.
- Old client with new server: `goal.cards` is ignored. Old server with new client: `goal.cards` is undefined and the client treats it as `[]`.
- CLI: `tangent goal present <slug> <file...>` keeps its shape. `--card` is a new mode. With `--card`, positional files are refused with a printed reason. With `--withdraw-card`, likewise.
- The Area-level presentation design (not implemented) can later add an Area record with the same `cards[]` item shape. Nothing here blocks it.
- No compatibility code needs a removal date, because nothing temporary is added.

### 4.4 Operations

- **Observe.** The card row on Work shows the state. Hover title reads `Presented by <session> · <relative time>` and adds `(brain stopped)` when `liveBrainForSession` finds no live brain for the presenter session at projection time. The server computes that flag into `card.presenterLive` in the projection, so the client needs no session list join.
- **Identifiers.** `card.id` (UUID), `presentedBy.session`, `goal`, `kind`, `title`. Server log lines on refusal include goal, kind, title, and reason.
- **Retries.** A brain can re-run the same command safely. Idempotence makes a retry a no-op. A network error leaves the record unchanged because the write is atomic.
- **Ordering.** Cards in one Goal order by `presentedAt` ascending, oldest first, because an in-place update must not move the row (product, section 8, step 3). Documents keep their newest-first order. On Work, Documents render before cards. Both orders are stable under update.
- **Limits.** Validator limits: title 1-80 characters, `copy.text` 1-10000 characters, `link.label` 1-80, `links.items` 1-3, `progress.steps` 1-20, `checklist.items` 1-20, `commits.commits` 1-5, `reviews.items` 1-10, labels and subjects 1-120 characters. One record file per Goal stays small.
- **Partial results.** `present-card` is all-or-nothing per call. Copy failure and Open failure are client-side and announced. A missing file link shows `file missing` in place of its action, computed at projection time by the existing missing-file rule.
- **Refresh.** Observed: `server.mjs:7193-7199` invalidates the vault projection and calls `stateEvents.changed(pathname)` after every successful POST under `/api/goals`. The new routes get this for free, so Work refreshes on the SSE path, not the 30 s fallback.
- **Recovery.** A restarted brain runs `tangent goal show <slug>` and reads the `Presented` section. No prompt injection, per ADR-0041.

## 5. Candidate designs

### 5.1 Where cards live

- **A. `cards[]` in the existing Goal record.** Selected. One file per Goal, one removal on close, one prune pass, one projection read.
- **B. A separate `cards/<area>/<slug>.json` folder.** Rejected. Two files to remove on close, two reads per Goal, and the product says the same record folder.
- **C. Cards as items in `items[]` with `kind`.** Rejected. Document items are keyed on `file` and `root`, carry hashes of file content, and get pruned by file existence. Mixing shapes in one array makes every existing function branch on `kind`.

### 5.2 Identity fence

- **A. `liveBrainForSession(session)` and `record.area === goal.area`.** Selected. It is the helper the cross-Area design names, it already proves liveness and instance, and one comparison adds the Area rule.
- **B. `commandProvenance` role only, as Documents do.** Rejected. It has no Area check, and the product requires one for cards.
- **C. Read tmux `@tangent_area` directly.** Rejected. `commandActor` already reads it, but a brain record is the authority for a brain's Area. Tmux options are a shell binding, not permission (`packages/agent-shell/CLAUDE.md`, ADR-0034).

A local shell session (Julian's own terminal, role `local-shell`) is also refused. The product says a card is always from a brain. Tests use a brain fixture. This costs manual testing convenience and is accepted.

### 5.3 Dismissal

- **A. Delete the card on `x`.** The product's literal wording. Rejected for a real counterexample: a brain that re-presents a `checklist` on every worker note would restore a card Julian dismissed one minute ago.
- **B. Fence dismissal to a hash of the fields, as Documents do.** Selected. Julian sees the row go. The same fields cannot return. Changed fields return. This matches persist record decision 2 and 3 and keeps one rule for both row types. The product's observable behavior is unchanged, so this needs no product re-approval.

### 5.4 Cap of three child rows

- **A. Server refuses the fourth row.** The product's wording. Rejected while Julian's comment `seems overly strict` is open. A server refusal is a second policy point and the harder one to loosen.
- **B. Render-only cap, one constant shared by Documents and cards.** Selected. `PRESENTED_ROWS_PER_GOAL = 3` in `work-commands.js` or a sibling, used by the existing `slice(0, 3)` and the overflow row. Cards and Documents count together, Documents first. Changing the number is one edit. If Julian raises the cap, nothing else moves.

### 5.5 `Enter` on a fact card

- **A. A new card reader surface.** Rejected. New surface, new keyboard owner, forbidden by the product (no new page).
- **B. Reuse the document peek layer with a card body.** Selected. `openCardPeek(goal, id)` uses the same `#document-peek-layer`, the same dialog chrome, the same Escape and focus-return, and disables the sibling arrows and comment controls. The body is rendered by `work-card-view.js`. The peek already owns keys above the Work context (ADR-0038), so `Enter` on an `Open` button inside the peek needs no new rule.

### 5.6 Repaint after in-place update

- **A. Add `goal.cards` to `vaultRenderProjection` goal fields.** Selected. Key on `[id, fieldsHash, updatedAt, presenterLive]` per card.
- **B. Merge cards into `goal.documents` to ride the existing key.** Rejected. It would put cards in Related Documents and in the worker prompt, which the product forbids.

### 5.7 CLI field grammar

- **A. One flag per field, repeatable list flags, kind-specific separators, as the product lists.** Selected, with parsing rules fixed in section 12.
- **B. `--json '<card>'`.** Rejected as the only path. Brains write shell commands, and a JSON string in a shell quote is what they get wrong most. Kept out of the first version. It can be added later without changing the record.

## 6. Counterexamples and failed hypotheses

- **Hypothesis: the row repaints on update because presentations feed the render key.** False. Only `documents[]` feeds it (`shell.js:614`). Documents repaint by accident of the merge. Cards need their own key entry (5.6).
- **Hypothesis: `commandProvenance` proves the caller is a brain of the Goal's Area.** False. It proves a role and reports an Area for audit. No route compares Areas (2.2).
- **Hypothesis: deleting on `x` is enough.** False for a re-presenting loop (5.3).
- **Hypothesis: the brain reads its cards in its first message.** Not possible under ADR-0041. Resolved by `tangent goal show` output (4.4).
- **Hypothesis: `documents[]` order (newest first) fits cards.** False. An updated card must not move. Cards order oldest first (4.4).
- **Hypothesis: `x` on a card can reuse `dismissPresentation`.** False. That command posts `{ goal, file }`, and a card has no file. A card command posts `{ goal, id }`.

## 7. Decisions

1. **Cards are `cards[]` in `goal-presentations.v1`.** Decisive evidence: product decision 9 and the additive precedent of the persist record.
2. **`goal-cards.mjs` is the one validator and the one kind table.** Decisive evidence: invariant 2 and 5, and the pure-module precedent.
3. **The identity fence is `liveBrainForSession` plus `record.area === goal.area`.** Workers and non-brains get `403`. Decisive evidence: product section 6 rule 1, and the cross-Area design's named helper.
4. **Idempotence key is `(goal, kind, title)`. Change detection is `fieldsHash`, a sha256 of the canonical JSON of the validated fields.** Decisive evidence: product decision 9 and the hash precedent.
5. **Julian's `x` sets `dismissedAt` and `dismissedHash`. A brain withdraw deletes the entry.** Decisive evidence: 5.3.
6. **The cap is render-only and one constant.** Decisive evidence: Julian's open comment and 5.4.
7. **`progress` is refused with `409` when the Goal's queue has a `running` or `waiting` assignment.** Decisive evidence: product decision 10 and `pipeline-record.mjs:95-104`.
8. **Card rows are a new row kind `card` with cursor `card:<goal file>:<id>`, scope `card` in the registry, verbs `open` (Enter), `readGoalPresented` (`o`), `dismissCard` (`x`).** Decisive evidence: ADR-0038 and the `document` scope precedent.
9. **`Enter` per kind:** `copy` writes the clipboard and announces `Copied`. `link` opens the URL in a new tab with `noopener`, or opens the quick Document reader for a file URL. `links`, `progress`, `checklist`, `commits`, `reviews` open the card peek. Decisive evidence: product section 10.
10. **`o` opens the Goal reader and scrolls to the `Presented` heading.** `goalDetailPanel` gains a `Presented` section after `Related Documents` that renders every card in full through `work-card-view.js`. Decisive evidence: product section 5.
11. **`goal.cards` joins the render key.** Decisive evidence: 2.3 and 5.6.
12. **URLs:** `http`, `https`, or a Markdown file that `resolvePresentedDocument` accepts for this Goal. A file URL is stored as `{ file, root, repository? }` and rendered with the read-only reader, as presented repository Documents are. Any other scheme or file is refused. Decisive evidence: product section 9 and the existing allow-list rule (`readPresentedRepositoryDocument`).
13. **`tangent goal show` prints a `Presented` section.** The root `AGENTS.md` in the vault gains one bullet for `tangent goal present --card` and one for `--withdraw-card`. The brain learns flags from `--help`. Decisive evidence: ADR-0041 and product section 4.
14. **No new package, no new dependency, no new page, no new key.**

## 8. Rejected alternatives

Listed in section 5. In short: a separate card store, mixing cards into `items[]`, tmux options as permission, delete-on-dismiss, a server-enforced cap, a new card reader surface, merging cards into `documents[]`, and a JSON-only CLI.

## 9. Risks, assumptions, unknowns

- **Assumption:** `navigator.clipboard.writeText` works on `http://127.0.0.1:4321`. Browsers treat loopback as a secure context. If it rejects, the client announces `Could not copy` and the peek keeps the text selectable.
- **Assumption:** a brain re-presents a card only on change. Idempotence makes a repeat cheap either way.
- **Risk:** `goal-x-dismisses-presented-documents` edits `shell-event-bindings.js` now. Slice 3 rebases on that commit. Do not start slice 3 before it lands.
- **Risk:** `work-commands.test.mjs:10` pins the scope set. Slice 3 extends the assertion to include `card`.
- **Unknown:** Julian's answer on the cap. Decision 6 makes either answer a one-line change.
- **Unknown:** whether Julian wants `Paste into the composer` on `copy`. Out of this version, per the product's open list.
- **Observed:** `work-desk-view.js:728` has `ageText(created)` for relative time. The hover title reuses it.

Reconsider this design if: a brain needs a card on an Area without a Goal (use the Area presentation design), a kind needs an action that writes state (the product forbids it, so it needs a product change), or the cap becomes per-kind.

## 10. Sources

- Product design: `~/.tangent/trees/otto/tangent/design-brain-presented-interfaces.md`, open comment on section 5.
- Prior records: `../agent-shell-presented-documents/design-record.md`, `../agent-shell-presented-documents-persist/design-record.md`.
- Related designs: `~/.tangent/trees/otto/tangent/design-brains-present-area-documents.md`, `design-let-julian-authorize-cross-area-brain-commands.md`.
- ADRs: 0033, 0038, 0040, 0041, 0043.
- Code: `packages/agent-shell/app/goal-presentations.mjs`, `goal-presentation-routes.mjs`, `command-provenance.mjs`, `pipeline-record.mjs`, `server.mjs` (758-782, 4312, 4769, 6264-6315, 7082, 937-1055), `public/work-desk-view.js` (1958-2014, 2105-2126), `public/work-commands.js`, `public/shell-event-bindings.js` (734-826, 833-838, 1397-1399, 1667-1679, 2744-2789), `public/document-reader-controller.js` (105-130, 184-275), `public/document-reader-view.js` (191-219, 248-284), `public/shell.js` (393-410, 611-620, 1134-1160), `public/refresh-lifecycle.js`, `src/cli/commands/goal.ts`, `src/cli/commands/send.ts`, `src/cli/spec.ts`.

## 11. Proof

Each slice in section 12 names its tests. The Goal is done when all of these pass and the four validation commands (`npm run check`, `npm run test`, `npm run governance`, `npm run build`) pass, and `npm run test:app` in `packages/agent-shell` passes.

## 12. Implementation-ready contract

Procedural. Five slices, in order. Each slice is one commit set with tests and leaves the product working. Stage only the files the slice touches.

### 12.1 Record shape

Add to `goal-presentations.v1`:

```ts
type CardRecord = {
  id: string;                       // uuid, stable across updates
  kind: "copy" | "link" | "links" | "progress" | "checklist" | "commits" | "reviews";
  title: string;                    // trimmed, 1-80 chars, identity with kind
  fields: CardFields;               // validated, see 12.2
  fieldsHash: string;               // sha256 of canonical JSON of fields
  presentedBy: { session: string; role: "brain"; area: string };
  presentedAt: string;              // ISO, first presentation, never changes
  updatedAt: string;                // ISO, last change
  dismissedAt: string | null;
  dismissedHash: string | null;     // fieldsHash at dismissal
};
// record.cards: CardRecord[]   absent means []
```

A file URL inside fields is stored as `{ file: string, root: "vault" | "repository", repository?: string }` and never as a raw path.

### 12.2 Kinds and fields (`app/goal-cards.mjs`)

Export `CARD_KINDS`, `validateCard(kind, title, rawFields, resolveFile)`, `cardFieldsHash(fields)`, `cardSummary(card)` (one line for `goal show` and the row hover). `resolveFile` is injected so the module stays pure.

| Kind | Fields after validation | Limits | Enter |
|---|---|---|---|
| `copy` | `text: string` | 1-10000 chars | clipboard |
| `link` | `url: Url`, `label: string` | label 1-80 | open url |
| `links` | `items: { label, url: Url }[]` | 1-3 items | peek |
| `progress` | `steps: { label, status: "done"\|"current"\|"todo" }[]`, `current: number \| null` | 1-20 steps, `current` 1-based and within range when present | peek |
| `checklist` | `items: { label, done: boolean }[]` | 1-20 | peek |
| `commits` | `repo: string`, `commits: { hash, subject, url?: Url }[]` | 1-5, hash 7-40 hex | peek |
| `reviews` | `items: { id, title, url: Url, state }[]` | 1-10, state 1-40 chars | peek |

`Url` is `{ href: string, host: string }` for `http` or `https`, or the file shape above. Validation order: kind in set, title, then each field. First error wins. The error string starts with `<kind> card:`. Every string is trimmed. Control characters other than newline in `copy.text` are refused.

`progress` extra rule (server side, not in the pure module): refuse with `409 progress card: this Goal has a live pipeline` when the queue has a `running` or `waiting` assignment.

### 12.3 Store (`app/goal-presentations.mjs`)

Add `presentGoalCard(root, goal, card, presenter, now)`, `withdrawGoalCard(root, goal, title)`, `dismissGoalCard(root, goal, id)`, `projectCards(record)`. Rules:

- `presentGoalCard` finds by `kind` and `title`. If found with an equal `fieldsHash` and `dismissedAt === null`, return `changed: false`. Else update `fields`, `fieldsHash`, `updatedAt`, and when the hash differs, clear `dismissedAt` and `dismissedHash`. If not found, push a new entry.
- `withdrawGoalCard` removes the entry. `changed: false` when absent.
- `dismissGoalCard` sets `dismissedAt` and `dismissedHash = fieldsHash`. Idempotent.
- `projectCards` returns entries where `dismissedAt === null || dismissedHash !== fieldsHash`, ordered by `presentedAt` ascending.
- `removeGoalPresentations` is unchanged and removes cards with the file. `pruneMissingPresentations` stays for Documents only. A card whose file URL no longer exists is not pruned. The projection sets `fileMissing: true` on that URL, and the row shows `file missing`.

Tests, `app/goal-presentations.test.mjs`: present, update in place keeps `id` and `presentedAt`, same fields no-op, dismiss hides and is fenced, changed fields return, withdraw removes, Goal closure removes, Documents unaffected.

Tests, `app/goal-cards.test.mjs`: one accept and one refuse case per kind, every limit, `javascript:` and `data:` refused, file URL through the injected resolver, `fieldsHash` stable under key order.

### 12.4 Routes (`app/goal-presentation-routes.mjs`, `server.mjs`)

Add the three routes from 4.2 to the router table. In `server.mjs`:

- `presentCard(body)`: resolve Goal as `present` does, same `404` for closed Goals. `session = actingSession(body)`. `brain = await liveBrainForSession(session)`. If null or `brain.area !== goal.area`, return `403 only the live brain of <area> can present a card on this Goal`. Validate with `validateCard`, passing a `resolveFile` that wraps `resolvePresentedDocument(goal, path)`. Apply the `progress` rule. Call `presentGoalCard`. Emit the `changed` event. Return `200 { goal, card, changed }`.
- `withdrawCard(body)`: same Goal resolve and same brain fence. `404 no card with that title` when absent.
- `dismissCard(body)`: Goal resolve only, no actor check, as `dismiss` today. `404 no card with that id` when absent.
- Projection: in `buildVaultIndex` set `goal.cards = projectCards(record)` and add `presenterLive` per card from `liveBrainForSession(card.presentedBy.session) !== null`, and `fileMissing` per file URL. Do not merge cards into `goal.documents`. Do not add cards to `goalContextDocuments`.
- `GET /api/goals/detail` returns `cards` with the same projection. `GET /api/goals/show` output gains a `Presented` section, one line per card: `<kind> · <title> · <cardSummary>`.

Tests, new `app/goal-cards-http.test.mjs` using `startServer` as `brain-notices.test.mjs` does: a live brain fixture presents on its own Goal (200), on another Area's Goal (403), a worker session (403), a local shell (403), a closed Goal (404), a bad URL (400, record unchanged), `progress` with a running assignment (409), update returns `changed: false` then `true`, `goal done` removes the record, `/api/vault` carries `goal.cards` and not `goal.documents` entries for them.

### 12.5 CLI (`src/cli/spec.ts`, `src/cli/commands/goal.ts`)

Extend `present`:

```
tangent goal present <slug> [<file...>] [--note <text>] [--withdraw]
tangent goal present <slug> --card <kind> --title "<title>" [<kind flags>]
tangent goal present <slug> --withdraw-card "<title>"
```

Options: `card`, `title`, `text`, `url` (repeatable), `label` (repeatable), `step` (repeatable), `item` (repeatable), `current`, `repo`, `commit` (repeatable), `review` (repeatable), `withdraw-card`. Use `parseArgs(argv, { boolean: [...], repeatable: [...] })` as `send.ts` does.

Parsing rules, applied in the CLI only to build `fields`:

- `--step "<label>:<status>"`: split at the last colon.
- `--item "<label>:<done>"`: split at the last colon. `done` accepts `yes|no|true|false|done|open|1|0`.
- `--commit "<hash>:<subject>[:<url>]"`: hash is the text before the first colon. If the remainder matches `/:(https?:\/\/\S+)$/`, that match is `url` and the text before it is `subject`. Else the remainder is `subject`.
- `--review "<id>:<title>:<url>:<state>"`: id before the first colon, state after the last colon, url is the `/(https?:\/\/\S+)/` match in the middle, title is the text before the url without its trailing colon.
- `links`: `--label` and `--url` pair by position. Unequal counts is a CLI error.
- `link`: one `--url`, one `--label`. `--label` defaults to the title.
- With `--card`, any positional file is a CLI error: `--card takes no file`. `--card` without `--title` is a CLI error.

Success prints `presented <kind> card "<title>" on <slug>` or `updated ...` when the server returns `changed: true` for an existing card, or `unchanged ...`. Withdraw prints `withdrew card "<title>" from <slug>`. Server errors print as today.

Tests, `test/cli-goal-present-card.test.mjs` with a fake server as `test/cli-send.test.mjs` does: each parse rule, each CLI error, the request body shape.

### 12.6 Work rows and keys (`public/work-desk-view.js`, `public/work-card-view.js`, `public/work-commands.js`, `public/shell-event-bindings.js`, `public/shell.js`)

- Constant `PRESENTED_ROWS_PER_GOAL = 3`. In `workTreeRows`, child rows = `[...documents, ...cards].slice(0, PRESENTED_ROWS_PER_GOAL)`, overflow row counts the rest. The overflow row keeps its current behavior.
- `workCardRow(goal, card)` in `work-card-view.js`: `<tr class="work-row presented-card" data-work-cursor="card:<goal.file>:<card.id>" data-work-area data-card-goal data-card-id data-card-kind>`. Title button `data-work-row-title` with `aria-label="<kind>: <title>, presented by <session>"`, visible text `<glyph> <kind word> · <title>`, `title` attribute `Presented by <session> · <relative time>` plus ` (brain stopped)` when `presenterLive` is false. Second cell `<small>` with `cardSummary`. Controls: the kind's action button with its printed key (`↵ copy`, `↵ open`, `↵ show`), `o goal`, `x dismiss`, each with `aria-keyshortcuts`. A `link` row shows `card.fields.url.host` in the summary.
- Registry: new scope `card`. Commands `readGoalPresented` (`o`, scope `card`, help `Open the Goal reader at Presented.`) and `dismissCard` (`x`, scope `card`, help `Hide this card until the brain changes it.`). Caption entry for kind `card`: `open`, `readGoalPresented`, `dismissCard`, `search`, `keys`. Extend `work-commands.test.mjs` scope assertion with `card`.
- Dispatch in the `work` context, placed with the presented-row handlers before `readGoal` and `goalStatus`: `current?.dataset.cardId` and the matching command. `executeWorkCommand`: `readGoalPresented` calls `openDocument(goal.file, { anchor: "presented" })`. `dismissCard` posts `/api/goals/dismiss-card { goal, id }`, then `refresh()`, with a `.catch` that calls `announceWork("Could not dismiss")`. `open` reaches the title button click as today. The title button click runs `runCardAction(card)`.
- `runCardAction`: `copy` writes `navigator.clipboard.writeText(text)`, then `announceWork("Copied")` and `showToast("Copied")`, or `Could not copy` on rejection. `link` with an `http(s)` URL calls `window.open(href, "_blank", "noopener")` and announces `Could not open <host>` when it returns null. `link` with a file URL calls `openDocumentPeek(file, { origin })` and reads through `?repository=` when `root === "repository"`. Other kinds call `openCardPeek(goal, card, { origin })`.
- `openCardPeek` in `document-reader-controller.js`: sets `state.documentPeek = { card, goal, origin }`. `renderDocumentPeek` renders the card body from `work-card-view.js` when `peek.card` is set, keeps the dialog chrome, hides sibling arrows and comment controls, and keeps `Close esc`. The body renders each item as a row with its `Open` button (a real `<a target="_blank" rel="noopener">` for http(s), a `data-open-document` button for files), `progress` steps with a mark and the word `current`, `checklist` items with `done` or `open` words, `commits` newest first as given. Escape uses the existing close and focus return.
- Render key: add `(goal.cards ?? []).map(c => [c.id, c.fieldsHash, c.updatedAt, c.presenterLive, c.fileMissing])` to `goalFields` in `vaultRenderProjection`.
- Pointer: click on the row sets the cursor as today. Each control button posts or runs the same function as its key.
- CSS: add `.presented-card` rules only where `.work-row` defaults do not fit. The action button and `o`/`x` follow `.work-row-controls` visibility rules.

Tests, `app/work-table-ui.test.mjs`: a Goal with one Document and three cards shows three child rows and `and 1 more`. `Enter` on a `copy` row writes the clipboard stub and announces `Copied`. `Enter` on a `link` row calls the `window.open` stub with `noopener`. `Enter` on a `checklist` row opens `#document-peek-layer` with the item words and Escape returns focus to the row. `o` opens the Goal reader and the `Presented` heading is present. `x` posts `/api/goals/dismiss-card` with `{ goal, id }` for that row only and never a Document route. `app/work-table-accessibility.test.mjs`: the row title has the accessible name `<kind>: <title>, presented by <session>` and every control has `aria-keyshortcuts`. `app/keyboard-ownership-ui.test.mjs`: `x` on a card row does not open the Goal status modal.

### 12.7 Goal reader (`public/document-reader-view.js`, `public/document-reader-controller.js`)

- `goalDetailPanel` renders `<h2 id="presented">Presented</h2>` after `Related Documents` when `goalDetail.cards.length > 0` or presented Documents exist. Each card in full via `work-card-view.js`, each Document as today. When `openDocument` receives `{ anchor: "presented" }`, scroll that heading into view after paint and move focus to it.

Tests, `app/goal-reader-ui.test.mjs` (or the suite that covers `goalDetailPanel`): the heading appears with cards, is absent without, and `o` from a card row lands focus on it.

### 12.8 Brain instruction (vault)

Edit `~/.tangent/trees/AGENTS.md`, section `Commands`, add two bullets after `tangent goal append`:

- `tangent goal present <slug> --card <kind> --title "<t>" [<fields>]`: show Julian a fact or one action under the Goal on Work. Kinds: `copy`, `link`, `links`, `progress`, `checklist`, `commits`, `reviews`. Send the same kind and title again to update it. `tangent goal present --help` lists the fields.
- `tangent goal present <slug> --withdraw-card "<t>"`: take a card down. `tangent goal present <slug> <file>` still presents a Document.

Mirror the change in `packages/agent-shell/app/vault-root-AGENTS.md`. Observed: `area-note-links.mjs:24-27` ships that file to a vault that has no root `AGENTS.md`, and `KNOWN_ROOT_AGENTS_SHA256` (lines 18-22) lists the shipped versions. Add the new file's sha256 to that set. Commit the vault edit with `tangent vault commit AGENTS.md -m "update: root brains present cards"`.

### 12.9 Out of the boundary

The four later kinds. The `git log` helper. Cards on an Area without a Goal. Cross-Area cards. `Paste into the composer`. Any change to the queue schema, any Goal file write, any vault write other than 12.8. The three-row cap value, which waits for Julian's answer.
