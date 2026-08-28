# Agents present their documents: design record

Date: 2026-08-28. Status: designed, not implemented. Goal: `otto/tangent/goal-agents-present-their-documents-as-first-class-ui.md`. Read `user-intent.md` first.

Lenses: UI/UX, architecture and data, API (the worker CLI is a contract boundary). No migration lens: the queue schema does not change, and the new store is additive. No operations lens: one small JSON store, no retries.

This design builds on the work-contract record (`../agent-shell-work-contract/design-record.md`), the navigation model (`../agent-shell-navigation-model/design-record.md`), the Work screen refresh (`../agent-shell-work-screen-refresh/design-record.md`), ADR-0038, ADR-0040, and ADR-0041. It does not reopen their decisions.

## 1. Problem contract

**Root problem.** An agent writes a document for Julian and tells him about it inside its chat. Julian then has to translate the agent's words into a file name and paste that into Go To. The blocked outcome is "read what the agent wrote, now, from the Work screen". The stated symptom (title differs from file name) is one cause. The deeper cause is that Tangent has no record that an agent presented a document, so no surface can show it. The information exists only in a terminal.

**Observed causes.**

1. No channel. A worker has one command, `tangent send brain "<note>"`. The note is one whitespace-collapsed string of at most 4000 characters (`agent-messages.mjs:82`). The brain reads a 400-character excerpt (`server.mjs:4003`). Nothing parses a path or a title out of it. The queue schema `area-goal-queue.v2` has no document field. `extraFiles` holds extra Goal files. `report.criteria[].evidenceRefs` is free text that `send` cannot set on its own.
2. The link is implicit. The worker prompt says: "Design documents go in the Area folder as design-<slug>.md ... with a [[goal-slug]] link" (`server.mjs:1783`). The vault projection discovers the document by that backlink (`server.mjs:975-987`). When the worker forgets the link, nothing recovers it, and nobody is told.
3. Work shows no documents. Julian removed the Documents list from the Work tab on 2026-08-20 (`goal-the-work-desk-is-compact-no-documents-list-time.md`). The Goal reader lists Related Documents by title (`document-reader-view.js:212`), but Julian has to know that the reader has them.
4. Repository records are invisible. This repository's design skill writes records to `docs/design/<name>/design-record.md`. Since 2026-08-14 the repository gained 43 such records; the vault gained 742 touches of `design-*.md`. The reader opens only vault-relative paths (`safeMarkdownPath`, `vault-documents.mjs:23`). A worker that follows the repository convention produces a document Julian cannot open in Agent Shell at all. The previous session's `handover.md` at the repository root is an example.
5. Titles and file names. Go To matches the H1 title and the file-name slug (`go-to-core.js:50,65`). Two documents with the same title in one Area render identical rows except for a file-name disambiguator. The For you Decision rows lead with the file-name slug because that is what Julian recognized on 2026-08-20. The same person now asks for the human title. Both are true: he recognizes whichever name the agent used in front of him. The fix is to remove the translation, not to pick a side.

**Constraints.**

- Workers only send (ADR-0040). Every worker mutation route is refused (`WORKER_REFUSED_ROUTES`, `server.mjs:4174`), including `/api/document`.
- Tangent never writes into vault notes or Documents. Documents carry no frontmatter beyond `skill-` and `process-` files (vault README). The vault owns Documents; a bound repository owns architecture records (ADR-0033).
- Work shows work only (Julian, 2026-08-20). A standing list of documents on the desk was removed and must not return by another name.
- One visible surface owns each key (ADR-0038). New keys need a printed control. The object grammar is: move the cursor to an object, apply a generic verb (`Enter`, `o`, `x`, `:`, `a`, `?`).
- Everything starts through the brain (ADR-0041). The brain organizes an Area's work; workers do the work.
- Julian answers a Decision by commenting in the Document (ADR-0025, ADR-0027). Comments are CriticMarkup in the vault file and need the vault git lane.

**Non-goals.**

