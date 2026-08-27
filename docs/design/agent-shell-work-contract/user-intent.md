# Agent Shell work contract: user intent

Date: 2026-08-27

This note preserves Julian's requirements before the design changes them into implementation details.

## Desired experience

Agent Shell must be a keyboard-first operating surface for agent work. Julian should not need a mouse for routine use.

An embedded agent session must behave like the same tmux session in iTerm. Tangent must not invent different input, selection, scrolling, resize, or send-key behavior. Terminal text must remain sharp and stable while scrolling.

The brain must organize work. It creates Goals, dispatches workers, advances pipelines, and keeps work moving. It does not perform worker tasks itself.

Agent work must survive a dead process, a changed harness, or a missed launch prompt. A replacement coding agent must be able to inspect its tmux context and recover its assigned Goal, task, instructions, and recent handovers.

## Current failures

- Embedded tmux sessions can stay at approximately 80 columns by 24 rows. The content then occupies only part of the available frame.
- Custom terminal behavior has caused unreliable send keys, scrolling, and blurred or stale text.
- Worker handovers and messages do not reliably reach brains across all harness combinations.
- Delivery can depend on whether Tangent thinks the receiving agent is idle. A busy agent can therefore miss important work.
- Launch instructions are often sent once and then lost. Recovery can duplicate work or require Julian to restate the task.
- Tangent can block a brain from acting on another Area or brain after Julian explicitly requested that action.
- Agent instructions can prohibit direct Markdown edits even when Julian explicitly requests them as a recovery action.
- A configured default brain harness, model, or effort can fail to control the next brain launch. The result is confusing and not visible before launch.
- Browse Areas contains controls Julian does not use. Its current purpose is to open an Area brain and set that brain's defaults.
- Describe Work duplicates a conversation with the brain.
- Concurrent and Planned add navigation and state distinctions that do not help the main workflow.

## Required product rules

1. Never stop, restart, replace, or kill a working agent to apply an interface fix.
2. Treat tmux as the session authority. The browser frame is a view and input path for that session.
3. Keep messages and handovers in durable state until the receiver records a receipt.
4. Do not discard or delay a message because the receiver is busy. Queue it and wake the receiver safely.
5. Let brains poll worker state and pending events. Workers must not need special knowledge of a brain to keep orchestration correct.
6. Make task context discoverable after launch. Do not depend on a one-time prompt as the only copy.
7. Apply the configured default brain launch policy every time. Show the resolved harness, model, and effort before launch.
8. Reduce the Work interface to the current work and direct brain access.
9. Reduce Area browsing to brain discovery, brain launch, and default brain configuration.
10. Remove Describe Work from the interface.
11. Preserve keyboard access for every remaining action.
12. Honor Julian's explicit instruction when it authorizes cross-Area action or direct Markdown editing. Safety checks must protect other live owners, not reject the requested outcome by category.

## Preferred communication model

The simplest acceptable model is a durable queue plus tmux wakeups.

- A sender records a message before it tries to wake a session.
- Tangent can send a lightweight wakeup to a busy tmux pane.
- The receiver reads pending messages from durable state and records receipts.
- Tangent retries wakeups while acknowledged work remains pending.
- A missed wakeup is harmless because the queue remains authoritative.
- A brain periodically checks its workers and pending events. Worker progress does not depend only on a worker handover command.

The exact wakeup transport can change. The durable queue, receipt, recovery, and non-destructive behavior cannot.

## Scope guidance

Prefer a coherent refactor around these rules over isolated bug patches. Preserve live sessions during development and deployment. Deliver the highest-leverage safe slice first when the full correction cannot fit in one change.

After this change is verified and committed, Julian wants to reset the Work surface. At that point, Tangent can mark the remaining open Goals as won't-do and retire their Agent Shell work. This permission applies to the final cleanup only. It does not permit an implementation step to interrupt a working agent.

## Live usage feedback

Julian tested the Work surface while this change was in progress. These points extend the original requirements.

