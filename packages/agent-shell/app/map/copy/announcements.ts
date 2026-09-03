// Every sentence the Map speaks through the live region. Grouped by what a
// person just did. A sentence that is also a dialog message lives with its
// dialog in recovery.ts and is spoken from there.

import type { Count, Index } from "../units/units.ts";

/** The save state words, spoken once each time the controller crosses into that state. */
export const SAVE_ANNOUNCEMENTS = {
  saving: "Saving map…",
  saved: "Map saved.",
  blocked: "Map not saved. Retry.",
  conflict: "Map not saved. Reload saved or keep mine.",
  dirty: "Map change queued.",
} as const;

/** The controller reason words, spoken once per action. */
export const REASON_ANNOUNCEMENTS = {
  "draft-found": "A saved recovery draft is available.",
  "draft-restored": "Recovery draft restored. Not saved.",
  "draft-discarded": "Recovery draft discarded.",
  "tree-reconciled": "Area hierarchy updated.",
  "tree-refresh-failed": "Area hierarchy update failed. The current map remains open.",
  "rebase-failed": "Recovery could not finish. The map is not saved.",
} as const;

/** Spoken after a recovery choice in the save pill. */
export const RECOVERY_ANNOUNCEMENTS = {
  keepMineUnavailable: "Keep mine is unavailable. Retry or reload saved.",
  localDraftKept: "Local draft kept. Retry or reload saved.",
  keepMineConflict: "Map not saved. Keep mine found another conflict.",
  savedWithLocal: "Map saved with local changes.",
  reloaded: "Saved map reloaded.",
  /** A recovery call that threw: the reason follows the headline. */
  failed(message: string): string { return `Map not saved. ${message}`; },
} as const;

/** Spoken by canvas commands: fold, view, Only, outlines, loading. */
export const CANVAS_ANNOUNCEMENTS = {
  outlinesCannotRotate: "Area outlines cannot rotate",
  outlinesFromTree: "Area outlines come from the Area tree",
  wholeMap: "Whole map",
  /** "Otto in view" after a fit. */
  inView(areaLeaf: string): string { return `${areaLeaf} in view`; },
  /** "Otto folded" or "Otto unfolded". */
  fold(areaLeaf: string, folded: boolean): string { return `${areaLeaf} ${folded ? "folded" : "unfolded"}`; },
  /** A fold refused because Only needs the Area open. */
  mustStayOpen(areaLeaf: string, restrictionLeaf: string): string { return `${areaLeaf} must stay open to show ${restrictionLeaf}`; },
  /** "Only Otto, 4 Areas hidden". */
  only(areaName: string, hidden: Count): string { return `Only ${areaName}, ${hidden} Areas hidden`; },
  /** A deferred Area started loading because content landed in it. */
  loading(areaLeaf: string): string { return `${areaLeaf} loading`; },
} as const;

/** Spoken by Find, not shown. */
export const FIND_ANNOUNCEMENTS = {
  noMatch: "No match",
  /** "3 matches, Otto in view" after typing; "1 match" when one. */
  matches(total: Count, name: string): string { return `${total} ${total === 1 ? "match" : "matches"}, ${name} in view`; },
  /** "3 matches, Otto in view" after previewing a row; always plural. */
  preview(total: Count, name: string): string { return `${total} matches, ${name} in view`; },
  /** "2 of 3, Otto in view" after stepping, from the zero-based position. */
  step(position: Index, total: Count, name: string): string { return `${position + 1} of ${total}, ${name} in view`; },
} as const;

/** Spoken by the picker. */
export const PICKER_ANNOUNCEMENTS = {
  vaultSearchUnavailable: "Vault search is unavailable; showing known Map entities",
} as const;

