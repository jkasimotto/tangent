// The one effect of the save island: running a recovery choice against the controller and
// announcing what came of it. The words come from `recovery-model.ts`; this file only awaits the
// controller. A thrown error becomes an announcement, never a rejection, so a button press cannot
// leave the island silent (audit defect 10).

import type { AreaMapController, SaveResult } from "../../kernel/kernel-types.ts";
import { recoveryFailure, recoveryOutcome } from "./recovery-model.ts";
import type { SaveAction } from "./save-status-model.ts";

/** Speaks one sentence through the live region. `MapRoot.tsx` binds it to the announce store. */
export type Announce = (text: string) => void;

/** Runs the controller method one save action names. Reload answers a World, which the island has no words for, so it reports null. */
async function runSaveAction(controller: AreaMapController, action: SaveAction): Promise<SaveResult | null> {
  switch (action) {
    case "retry":
      return controller.retry();
    case "keepMine":
      return controller.keepMine();
    case "reload":
      await controller.reload();
      return null;
  }
}

/** Runs one visible recovery choice and announces its truthful outcome. Answers what the controller answered, or null when the call threw. */
export async function recoverMap(controller: AreaMapController, action: SaveAction, announce: Announce): Promise<SaveResult | null> {
  try {
    const result = await runSaveAction(controller, action);
    const outcome = recoveryOutcome(action, result, controller.snapshot().save.state);
    if (outcome !== null) announce(outcome);
    return result;
  } catch (error) {
    announce(recoveryFailure(error));
    return null;
  }
}
