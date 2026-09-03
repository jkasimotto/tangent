// The words of Map recovery: the offer to restore or discard a draft the controller kept after a
// failed save, and what is said after Retry, Reload saved or Keep mine. The old draft choice showed
// two buttons and no cause (audit defect 10); here the offer carries the failure's words from
// `copyForFailure`, so the person knows why the draft exists before choosing. This module is pure;
// `save-effects.ts` runs the controller and speaks these words.

import { DRAFT_CHOICE, RECOVERY_ANNOUNCEMENTS, copyForFailure } from "../../copy.ts";
import type { FailureCopy } from "../../copy.ts";
import type { DraftRecord, SaveResult, SaveStatus } from "../../kernel/kernel-types.ts";
import type { SaveAction } from "./save-status-model.ts";

/** The recovery dialog's words: its heading, why the draft exists, and its two choices. */
export type DraftOffer = {
  readonly heading: string;
  readonly cause: FailureCopy;
  readonly restore: string;
  readonly discard: string;
};

/** The failure kind a draft was written for: the server's code, else the state the refused save ended in. */
export function draftFailureKind(draft: DraftRecord): string {
  if (draft.failure.code) return draft.failure.code;
  return draft.failure.conflict ? "conflict" : "blocked";
}

/** The moment a draft was saved as hours and minutes in the reader's locale, or the raw value when it is not a date. */
export function draftTime(savedAt: string): string {
  const moment = new Date(savedAt);
  return Number.isNaN(moment.getTime()) ? savedAt : moment.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The offer for one waiting draft. The cause never prints the failure kind itself. */
export function draftOffer(draft: DraftRecord): DraftOffer {
  return {
    heading: DRAFT_CHOICE.title(draftTime(draft.savedAt)),
    cause: copyForFailure(draftFailureKind(draft)),
    restore: DRAFT_CHOICE.restore,
    discard: DRAFT_CHOICE.discard,
  };
}

/**
 * What is said after one recovery choice, from what the controller answered and where the save
 * stands now. Reload always reports the reload. Keep mine reports whether it was unavailable, kept
 * a local draft, hit another conflict, or saved. Retry says nothing here: the save state change
 * itself is announced. Null when there is nothing to say.
 */
export function recoveryOutcome(action: SaveAction, result: SaveResult | null, next: SaveStatus): string | null {
  if (action === "reload") return RECOVERY_ANNOUNCEMENTS.reloaded;
  if (action !== "keepMine") return null;
  if (result === null) return RECOVERY_ANNOUNCEMENTS.keepMineUnavailable;
  if (next === "blocked") return RECOVERY_ANNOUNCEMENTS.localDraftKept;
  if (next === "conflict") return RECOVERY_ANNOUNCEMENTS.keepMineConflict;
  if (next === "saved") return RECOVERY_ANNOUNCEMENTS.savedWithLocal;
  return null;
}

/** What is said when a recovery call threw: the headline, then the error's own words. */
export function recoveryFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return RECOVERY_ANNOUNCEMENTS.failed(message);
}
