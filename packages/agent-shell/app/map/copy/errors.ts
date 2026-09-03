// Failure kinds in plain words. The old component printed several codes as
// headlines (audit defect 11) and left Restore or Discard without a cause
// (defect 10). `copyForFailure` is the one place a code becomes words: a
// known kind gets its own sentence, an unknown kind falls back to the
// operation its first word names, and nothing ever prints the kind itself.

/** What a failure reads as: what happened, then what to do. */
export type FailureCopy = { readonly headline: string; readonly nextStep: string };

/** The messages thrown inside the Map itself, before any server answers. */
export const INTERNAL_ERRORS = {
  resourcesUnavailable: "Map resources are unavailable",
  saveBeforeResourceChange: "Save or recover the current Map change before changing this resource.",
  catalogNotLoaded: "Map resources are read-only until the current catalog loads.",
  sourceNotReady: "The owning Area Map source is not ready for this resource change.",
  noSourceUpdate: "The resource transaction returned no Map source update.",
  changeStartedMidInstall: "A Map change started before the resource source could be installed.",
  notSavedTogether: "The Area resource and Map source were not saved together.",
  notSaved: "Map resources were not saved.",
} as const;

const RETRY_SAME = "Retry the same operation from the recovery dialog.";
const RELOAD_RESOURCES = "Reload current resources without discarding this draft.";
const RELOAD_OR_KEEP = "Reload saved or keep mine.";
const OPEN_OWNER = "Open that Area's resources to change it.";

/** Every failure kind the Map or its server names, with its words. */
const KNOWN_FAILURES: ReadonlyMap<string, FailureCopy> = new Map<string, FailureCopy>([
  ["duplicate-resource-target", { headline: "That exact target already belongs to this Area.", nextStep: "Open the existing resource or show it on the Map." }],
  ["catalog-revision-changed", { headline: "Resources changed. Reload before you save.", nextStep: RELOAD_RESOURCES }],
  ["suggestion-changed", { headline: "Resources changed. Reload before you save.", nextStep: RELOAD_RESOURCES }],
  ["missing-target-confirmation-required", { headline: "The path is missing. Confirm that you want to record this future target.", nextStep: "Review and confirm the exact missing path before saving again." }],
  ["legacy-branch-choice-required", { headline: "More than one imported target could own the legacy Branch.", nextStep: "Choose the one imported target that owns the legacy Branch." }],
  ["inherited-resource-read-only", { headline: "This resource belongs to another Area.", nextStep: OPEN_OWNER }],
  ["area-resource-read-only", { headline: "This resource belongs to another Area.", nextStep: OPEN_OWNER }],
  ["resource-mutation-failed", { headline: INTERNAL_ERRORS.notSaved, nextStep: "The current draft and server recovery evidence are retained." }],
  ["resource-representation-conflict", { headline: INTERNAL_ERRORS.saveBeforeResourceChange, nextStep: "Wait for the Map to save, then retry the same operation." }],
  ["resource-catalog-unavailable", { headline: INTERNAL_ERRORS.catalogNotLoaded, nextStep: "Reload resources, then retry." }],
  ["resource-source-load-failed", { headline: INTERNAL_ERRORS.sourceNotReady, nextStep: "Wait for that Area's Map to load, then retry." }],
  ["resource-source-invalid", { headline: "The resource transaction returned an invalid Map source.", nextStep: "Retry the same operation. The Map keeps its saved source." }],
  ["resource-transaction-failed", { headline: INTERNAL_ERRORS.notSavedTogether, nextStep: "Retry the same operation, or close and check the resource list." }],
  ["resource-transaction-recovery", { headline: "The resource change was interrupted before its outcome was known.", nextStep: RETRY_SAME }],
  ["resource-not-found", { headline: "That resource no longer exists in this Area.", nextStep: "Reload resources." }],
  ["resource-unavailable", { headline: "The resource could not be read right now.", nextStep: "Retry, or check the target." }],
  ["resource-timeout", { headline: "Checking the resource took too long.", nextStep: "Refresh its status again later." }],
  ["discovery-unavailable", { headline: "Could not discover worktrees.", nextStep: "Retry discovery." }],
  ["operation-conflict", { headline: "Another change to these resources is still in progress.", nextStep: "Wait for it to finish, then retry." }],
  ["operation-id-reused", { headline: "This change was already sent.", nextStep: "Reload resources to see its outcome." }],
  ["operation-required", { headline: "The server needs the retained operation to continue.", nextStep: RETRY_SAME }],
  ["recovery-required", { headline: "The server needs the retained operation to continue.", nextStep: RETRY_SAME }],
  ["invalid-resource-request", { headline: "The server did not understand the resource change.", nextStep: "Reload resources and make the change again." }],
  ["invalid-resource-target", { headline: "The target is not a valid path or URL.", nextStep: "Correct the target and save again." }],
  ["invalid-worktree-path", { headline: "The path is not a usable worktree.", nextStep: "Choose a checkout folder, or change the kind to Repository." }],
  ["bare-worktree", { headline: "The path is a bare repository, not a worktree.", nextStep: "Change the kind to Repository, or choose a checkout folder." }],
  ["prunable-worktree", { headline: "The worktree is no longer registered with its repository.", nextStep: "Check the path exists, then refresh." }],
  ["repository-inspection-failed", { headline: "Could not inspect the recorded repository.", nextStep: "Check the path exists, then refresh." }],
  ["local-check-failed", { headline: "Could not check the path.", nextStep: "Check the path exists, then refresh." }],
  ["provider-unavailable", { headline: "The link's provider did not answer.", nextStep: "Refresh its status later. The last known facts are kept." }],
  ["catalog-load-failed", { headline: "Map resources did not load.", nextStep: "Retry. Last known resources stay visible." }],
  ["catalog-invalid", { headline: "The resource catalog could not be read.", nextStep: "Retry. Last known resources stay visible." }],
  ["area-not-found", { headline: "That Area no longer exists.", nextStep: "Reload the Map." }],
  ["tree-conflict", { headline: "Map not saved. The Area tree changed underneath it.", nextStep: RELOAD_OR_KEEP }],
  ["world-conflict", { headline: "Map not saved. Another save landed first.", nextStep: RELOAD_OR_KEEP }],
  ["world-race", { headline: "Map not saved. Another save landed first.", nextStep: RELOAD_OR_KEEP }],
  ["shard-conflict", { headline: "Map not saved. This Area's Map changed underneath it.", nextStep: RELOAD_OR_KEEP }],
  ["transaction-failed", { headline: "The change was not saved.", nextStep: "Retry." }],
  ["blocked", { headline: "Map not saved.", nextStep: "Retry, reload saved, or keep mine." }],
  ["conflict", { headline: "Map not saved. The saved map changed underneath it.", nextStep: RELOAD_OR_KEEP }],
  ["tree-refresh-failed", { headline: "Area hierarchy update failed. The current map remains open.", nextStep: "Reload the Map when you are ready." }],
  ["rebase-failed", { headline: "Recovery could not finish. The map is not saved.", nextStep: RELOAD_OR_KEEP }],
  ["last-known", { headline: "Could not refresh Map resources · Last known.", nextStep: "Retry." }],
  ["unavailable", { headline: "Map resources did not load.", nextStep: "Retry." }],
]);

