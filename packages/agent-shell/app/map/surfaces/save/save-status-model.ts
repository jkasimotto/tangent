// What the save status island shows for each save state the controller publishes. The controller
// knows five states (`SaveStatus`); the island shows six, because a clean map with a recovery
// draft still waiting reads "Saved · Recovery available". This module is the one place the words,
// the class and the buttons of each state are decided, so `SaveStatus.tsx` only renders the answer.

import { SAVE } from "../../copy.ts";
import type { DraftRecord, SaveStatus } from "../../kernel/kernel-types.ts";

/** The six states the island shows: the controller's five, plus a clean map with a draft waiting. */
export type SaveView = SaveStatus | "recovery";

/** The three ways out of a refused save. Each is a controller method of the same name. */
export type SaveAction = "retry" | "reload" | "keepMine";

/** One button of the island: which controller method it runs and what it says. */
export type SaveActionButton = { readonly action: SaveAction; readonly label: string };

/** Everything the island renders for one state. */
export type SaveStatusView = {
  readonly view: SaveView;
  /** The class the suites and map.css select by: `tangent-map-save` plus the controller's state name. */
  readonly className: string;
  /** The words before the buttons. Reads exactly "Saved" when the map is clean. */
  readonly text: string;
  readonly buttons: readonly SaveActionButton[];
};

const CLASS_NAME = "tangent-map-save";

const RETRY: SaveActionButton = { action: "retry", label: SAVE.retry };
const RELOAD: SaveActionButton = { action: "reload", label: SAVE.reloadSaved };
const KEEP_MINE: SaveActionButton = { action: "keepMine", label: SAVE.keepMine };

/** True while a recovery draft waits for Restore or Discard. */
export function draftWaiting(draft: DraftRecord | null): boolean {
  return draft !== null && !draft.restored;
}

/** The state the island shows: the controller's state, unless the map is clean and a draft waits. */
export function saveView(status: SaveStatus, draft: DraftRecord | null): SaveView {
  return status === "saved" && draftWaiting(draft) ? "recovery" : status;
}

/** The words of one view. */
function saveText(view: SaveView): string {
  switch (view) {
    case "saving": return SAVE.saving;
    case "dirty": return SAVE.pending;
    case "blocked": return SAVE.notSaved;
    case "conflict": return SAVE.notSaved;
    case "recovery": return SAVE.savedWithRecovery;
    case "saved": return SAVE.saved;
  }
}

/** The buttons of one view: a blocked save can be retried, a conflict cannot; both offer Reload saved and Keep mine. */
function saveButtons(view: SaveView): readonly SaveActionButton[] {
  if (view === "blocked") return [RETRY, RELOAD, KEEP_MINE];
  if (view === "conflict") return [RELOAD, KEEP_MINE];
  return [];
}

/** Everything the island renders for the controller's save state and draft. */
export function saveStatusView(status: SaveStatus, draft: DraftRecord | null): SaveStatusView {
  const view = saveView(status, draft);
  return { view, className: `${CLASS_NAME} ${status}`, text: saveText(view), buttons: saveButtons(view) };
}
