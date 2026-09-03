// The recovery dialogs: a failed copy or open, a failed scene transaction or
// an add-back confirmation, the inline catalog recovery strip, and the
// transaction veil.

/** The kinds of entity action that can need recovery. */
export type RecoverableActionKind = "copy-path" | "copy-url" | "open-url";

/** The dialog after a copy or open did not go through. Its message is also announced. */
export const RESOURCE_RECOVERY = {
  copyLink: "Copy link",
  exactLinkUrl: "Exact link URL",
  tryAgain: "Try again",
  retry: "Retry",
  close: "Close",
  couldNotCopyLink: "Could not copy link.",
  copiedLink: "Copied link.",
  /** The dialog heading by action. */
  title(kind: RecoverableActionKind, label: string, targetLabel: string): string {
    return kind === "copy-path" ? `Copy ${label} path` : kind === "copy-url" ? this.copyLink : `Open ${targetLabel}`;
  },
  /** The message by action; announced as well as shown. */
  message(kind: RecoverableActionKind, label: string, targetLabel: string): string {
    return kind === "open-url" ? `Could not open ${targetLabel}.` : kind === "copy-url" ? this.couldNotCopyLink : `Could not copy ${label} path.`;
  },
  /** The accessible name of the selectable text. */
  textName(kind: RecoverableActionKind, label: string): string { return kind === "copy-path" ? `Exact ${label} path` : this.exactLinkUrl; },
  /** Said after a retry that succeeded. Empty for an open, which needs no words. */
  retried(kind: RecoverableActionKind, label: string): string { return kind === "copy-path" ? `Copied ${label} path.` : kind === "copy-url" ? this.copiedLink : ""; },
} as const;

/** The dialog for a scene-coupled resource transaction. */
export const SCENE_RECOVERY = {
  notSaved: "Map resource was not saved",
  addBackExplanation: "This creates a new resource identity and reconnects the visible gone Block in place.",
  lastKnownTarget: "Exact Last-known target",
  confirmAddBack: "Confirm add back",
  retrySameOperation: "Retry same operation",
  close: "Close",
  /** "Add Removed checkout back to Area?" */
  addBackTitle(label: string): string { return `Add ${label} back to Area?`; },
  /** The label of a gone resource that lost its name. */
  resourceFallback(id: string): string { return `Resource ${id}`; },
} as const;

/** The inline strip after a catalog mutation failed. The next-step sentence comes from copyForFailure. */
export const MUTATION_RECOVERY = {
  openResource: "Open resource",
  showOnMap: "Show on Map",
  reloadResources: "Reload resources",
  reviewMissingPath: "Review missing path",
  closeError: "Close error",
  anotherArea: "another Area",
  /** The button that opens the owning Area's resources. */
  openAreaResources(areaName: string): string { return `Open ${areaName} resources`; },
  /** The button that picks one legacy Branch owner. */
  useChoice(field: string, label: string): string { return `Use ${field}: ${label}`; },
  /** The explanation for an inherited, read-only resource. */
  belongsTo(owner: string | null): string { return `It belongs to Area ${owner ?? this.anotherArea}. Open that Area's resources to change it.`; },
} as const;

/** The veil while catalog and Map source save together. */
export const TRANSACTION = {
  saving: "Map and Area resource authority are saving together.",
  undoing: "Undoing Map resource change…",
  addingBack: "Adding resource back to Area…",
  addingLink: "Adding Link to Area…",
  confirmingLastKnown: "Confirming Last-known resource target…",
} as const;
