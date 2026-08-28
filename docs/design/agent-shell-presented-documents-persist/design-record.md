# Design record: presented documents remain available after opening

Date: 2026-08-28. Amends `../agent-shell-presented-documents/design-record.md` (commit `ae6b426`). Supersedes its decision 4 ("opening on any surface clears the row") and the "unopened only" wording in decision 3, section 3 step 5, and invariant 3. Every other decision stands.

## 1. Problem

The first slice treated a presentation as a read-once notification: the reader posted `presented-opened`, the server dropped any item with `openedAt` from `goal.presentations`, and the row vanished on the next refresh. Julian's word: a presented Document is a place he returns to, not a notification he clears. Two defects came with the read-once model:

1. Opening one Document removed it, and a refresh mid-read reshuffled the siblings, so "read the next one" needed Go To again.
2. `Enter` on the row called `openDocumentPeek`, which `shell-event-bindings.js` never received from `shell.js`. Enter threw `ReferenceError` and opened nothing; only `o` and the mouse worked.

The `x` verb posted the brain's `withdraw-presentation` route, so Julian's dismissal and the brain's curation were the same fact in the store.

## 2. Decisions

1. **Opening never hides a presentation.** `openedAt` and `openedHash` are still recorded on first open, for the reader's Related Documents line and for the brain, but `projectPresentations` and `vaultIndex` no longer filter on them. The row stays until dismissed, withdrawn, or the Goal closes.
2. **Julian's dismissal is its own fact, fenced to content.** `x` posts `POST /api/goals/dismiss-presentation { goal, file }`, which sets `dismissedAt` and `dismissedHash = presentedHash`. A dismissed item is hidden from Work, the reader merge, and the worker prompt. The brain's `withdraw-presentation` route and `tangent goal present --withdraw` are unchanged and remain the brain's verb.
3. **Fencing.** Re-presenting the same hash is a no-op whether the item is unopened, opened, or dismissed; a dismissed Document cannot return by an agent repeating itself. Presenting new content resets `openedAt`, `dismissedAt`, and `dismissedHash`, so changed work returns to Work. A withdrawn item is re-presentable at the same hash, because withdraw is the brain changing its mind, not Julian.
4. **Enter opens the quick layer; `o` is the full-reader alias; `x` dismisses.** No new key. The fix is wiring: `shell.js` passes `openDocumentPeek` to `bindShellEvents`.
5. **Unchanged:** H1 titles, one record per Goal under `~/.tangent/agent-shell/presented/`, newest-first order and the cap of three with the overflow row, missing-file pruning on index refresh, removal on Goal done, dropped, or parked, and terminal and session cleanup.

## 3. Store schema

`goal-presentations.v1` gains two nullable fields per item: `dismissedAt`, `dismissedHash`. Records written before this change lack them; `!item.dismissedAt` treats absence as not dismissed, so no migration is needed.

Item states: `presented` (renders on Work, `openedAt` null or set), `dismissed` (hidden, Julian), `withdrawn` (hidden, brain). Only `presented` renders.

## 4. Rejected

- **Keep read-once and add a "recent" list.** Rejected: that is the removed desk Documents list under another name, and it needs a second surface to reach what was just cleared.
- **Reuse `withdrawnAt` for Julian's dismiss.** Rejected: the brain must be able to tell "Julian saw it and put it away" from "I withdrew it", and re-present after withdraw must work while re-present after dismiss must not.
- **Drop `presented-opened` entirely.** Rejected: the opened fact is cheap and already printed for the reader; removing it would be churn without a request.

## 5. Proof

- `app/goal-presentations.test.mjs`: opening keeps the item and its sibling; same-hash re-present is a no-op after opening; dismiss hides one row only, is idempotent, is fenced to the hash, and lifts on new content; brain withdraw hides an opened item and allows re-present; pruning and Goal closure clear the record.
- `app/work-table-ui.test.mjs`: with two presentations, `Enter` opens the quick layer and posts `presented-opened` once; `Escape` returns to the same row with both rows still present; `o` opens the full reader; `x` posts `dismiss-presentation` for the highlighted file only and never the brain's withdraw route.
- Existing `document-peek-ui`, `keyboard-ownership-ui`, and `work-commands` suites pass unchanged.
