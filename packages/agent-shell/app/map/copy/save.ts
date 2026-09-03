// The save status pill and the recovery-draft choice.

/** The words of the save status pill and its recovery buttons. */
export const SAVE = {
  statusName: "Map save status",
  saving: "Saving…",
  pending: "Pending save…",
  notSaved: "Not saved ",
  saved: "Saved",
  savedWithRecovery: "Saved · Recovery available",
  retry: "Retry",
  reloadSaved: "Reload saved",
  keepMine: "Keep mine",
} as const;

/** The draft-found choice shown when a recovery draft waits. */
export const DRAFT_CHOICE = {
  restore: "Restore",
  discard: "Discard",
  /** "Draft from 14:05", with the time already formatted by the caller. */
  title(time: string): string { return `Draft from ${time}`; },
} as const;
