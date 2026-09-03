# Agent Notes

Purpose: where the last save stands and the way out when it was refused. Design: `docs/design/area-map-rebuild/code.md`, "Surfaces" and "Copy"; selector rows in `docs/design/area-map-rebuild/selector-contract.md`, "Save" and "Recovery dialogs".

Files:

- `save-status-model.ts` decides, for the controller's `SaveStatus` and its draft, the six views the island shows (`saved`, `saving`, `dirty`, `blocked`, `conflict`, `recovery`), the class map.css colours by, the words, and the buttons. `saveStatusView(status, draft)` is the whole answer; `draftWaiting(draft)` says whether a draft still needs Restore or Discard.
- `SaveStatus.tsx` renders that answer as the `div.tangent-map-save.{status}` island, `role="status"` named "Map save status", with `Retry`, `Reload saved` and `Keep mine` as kit buttons reporting a `SaveAction` through `onRecover`.
- `recovery-model.ts` is the words of recovery: `draftOffer(draft)` (heading with the draft's time, cause from `copyForFailure`, the Restore and Discard labels), `recoveryOutcome(action, result, nextState)` and `recoveryFailure(error)` for what is said after a choice.
- `save-effects.ts` is the one effect: `recoverMap(controller, action, announce)` runs `retry`, `reload` or `keepMine` on the controller and announces the outcome. It never rejects.
- `RecoveryDialog.tsx` renders the draft offer through `ui/Dialog.tsx` as the registry's `sceneRecovery` surface, class `tangent-map-draft-choice`, with `onRestore` and `onDiscard` for the controller's `restoreDraft` and `discardDraft`.

Tests are `*.test.ts` beside each module: `node --test packages/agent-shell/app/map/surfaces/save/*.test.ts`.

Read next:
- `../AGENTS.md`
- `../../copy/save.ts`, `../../copy/recovery.ts`, `../../copy/announcements.ts`