- Reading state as a general feature ("did Julian read this"). That design was dropped on Julian's word (`design-right-document-reading.md`). This record uses one narrow fact, "opened since presented", for one purpose.
- A document browser, graph, or ranking of all Documents. Go To and the Area page keep that.
- Changing what a Document is, or adding frontmatter or a taxonomy to the vault.
- A new Request kind. A presentation asks for attention, not an answer.

**Success conditions (observable).**

1. A worker runs `tangent send brain --done "<note>" --present <file>`. Within one refresh, the Goal row on Work shows one child row with the document's H1 title. `j` reaches it, `Enter` opens it, `Escape` returns to the same row.
2. The brain can present a document on any Goal of its Area with one command, and can withdraw one.
3. After Julian opens a presented document on any surface, its row leaves Work. The document stays in the Goal reader's Related Documents and in Go To.
4. A Goal marked done, won't do, or parked shows no presented rows.
5. A present command with a missing file, a non-Markdown file, or a file outside the vault or the assignment's repository fails with a printed reason and records nothing.
6. A presented repository file opens read-only in the reader with a printed "Repository file" label and no comment controls.
7. Every presented document appears in the Goal reader's Related Documents and in the next worker prompt's Sources, with or without a `[[goal]]` backlink.

## 2. Current system (Observed)

### 2.1 What a Document is

A Document is any `.md` file directly inside an Area folder that is not the Area note, `AGENTS.md`, `CLAUDE.md`, or a `goal-`/`outcome-` file (`readAreaDocuments`, `server.mjs:711`). Identity is the vault-relative path. Title is the first H1, else the file stem (`markdownTitle`, `vault-documents.mjs:33`). Kind comes from the file-name prefix (`area-map-core.js:41`). Relations are `[[wikilinks]]` in prose only (`wikiLinks`, `vault-documents.mjs:16`).

### 2.2 How a Goal gets its documents

`vaultIndex()` builds `goal.documents`: Documents the Goal links, or that link back to the Goal, ordered by the Goal's own link order, then title (`server.mjs:975-987`). `GET /api/goals/detail` passes them as `relatedDocuments` (`server.mjs:6479`, `goal-detail.mjs:63`). The reader renders them as title buttons inside the Goal panel (`document-reader-view.js:203-212`). `goalContextDocuments` (`server.mjs:1624`) re-derives the list from the Goal file's links alone for the worker prompt, and prints each as `- Document: <abs path> (N open comments)` (`server.mjs:1771`).

`tangent goal create --source <file>` writes a `## Sources` section once at creation (`server.mjs:1297`). Nothing appends sources later.

### 2.3 How agents talk to Tangent

- Worker: `tangent send brain "<note>" [--done|--blocked|--question]` → `POST /api/agents/send` → `sendToBrain` (`server.mjs:5794`) → `assignment.handover`, `assignment.reports[]` (typed from the flag, `server.mjs:3010`), `handoverReceipts[]`, and one brain inbox notice (`brain-inbox.mjs:69`).
- Brain: `tangent goal done|wont-do|append|own|release`, `tangent brain request` (kinds `plan`, `decision`, `approval`; `brain-requests.mjs:71`). A request record already has a `documents: string[]` field (`brain-requests.mjs:87`) that the CLI does not expose and no view renders.
- `tangent goal done --note` drops the note unless the Goal is flagged `verify` (`server.mjs:6809-6817`). The CLI help says otherwise (`goal.ts:594`). That is a live bug on the path the brain uses after a worker's done note.

### 2.4 What Work and the reader show

The Goal row prints title, agent line, and status (`work-desk-view.js:1731`, refresh D5 and D6). Subgoal rows sit under the Goal, hidden when folded, and `h`/`l` fold and unfold. The navigation model adds assignment and attempt rows under the Goal as the only new addressable objects. `Enter` on a Goal opens the Goal reader; `⌘⇧↵` enters the session; `o` reads.

Go To (`⌘K`) lists Documents, Area notes, and brains. Enter on a Document opens the quick read-only layer (`shell-coordinator.js:157`); `Open full reader` promotes it. Goals are excluded on purpose.

