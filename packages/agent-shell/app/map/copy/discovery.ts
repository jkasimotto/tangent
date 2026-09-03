// Worktree discovery results, Suggestions and the legacy review list.

import type { Index } from "../units/units.ts";

/** The words of the discovery results. */
export const DISCOVERY = {
  name: "Worktree discovery results",
  title: "Discovery sources",
  checking: "Checking recorded repositories and recent Attempt folders…",
  noSources: "Add a repository or run a Goal from a folder first.",
  checked: "Checked",
  checkedWithProblems: "Checked with problems",
  couldNotInspect: "Could not inspect",
  copyRepositoryPath: "Copy repository path",
  retry: "Retry discovery",
  /** The label of a source that came from one Goal. */
  goalSource(slug: string): string { return `Goal ${slug}`; },
  /** The label of a source with no name, by its zero-based position. */
  numberedSource(position: Index): string { return `Discovery source ${position + 1}`; },
} as const;

/** The Suggestions list under the inventory. */
export const SUGGESTIONS = {
  title: "Suggestions",
  addToArea: "Add to Area",
  dismiss: "Dismiss",
  /** The provenance line of a Suggestion owned by another Area. */
  from(owner: string): string { return `From ${owner}`; },
  /** The button that opens the owning Area to review an inherited Suggestion. */
  reviewIn(areaName: string): string { return `Review in ${areaName}`; },
  /** The accessible name of the review button. */
  reviewName(name: string, owner: string): string { return `Review ${name} in ${owner}`; },
  /** The accessible name of the add button. */
  addName(name: string): string { return `Add ${name} to Area`; },
  /** The accessible name of the dismiss button. */
  dismissName(name: string): string { return `Dismiss ${name}`; },
} as const;

/** The legacy resources review list. */
export const LEGACY_REVIEW = {
  title: "Legacy resources to review",
  import: "Import",
  select: "Select for import",
} as const;