/** Spoken by the Resources panel and its actions. */
export const RESOURCE_ANNOUNCEMENTS = {
  placeOrCancelFirst: "Place or cancel the current resource Block first.",
  selectOneArea: "Select one Area before changing Map resources.",
  readOnlyUntilLoaded: "Map resources are read-only until the current catalog loads.",
  reloadBeforeAddBack: "Reload current Map resources before adding this Block back.",
  reloadBeforeRepresentation: "Reload current Map resources before changing their Map representation.",
  writesNotEnabled: "Map resource changes are not enabled in this workspace.",
  resourcesChanged: "Resources changed. Reload before you save.",
  missingPathConfirm: "The path is missing. Confirm that you want to record this future target.",
  notVisibleOnMap: "That resource is not currently visible on the Map.",
  hiddenNotRestored: "The hidden resource Block could not be restored.",
  placementUnavailable: "Placement is unavailable until the source Map loads.",
  previewNotGenerated: "The resource Block could not be generated for placement.",
  placementCancelled: "Resource placement cancelled.",
  statusRefreshed: "Resource status refreshed.",
  resourceFallback: "Resource",
  resourceWordFallback: "resource",
  updated: "Map resources updated.",
  resourceUpdated: "Map resource updated.",
  edited: "Resource updated.",
  added: "Resource added to Area.",
  removed: "Resource removed from Area.",
  undone: "Resource change undone.",
  linkAdded: "Link added to Area resources.",
  suggestionDismissed: "Suggestion dismissed.",
  legacyImported: "Legacy resource imported.",
  discoveryFinished: "Worktree discovery finished.",
  discoveryFinishedWithProblems: "Worktree discovery finished with some unavailable sources.",
  /** "Copied Main checkout path." */
  copiedPath(label: string): string { return `Copied ${label} path.`; },
  /** Spoken while a refresh runs for the selected Block. */
  checking(label: string): string { return `${label} status is Checking.`; },
  /** Spoken when the provider state of the selected link changed. */
  nowState(label: string, stateLabel: string): string { return `${label} is now ${stateLabel}.`; },
  /** A refresh that failed: the reason follows. */
  refreshFailed(message: string): string { return `Could not refresh resource status. ${message}`; },
  /** A catalog mutation that failed: the reason follows. */
  notSaved(message: string): string { return `Map resources were not saved. ${message}`; },
  /** A scene-coupled mutation that failed: the reason follows. */
  resourceNotSaved(message: string): string { return `Map resource was not saved. ${message}`; },
  /** A draft target the server refused: the reason follows. */
  targetNotAccepted(message: string): string { return `Resource target was not accepted. ${message}`; },
  /** Discovery that failed: the reason follows. */
  discoveryFailed(message: string): string { return `Could not discover worktrees. ${message}`; },
  /** "3 legacy resources imported." */
  legacyImportedCount(imported: Count): string { return `${imported} legacy ${imported === 1 ? "resource" : "resources"} imported.`; },
  /** "Removed checkout added back to Area resources." */
  addedBack(label: string): string { return `${label} added back to Area resources.`; },
  /** Spoken after Hide Block. */
  hid(label: string): string { return `Hid ${label} Block. The Area resource remains available.`; },
  /** Spoken after Show on Map. */
  shown(label: string): string { return `${label} shown on the Map. Escape returns to the prior view.`; },
  /** Spoken after Escape returns from Show on Map. */
  returned(label: string): string { return `Returned from ${label} on the Map.`; },
  /** Spoken after Restore on Map. */
  restored(label: string): string { return `Restored ${label} on the Map.`; },
  /** Spoken when placement commits. */
  placed(label: string): string { return `Placed ${label} on the Map.`; },
  /** Spoken when placement starts. */
  placing(label: string): string { return `Place ${label}: click or press Enter. Arrow keys move the preview. Escape cancels.`; },
  /** Spoken when a nested Area's Map must load before placement. */
  loadingThenPlacing(areaLeaf: string, label: string): string { return `Loading the ${areaLeaf} Map, then placing ${label}.`; },
  /** Spoken when that load failed. */
  loadFailedNoPlacement(areaLeaf: string): string { return `The ${areaLeaf} Map did not load. Placement is unavailable.`; },
} as const;