The reader has two surfaces with one article renderer: the full reader in `#screen` and the quick layer above it (`document-reader-view.js:225,245`). Both read `GET /api/document?file=<vault path>`.

### 2.5 The For you Decision row

The brain's plan can hold `- Decide [[<document>]]: <question>?` rows. Work rendered them with the file-name slug, a Read button, Handled, and Reply (`goal-a-decision-row-is-the-document-to-read-and-repli.md`, done 2026-08-20). That was the one shipped shape of "an agent puts a document in front of Julian". It rode on Markdown parsing of the plan, which the brain-worker model retires in favor of structured request records (D5 there). `ask-core.js` is unimported and inside the ADR-0033 audit window.

## 3. Precedent

**Internal.**

- Brain requests: a structured record in `~/.tangent/agent-shell/`, created by a CLI verb, rendered on Work, answered or withdrawn, and gone. The presentation store copies this lifecycle shape and reuses the `documents` field idea.
- `goal.documents` and `relatedDocuments`: the derived list of a Goal's documents. Presentation feeds this list rather than adding a second one.
- The Decision row: "show him the doc name to read; press it to Read". Presentation is that row, generalized to any agent and any document, without the Markdown plan parser.
- Session binding: a finished Goal leaves no session behind. A finished Goal leaves no presentation behind either.
- The quick Document layer: Go To's Enter already opens a document above the current screen and Escape returns in one press. A presented row's Enter does the same.

**External.** Pull-request "files changed" and review request badges: the author declares what to look at, the badge clears when the reviewer looks, the declaration stays in the record. Slack "unread" markers: a mark is a per-reader state, never a property of the message. Both separate the durable artifact from the transient attention state. That separation is the anti-litter invariant here.

## 4. Lens analysis

### 4.1 UI/UX

**Intent and common path.** "The agent wrote something. Read it." Path: the Work cursor is on or near the Goal, `j` to the presented row, `Enter`. Read. `Escape`. The row is gone. Six keys, no typing, no translation.

**Complete workflow.**

1. A worker finishes a design step and runs `tangent send brain --done "Design record written; proved by ..." --present otto/tangent/design-x.md`. The CLI resolves the path, checks it exists and ends in `.md`, and sends one request. Tangent stores the presentation and the done report in the same operation.
2. Within one refresh (2.5 s), the Goal row on Work gains one child row under it, before subgoals: `↳ Read · Agents present their documents: design record` in the title column, the presenting agent's short name and `5m` in the status column. The row is a pointer target and carries `data-work-cursor`. It is visible even when the Goal's subgoals are folded, because it is the next human action on that Goal, and Work shows the next human action.
3. Keys on the row: `Enter` opens the quick layer with the document (same as Go To). `o` opens the full reader with the Goal as its Back target. `x` withdraws the presentation without opening (the "seen it, not now" verb, in the same state-owned modal shape as Goal status). `:` shows those three. The caption key line prints them while the cursor is on the row.
4. Julian reads. `Escape` closes the layer and restores the cursor to the Goal row (the presented row no longer exists, so the parent is the return object).
5. The presentation is now `opened`. The row is gone from Work. The document is still listed in the Goal reader under Related Documents, with the presenting agent and time as its small line, and in Go To.
6. If the agent changes the document and presents it again, the row comes back. If the agent presents it again with no change, nothing changes (idempotent on file and hash).
7. When the brain marks the Goal done, won't do, or parked, all presentations on the Goal are removed in the same write, like the session binding.