/** The operation a kind's first word names, for kinds no table entry covers. */
const FAILURE_FAMILIES: ReadonlyMap<string, FailureCopy> = new Map<string, FailureCopy>([
  ["resource", { headline: "The resource change was not saved.", nextStep: RETRY_SAME }],
  ["catalog", { headline: "Map resources did not load.", nextStep: "Retry. Last known resources stay visible." }],
  ["discovery", { headline: "Could not discover worktrees.", nextStep: "Retry discovery." }],
  ["operation", { headline: "The change could not be applied.", nextStep: RETRY_SAME }],
  ["suggestion", { headline: "The Suggestion was not applied.", nextStep: "Reload resources and review it again." }],
  ["legacy", { headline: "The legacy resource was not imported.", nextStep: "Reload resources and review it again." }],
  ["tree", { headline: "Map not saved.", nextStep: RELOAD_OR_KEEP }],
  ["world", { headline: "Map not saved.", nextStep: RELOAD_OR_KEEP }],
  ["shard", { headline: "Map not saved.", nextStep: RELOAD_OR_KEEP }],
  ["save", { headline: "Map not saved.", nextStep: RELOAD_OR_KEEP }],
  ["link", { headline: "The link's status could not be checked.", nextStep: "Refresh its status later. The last known facts are kept." }],
  ["provider", { headline: "The link's status could not be checked.", nextStep: "Refresh its status later. The last known facts are kept." }],
  ["repository", { headline: "The path could not be checked.", nextStep: "Check the path exists, then refresh." }],
  ["worktree", { headline: "The path could not be checked.", nextStep: "Check the path exists, then refresh." }],
  ["local", { headline: "The path could not be checked.", nextStep: "Check the path exists, then refresh." }],
  ["path", { headline: "The path could not be checked.", nextStep: "Check the path exists, then refresh." }],
]);

/** The words when nothing else matches. */
const DEFAULT_FAILURE: FailureCopy = { headline: "The Map could not finish that change.", nextStep: "Retry. Nothing was saved." };

/** Maps one failure kind to a headline and a next step, never printing the kind. */
export function copyForFailure(kind: string): FailureCopy {
  const known = KNOWN_FAILURES.get(kind);
  if (known) return known;
  const family = FAILURE_FAMILIES.get(kind.split("-")[0] ?? "");
  return family ?? DEFAULT_FAILURE;
}

/** Every kind the table names, so a test can walk them. */
export function knownFailureKinds(): readonly string[] {
  return [...KNOWN_FAILURES.keys()];
}