- Escape must undo the current keyboard narrowing action. It should clear Work search, Area Focus, or another active filter before it leaves the table.
- Routine Work controls should not depend on visible buttons. Focus Area and Current or Planned need fast keyboard paths if they remain.
- Removing Browse Areas must not remove brain settings. Brain launch defaults need a direct keyboard path.
- The Open brain label is visually misaligned.
- The Goal or task title is the natural session target. Selecting that title should open its active agent session.
- A Work row should put the Goal above the agent name. Small text can show the assignment or step number.
- Stopping a brain needs a discoverable keyboard action. It cannot require a pointer click.
- The Work keys help opened by `?` is hard to scan. Commands must use separate rows instead of dense inline text.
- The key sheet must scroll with Vim keys and fit every command on the screen.
- `Shift-[` and `Shift-]` should jump to the previous or next Area.
- Enter must confirm a stop dialog that has no input field.
- Opening a brain, a Goal worker, or an ad hoc task should feel like one operation.
- Every launch surface must show harness, model, and effort.
- Area defaults must prefill those choices. Julian must be able to override them quickly for one launch.
- Brain, Goal, and default choices need the same complete keyboard navigation.
- Tab, Vim keys, arrows, Enter, and Escape must cover harness, model, and effort selection.
- Escape must leave harness and model editing and return to the exact Work position.
- Pointer Back and keyboard Escape must follow one consistent navigation rule across the application.
- Live use exposed registry editing as a concrete failure: Escape appeared to do nothing, so there was no obvious route back to Work.
- Back navigation is a product-wide contract. Each screen, chooser, editor, popover, and filter must declare its parent and restore the exact opener; isolated key fixes are not sufficient.
- Keyboard-first means every remaining action has a keyboard path. A visible button can support discovery, but it cannot be the only path.
- Actions must be obvious where the related object appears. Julian should not need to search documentation before acting.
- Every shortcut must have an equivalent pointer action.
- Every pointer action must show its shortcut when one exists. Mouse use should teach the faster keyboard path.
- Documents are a primary collaboration surface. Reading and commenting must work without a mouse.
- Document movement should support familiar Vim keys where browser text editing does not own the input.
- Keyboard actions must cover creating, moving between, editing, replying to, and resolving comments.
- Document pointer controls must show the same shortcuts so occasional mouse use teaches the keyboard flow.

## Later Work and command feedback

Julian continued to use Work after the first keyboard changes. These points extend the contract again.

- Use `h` and `l` for tree collapse and expansion. Remove the `z` fold command.
- Remove the repeated You and Dependency preview lines from Work for now.
- A Goal needs visible Done, Won't do, Park, and Reopen actions. None of these actions deletes the Goal.
- Julian needs a direct way to read a Goal, its done condition, notes, and related Documents.
- Enter on a Goal remains the natural agent action. It opens the live agent or the launch editor.
- Enter on an Area in Work must use the brain path. It must not open Browse Areas.
- A launch editor must support the complete step lifecycle without a pointer.
- Step actions include add, read, edit, remove, and reorder. Started step history remains read-only.
- Brain and Goal launch surfaces must have a stable initial focus. Typing cannot appear inert after an asynchronous repaint.
- The Goal selection checkboxes and shared-selection bar can leave Work.
- Tangent can keep multi-Goal assignment data for brain dispatch and recovery.
- The far-right action control must work with both pointer and keyboard input.
- Work must not use an untracked browser toggle that disappears during a repaint.
- Changing a running Goal's harness, model, or effort must not require a new Goal.
- The replacement keeps the Goal, assignment, instructions, context, history, Documents, and working directory.
- The old agent remains alive until the replacement is ready. A failed replacement leaves the old agent untouched.

## Permissive Tangent commands

An Area path organizes work. It is not an authorization boundary.

Julian found a concrete failure in `neara/essential/autodesign`. The parent brain could read the child Goal but could not start it.

The server rejected the start as `wrong-area`. The inactive child brain also had no live session that could receive a message.

This behavior blocks ordinary coordination. It leaves known work idle when the responsible child brain is absent.

The command contract is now:

- Any Tangent session can coordinate work in any Area.
- Parent, child, sibling, and unrelated Area paths do not change command permission.
- Caller identity supplies audit information. It does not grant an Area capability.
- A missing or inactive target brain does not block Goal creation, queue edits, or worker starts.
- A message to a known Area remains durable when that Area brain has no live session.
- Tangent prevents stale writes, duplicate operations, and accidental live-owner replacement.
- Tangent does not reject an operation only because the caller is a brain, a worker, or belongs to another Area.
- Agent instructions still tell agents when Julian's words are required for a status change.
- The server records who acted and validates the requested state. It does not infer user intent from an Area path.