**Mouse.** Clicking the row moves the cursor and opens the quick layer (one click, like Go To's Enter). The row's controls print `↵ read`, `o full`, `x dismiss` on the cursor row, hover, and focus, per refresh D4.

**Visible state.** A presented row exists only while `unopened`. There is no badge, count, or dot elsewhere. The Area header pill does not count presentations; they are a Goal-level fact and the row is enough.

**Empty, stale, and error states.**

- The file was deleted or moved after presentation: the row prints the stored title in the muted colour with `missing` and `Enter` shows the reader's not-found state with a Back. `x` removes it. The vault index refresh also drops presentations whose file no longer exists, so this state is short.
- The document changed after presentation but before opening: no special state. Julian opens the current text.
- More than three unopened presentations on one Goal: Work prints the newest three and a fourth row `and N more · o` that opens the Goal reader. This cap keeps the desk compact under a chatty agent.
- A presentation on a Goal Julian cannot see (folded done Area): none. Done Areas fold their Goals away already.
- Repository file: the reader prints `Repository file · comments off` in the heading row. Comment controls, notify, and edit are absent, not disabled.

**Dangerous actions.** None. Presenting never starts an agent, changes Goal state, or writes into the vault. Opening writes only the presentation store.

**Cost of the new pattern.** One new row kind on Work, using the existing cursor, verbs, and layer. No new key. One new word, "present", which is Julian's own word for the Goal.

### 4.2 Architecture and data

**Ownership.**

| Fact | Owner | Store |
|---|---|---|
| The document text and title | vault, or the bound repository | file |
| That a Goal relates to a document | derived from links, plus presentations | `vaultIndex` projection |
| That an agent presented a document to Julian, when, and whether Julian opened it | Tangent runtime | `~/.tangent/agent-shell/presented/<area>/<slug>.json` |
| That a worker finished a step | queue | `pipelines/<area>/<slug>.json` |

The presentation store is separate from the queue on purpose. The queue is the pipeline's record and its revision guards pipeline control. Presentations change when Julian opens a document, which must not bump the queue revision or race a pipeline write. The store is a rebuildable attention record, like `reading.json` in the dropped design, but scoped to presentations only.

**Record shape** (`goal-presentations.v1`):

```json
{
  "schema": "goal-presentations.v1",
  "goal": "otto/tangent/goal-agents-present-their-documents-as-first-class-ui.md",
  "area": "otto/tangent",
  "slug": "agents-present-their-documents-as-first-class-ui",
  "items": [
    {
      "id": "p1",
      "file": "otto/tangent/design-agents-present-their-documents.md",
      "root": "vault",
      "title": "Agents present their documents",
      "presentedBy": { "session": "tangent-agents-present-...", "role": "worker", "assignmentId": "assignment-1" },
      "presentedAt": "2026-08-28T06:10:00.000Z",
      "presentedHash": "<sha256 of text at presentation>",
      "note": "Design record with decisions and the implementation boundary",
      "openedAt": null,
      "openedHash": null,
      "withdrawnAt": null
    }
  ]
}
```

- `root` is `vault` or `repository`. For `repository`, `file` is an absolute path and the record also stores `repository` (the bound repository root that authorized it).
- `title` is a snapshot for the missing-file state. Live rendering uses the index title when the file exists.
- One item per `(file)` on a Goal. A repeat present with the same `presentedHash` is a no-op. A repeat with a new hash resets `openedAt` and updates `presentedAt`.

**Valid states of one item.** `unopened` (openedAt null, withdrawnAt null) → `opened` (openedAt set) or `withdrawn` (withdrawnAt set). Only `unopened` renders on Work. Opened and withdrawn items stay in the record, so the reader's Related Documents can print "presented by <agent> on <date>" and the brain can see what Julian already opened. The record is deleted with the Goal's session binding when the Goal closes.

**Derivation.** `vaultIndex` merges presentations into `goal.documents`: every presented vault file joins the related list, ahead of link-derived items, ordered newest presentation first. `goalContextDocuments` (worker prompt) does the same merge, so the next step's prompt names the document even when the first worker forgot the backlink. Repository items join `relatedDocuments` with `root: "repository"` and are excluded from the prompt's vault Sources; they print as `- Repository file: <abs path>`.

**Where untrusted input becomes a domain value.** The CLI sends a path string. The server resolves it once: `safeMarkdownPath(TREES_ROOT, file)` for vault paths; for absolute paths, the path must be inside a repository the Area declares in Knowledge (`- Repository:` or `- Worktree:`) or the presenting assignment's `path`. Anything else is refused with a reason. The store never holds an unresolved path.

**Reader boundary.** `GET /api/document?file=` stays vault-only. A new query form `GET /api/document?repository=<abs path>` serves a repository Markdown file read-only, and only when a presentation record authorizes that exact path. The record is the allow-list, so the reader never becomes a general file browser. `POST /api/document` and comments refuse repository paths.

**Invariants (the anti-litter rules).**

1. A presentation is attention state, never a document property. Nothing is written into the vault to present.
2. A presentation is bound to one open Goal. When the Goal closes, its presentations go with it, in the same write as the session binding.
3. A presentation shows on Work only while unopened. Opening on any surface (quick layer, full reader, Go To, reader link) clears it.
4. At most three unopened presentations render per Goal. The rest are one row into the reader.
5. Presenting is idempotent on file and content hash.
6. A missing file cannot be presented, and a presentation whose file disappears is dropped on the next index refresh.

### 4.3 API

**Worker.** One flag on the one worker command:

```text
tangent send brain "<note>" [--done|--blocked|--question] [--present <file>]...
```

`--present` is repeatable. `<file>` is vault-relative (`otto/tangent/design-x.md`), or an absolute or cwd-relative path to a Markdown file inside the assignment's repository. The CLI resolves relative paths against the current directory and sends both the resolved absolute path and the vault-relative form when the file is under `~/.tangent/trees/`. The server writes the presentation and the send in one operation; when the presentation is refused, the whole command fails with the reason, and no note is sent, so the worker sees the problem and can fix the path.

Why on `send` and not a new verb: ADR-0040 keeps workers at one command, and the prompt's `## When you finish` section stays one block. The flag is the only worker-facing surface change.

**Brain.** Two commands:

```text
tangent goal present <slug> <file>... [--note "<why>"]
tangent goal present <slug> --withdraw <file>
```

The brain can present on Julian's behalf when it reads a worker's done note and judges the document worth his time, and it can withdraw a presentation a worker made that is no longer current (for example after a review step replaced the document). This is the curation responsibility: workers declare, the brain curates, Tangent enforces the lifecycle.

**Routes.**

```text
POST /api/goals/present    { goal, files: [string], note?, session }
POST /api/goals/withdraw-presentation { goal, file, session }
POST /api/goals/presented-opened { goal, file }   (browser only, on open)
```

`/api/goals/present` is added to the worker-permitted set with one check: a worker can present only on the Goal its session is bound to (`commandProvenance`). `GET /api/goals/detail` and `GET /api/vault` carry the merged `relatedDocuments` and the unopened presentations per Goal.

**Requests.** `tangent brain request` gains `--document <file>` (repeatable), filling the existing `documents` field. The review surface renders those as title buttons that open the quick layer. This is one small slice that makes "Decide about this document" work through the structured record instead of the retired plan parser. A request's documents do not render as presented rows; the request row is their surface.

## 5. Candidate designs

**A. Presentation as a child row on Work, backed by a Tangent-owned store (selected).** Described above.

**B. Present through the vault only: the worker writes the `[[goal]]` link, the brain links the document from the Goal file, Work shows `goal.documents` again.** Rejected. Julian removed the desk Documents list because a standing list is not work. Links are permanent, so the list never clears; every document a Goal ever touched stays on the desk. It also cannot include repository files, and it requires the brain to edit Goal Markdown for a routine event.

**C. Presentation as a Request kind (`read`).** Rejected. Requests need an answer and stay open until Julian answers or the brain withdraws. Julian said there is no test request because he flags what he checks. A read request is that, under another name. Requests also live in the brain's record, so a worker could not create one (ADR-0040). Reusing the request `documents` field for real requests is kept as a small slice.

**D. Parse paths and titles out of the send note.** Rejected. Notes are collapsed prose; a path in prose is an accident, not a declaration. Parsing presents documents that the agent only mentioned. The explicit flag costs the agent five characters and is unambiguous.

**E. Open repository files by extending the reader to any absolute path.** Rejected. That makes `/api/document` a file browser. The presentation record as the allow-list gives the same result for the files that matter with no new surface.

**F. Show a badge or count on the Goal row instead of a child row.** Rejected. A count needs a second gesture to see what it counts, and the refresh design removed colour-only and count-only signals. The child row prints the title, which is the whole point.

## 6. Evidence and counterexamples

- Julian asked for the file-name slug on Decision rows (2026-08-20) and now asks for the human title. Counterexample to "always title": he recognizes whichever name he last saw. The child row prints the H1 title as the primary text and the file stem as the hover title, and Go To keeps matching both. The translation disappears because the row is where the agent's mention was.
- The desk Documents list was removed for space (2026-08-20). The child row is not that list: it appears only while unopened and is capped at three. Under a quiet agent, Work looks exactly as it does today.
- `handover.md` at the repository root and `docs/design/agent-shell-navigation-model/` exist in this checkout and are unreachable from Agent Shell. The repository-file branch of the design is not speculative; the previous worker on this Area produced exactly that.
- The `documents` field on request records has existed unused since the request design. It shows that "attach a document to a thing Julian sees" was wanted before and never wired.
- `tangent goal done --note` silently discards the note on non-verify Goals. Not part of this design, but the brain's done path must not be trusted to carry a document mention. That supports an explicit present verb.

## 7. Decisions

1. **A presentation is Tangent attention state, stored in `~/.tangent/agent-shell/presented/<area>/<slug>.json`, never in the vault or the queue.** Decisive evidence: the vault must not carry metadata, and opening a document must not bump a queue revision.
2. **Workers declare with `tangent send brain ... --present <file>`; the brain curates with `tangent goal present` and `--withdraw`; Tangent enforces the lifecycle.** Decisive evidence: ADR-0040 and ADR-0041 fix the roles; the worker knows what it produced, the brain knows what matters.
3. **On Work, an unopened presentation is one child row under its Goal with the document's H1 title, visible while subgoals are folded, capped at three.** `Enter` opens the quick layer, `o` the full reader, `x` withdraws. No new key. Decisive evidence: the navigation model's object grammar and refresh D4.
4. **Opening on any surface clears the row. Closing the Goal removes the record.** Decisive evidence: the session binding rule and the "show work only" rule.
5. **Presented documents join `goal.documents`, the Goal reader's Related Documents, and the worker prompt's Sources, with or without a backlink.** Decisive evidence: the forgotten-link failure has no recovery today.
6. **A repository Markdown file can be presented and read read-only; the presentation record is the allow-list.** Decisive evidence: this repository's design records live in `docs/design/`, and the previous worker's output is unreachable today. Assumption: Julian accepts "comments off" on repository files. If he wants comments there, the answer is a vault Document that links the record, which the agent writes at presentation time.
7. **`tangent brain request --document <file>` fills the existing `documents` field and the review surface opens them by title.** Cheap and closes a known gap.
8. **The present command fails closed.** Missing file, wrong extension, path outside the vault and the authorized repository, or a worker presenting on another Goal: refused with a printed reason, nothing stored, and for a worker the note is not sent either.

## 8. Rejected alternatives

The strongest was B (vault links only). It needs no new store and matches "Markdown is the truth". It lost because links are permanent and presentations must expire, because Julian removed exactly that list from Work, and because it cannot reach repository files. The second strongest was C (a Request kind), which lost on Julian's "no test request" word and on worker permissions.

## 9. Risks, assumptions, unknowns

- **Assumption:** agents will use `--present`. Mitigation: the worker prompt's `## When you finish` block prints the flag with the example `--present <the file you wrote>`, and the design-document sentence in `goalPrompt` says "then present it". A worker that writes a design document and does not present it is a prompt failure the brain can see in the done note.
- **Assumption:** the H1 title is the name the agent used in chat. Weak when the agent calls it "the design record". Mitigation: the row prints the title and, as its small line, the agent's `--note` text when given.
- **Unknown:** whether Julian wants presentations from the brain's own writing (plan updates, Area note rewrites). This record allows it and does not require it.
- **Unknown:** the right cap (three). Cheap to tune.
- **Risk:** a chatty pipeline with several steps presents the same file three times. Idempotence on hash covers the no-change case; a changed file re-presents on purpose.
- **Conditional:** if the navigation model's assignment and attempt rows ship first, the presented row is a sibling of those rows under the Goal and uses their cursor id scheme (`document:<file>`). If not, it is the first child-row kind and sets the pattern.
- **Reconsider when:** Julian asks for a standing list of a Goal's documents on Work again. That contradicts the 2026-08-20 rule and needs his word.

## 10. Implementation boundary

Slices, in order. Each is one commit set with tests, and each leaves the product working.

1. **Store and routes.** `goal-presentations.mjs` (record, `present`, `withdraw`, `markOpened`, `pruneMissing`, `removeForGoal`), `POST /api/goals/present`, `/withdraw-presentation`, `/presented-opened`; worker permission check; removal in the Goal done/won't-do/park write; merge into `vaultIndex` `goal.documents` and `goalContextDocuments`. Tests: HTTP fixture for each refusal, idempotence, removal on close, merge order.
2. **CLI.** `--present` on `tangent send` (fails closed before sending); `tangent goal present <slug> <file>... [--note] [--withdraw <file>]`; `--document` on `tangent brain request`; `## When you finish` and the design-document sentence in `goalPrompt` updated. Tests: spec, arg parsing, prompt snapshot.
3. **Work row.** Child row kind `document` under the Goal in `work-desk-view.js`, cursor id `document:<file>`, cap and overflow row, controls printed per D4, caption key line, `Enter`/`o`/`x` in `work-commands.js` with per-object availability; `presented-opened` call from `openDocumentPeek` and `openDocument`. Tests: `work-table-ui`, `keyboard-ownership-ui`, `document-peek-ui` return-to-Goal-row.
4. **Reader.** Related Documents prints presenter and time; `GET /api/document?repository=` read-only branch with the printed label and absent comment controls; missing-file state. Tests: `document-routes`, `goal-reader-ui`.
5. **Request documents.** Render `request.documents` on the review surface as title buttons. Test: review UI.

Out of the boundary: reading state beyond presentations, any change to the queue schema, any vault write, the `goal done --note` bug (file it as its own Goal).

## 11. Sources

- Repository: `packages/agent-shell/app/server.mjs` (`readAreaDocuments` 711, `vaultIndex` documents 975-1005, `goalContextDocuments` 1624, `goalPrompt` 1760-1786, `reportFromSendKind` 3010, `brainMessageExcerpt` 4003, `WORKER_REFUSED_ROUTES` 4174, `goals/detail` 6465, `goals/edit` 6800), `vault-documents.mjs`, `goal-detail.mjs`, `brain-requests.mjs:87`, `brain-inbox.mjs`, `agent-messages.mjs:82`, `document-routes.mjs`, `public/document-reader-view.js` (203-212, 225, 245), `public/document-reader-controller.js`, `public/go-to-rows.js`, `public/go-to-core.js`, `public/shell-coordinator.js:157`, `public/work-desk-view.js:1731`, `public/work-commands.js`, `src/cli/commands/send.ts`, `src/cli/commands/goal.ts`, `src/cli/spec.ts:93`.
- Vault: `otto/tangent/design-living-documents.md`, `design-find-a-document-by-title.md`, `design-quick-returnable-document-search.md`, `design-right-document-reading.md` (dropped), `design-comment-on-documents.md`, `design-goal-cards.md`, `design-brain-worker-operating-model.md`, `goal-the-work-desk-is-compact-no-documents-list-time.md`, `goal-a-decision-row-is-the-document-to-read-and-repli.md`, `goal-go-to-finds-a-document-by-its-file-name.md`, `~/.tangent/trees/README.md`, `~/.tangent/trees/AGENTS.md`.
- ADRs: 0017, 0024, 0025, 0027, 0033, 0038, 0040, 0041.
- Design records: `../agent-shell-work-contract/design-record.md` (Goal reader, related Documents), `../agent-shell-navigation-model/design-record.md` (object grammar), `../agent-shell-work-screen-refresh/design-record.md` (D4, D5, D6).
