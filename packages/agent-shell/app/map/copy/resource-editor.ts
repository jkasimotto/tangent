// The Add, Edit and Suggestion draft form, the unsaved-draft strip and the
// inventory controls above the list.

/** The kinds a draft can record. */
export type ResourceKind = "worktree" | "repository" | "link";

/** The words of the draft form. */
export const RESOURCE_EDITOR = {
  back: "← Back to resources",
  editTitle: "Edit resource",
  suggestionTitle: "Add suggestion to Area",
  kind: "Kind",
  kinds: { worktree: "Worktree", repository: "Repository", link: "Link" },
  urlLabel: "HTTP or HTTPS URL",
  pathLabel: "Absolute path",
  label: "Label (optional)",
  currentTarget: "Current target",
  newTarget: "New target",
  validated: "Exact target after validation: ",
  confirmMissing: " Add this path as Missing",
  save: "Save",
  saving: "Saving…",
  discardChanges: "Discard changes",
  unsavedDraft: "Unsaved resource draft",
  resume: "Resume",
  discard: "Discard",
  /** The heading of an Add draft: "Add worktree". */
  addTitle(kind: ResourceKind): string { return `Add ${kind}`; },
  /** The target field label by kind. */
  targetLabel(kind: ResourceKind): string { return kind === "link" ? this.urlLabel : this.pathLabel; },
} as const;

/** The controls above the inventory list. */
export const RESOURCE_CONTROLS = {
  filter: "Filter resources",
  filterPlaceholder: "Label, path, branch, host, or state",
  addWorktree: "Add Worktree",
  addRepository: "Add Repository",
  addLink: "Add Link",
  discover: "Discover worktrees",
  discovering: "Checking worktrees…",
  refresh: "Refresh status",
  refreshing: "Checking…",
  discoveryNote: "Discovery checks recorded repositories and the latest 20 Area attempts from 30 days. It never adds or places a Block.",
} as const;
