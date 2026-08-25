# ADR-0027: Every For you row is a direct ask

Date: 2026-08-22

Status: accepted. Amends ADR-0025 (line shapes, clearing verbs, endpoints).

Amended 2026-08-24: a Test can target an open reviewed Goal. Accept marks that Goal done and removes the Test. Reject keeps the Goal open.

Amended 2026-08-25: Work can show a labeled Area Focus subset. The complete total and Dock badge still use the authoritative list.

Amended 2026-08-25: Julian can dismiss one ask as personal UI state. Dismissal does not answer the ask or change its source.

## Context

The `For you` card must equal "what waits on Julian". On 2026-08-22 it showed three rows and none needed him: a `Try it` line for a feature he had already tried and rejected, a `Brain` question, and a row for an idle agent session that needed nothing. When the card lies once, he stops reading it, and the real asks die on a surface he no longer trusts.

Two causes. Rows were admitted by state, not by ask: a row existed because a plan line existed or because a tmux pane stopped changing, and nothing in the code required that the row ask anything. And the verbs described bookkeeping, not the interaction: `Tried it` and `Handled` cleared a row without carrying Julian's answer, so his answer travelled through the terminal instead, the row never heard it, and the row went stale.

Julian's invariant: a row appears only if he must interact with it, and the row states that interaction itself as a direct question. Anything that is not a direct ask must be impossible to show there, not merely discouraged.

Design contract: `~/.tangent/trees/otto/tangent/design-the-for-you-row-shows-only-direct-asks.md` (approved, with Julian's Answers section), solution `impl-the-for-you-row-shows-only-direct-asks.md`.

## Decision

- One ask datatype, one constructor, one renderer. `packages/agent-shell/app/public/ask-core.js` builds `{ id, area, subject, detail, question, actions, source }`. It refuses an ask without an event identity, a question that ends in `?`, or an answer action. Every row source uses one of its builders. `askRow` draws all rows. A non-ask is unrepresentable.
- Two line shapes in the brain's plan, because Julian answers two things: he decides, or he tests. `- Decide [[<document>]]: <question>? Unblocks: <what>.`, `- Decide: <question>?` (no Document), and `- Test [[<goal-slug>]]: <where, press, see>.` A Decide line whose ask does not end with a question mark does not parse. Tangent puts the fixed question `Accept it?` under every Test row. `Decision`, `Try it`, and `Brain` still parse as aliases so live plans keep working.
- The verbs are the answers. `Accept` and `Reject` on any row with a target: `POST /api/brains/verdict` removes the line, commits the plan, and sends the brain `Julian accepted <target>` or `Julian rejected <target>`. `POST /api/brains/verdict/undo` puts the line back and sends `Julian withdrew his verdict on <target>; the line is back`. A bare Reject means the brain parks the subject: no follow-up, no re-ask, no rewritten line. A targetless Decide carries one verb, `Answer`, which names the subject to the brain and opens its terminal. `tried` and `decision-done` are gone.
- A row leaves when it is answered, never on housekeeping, and a stale row is impossible: a Test row renders only while its Goal is `done`, and a row whose target resolves to nothing is not shown at all.
- Hiding is never silent. `unparsedForJulianLines` reports every section line that becomes no row; `tangent brain status` prints them, and a reconcile sweep tells the brain once per plan change (hash on the brain record field `forJulianNoticeHash`).
- Coverage follows the brain record, not the session. An Area whose brain record is `running` or `stopped` never feeds the fallback, so a brain that stopped for a minute cannot make the card list its work twice. A stopped brain's rows stay standing under its header with `Resume`, and it puts nothing on the surface about its own state. A live brain sitting at its own dialog is an ask row, because a blocked brain cannot write a plan line about being blocked.
- Areas with no brain keep a minimal fallback and grow nothing: a session at a dialog, a stopped pipeline step (`Step N stopped. Restart or skip it?`), a finished Goal whose handover names Julian (`Accept the result?`), and a mid-work handover only when its own text asks a question. Idle, waiting, draft, and shell sessions reach no builder. A pane waiting on a background shell it started reads as working, so it never becomes a row.
- Each row has a quiet `×` button at its right edge. The button has an accessible label and accepts keyboard focus.
- The button stores one versioned dismissal receipt in browser-local UI state. It does not call a Goal, pipeline, Request, brain, or worker endpoint.
- The receipt identifies one source event. Pipeline attempts use `startedAt`. Dialogs use `waitingSince`. Requests use their durable IDs.
- The renderer removes dismissed identities from all `For you` projections and counts. The source work stays in its normal Goal, brain, or Request surface.
- Undo removes only that receipt. A later source event can appear because it has a new identity. Polling and reload keep the current event hidden.

## Consequences

- New browser module `public/ask-core.js` with `ask-core.test.mjs`; `forYouRow`, `inferredRow`, and `deskAttentionItems` are deleted from `shell.js`.
- `for-julian.mjs` returns kinds `"decide"` and `"test"` and gains `forJulianSectionText` and `unparsedForJulianLines`. Every consumer speaks the new kinds.
- New endpoints `POST /api/brains/verdict` and `POST /api/brains/verdict/undo` replace `tried`, `tried/undo`, `decision-done`, and `decision-done/undo`. `GET /api/brains/show` gains `forJulianUnparsed`; the brains payload gains `stateQuestion`.
- `classifyStaticPane` reads a running background shell as work, after the dialog sweep, so a pane that asks while its shell runs is still an ask.
- The Dock badge, the Work tab count, and the Area pill all read `forYouItems()`, so the number is one list everywhere.
- Area Focus filters only the rows that Work shows. Work labels the shown count, complete total, and count outside Focus.
- New browser module `public/ask-dismissal-core.js` owns the versioned local receipt. Damaged storage hides nothing, and a failed write keeps the row visible.
