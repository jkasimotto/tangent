// The commands the Resources views call that neither the reads, the catalog mutations nor the
// scene mutations own: running one Block action from a row and opening the recovery it may need,
// moving the panel to another Area, and the small openings and closings of its views. Each takes
// the effects context first, like every other command in this directory, so a view stays a
// function of state and never dispatches an action itself.

import { runMapEntityAction } from "../../kernel/kernel-boundary.ts";
import type { MapEntityAction, MapEntityActionResult, MapEntityEffects, MapEntityFacts, ResourceLocator, ResourcePanelRow } from "../../kernel/kernel-types.ts";
import { RESOURCE_RECOVERY } from "../../copy.ts";
import type { RecoverableActionKind } from "../../copy.ts";
import type { AreaKey } from "../../units/ids.ts";
import { resourceEntityForRow } from "./resource-rows.ts";
import { loadResources, refreshResourceFacts } from "./resources-effects.ts";
import type { ResourceEffects } from "./resources-effects.ts";
import type { LegacyCandidateKey } from "./resources-state.ts";

/** One Block action the browser can refuse and the person can then finish by hand. */
type RecoverableAction = MapEntityAction & { readonly kind: RecoverableActionKind };

/** The action kinds that run in the browser rather than through the shell. */
const RECOVERABLE_KINDS: ReadonlySet<string> = new Set(["copy-path", "copy-url", "open-url"]);

/** True when the action is one this panel runs itself: a copy or an open. */
function isRecoverable(action: MapEntityAction | null | undefined): action is RecoverableAction {
  return Boolean(action) && RECOVERABLE_KINDS.has(action?.kind ?? "");
}

/** The words an open names its target by, empty for a copy. */
function targetLabelOf(action: RecoverableAction): string {
  return action.kind === "open-url" ? action.targetLabel : "";
}

/** The URL a blocked open was for, from the result the browser gave or the action itself. */
function blockedUrl(result: MapEntityActionResult, action: MapEntityAction): string {
  if (result.kind === "popup-blocked") return result.url;
  return action.kind === "open-url" || action.kind === "copy-url" ? action.url : "";
}

/**
 * Runs one row's Block action. A copy or an open that the browser refused opens the recovery
 * dialog with the exact text, so the person can finish it by hand; nothing else is a Map change.
 */
export async function runResourceAction(effects: ResourceEffects, facts: MapEntityFacts, action: MapEntityAction | null, browser: MapEntityEffects = {}): Promise<MapEntityActionResult> {
  if (!isRecoverable(action)) return { kind: "unavailable" };
  const result = await runMapEntityAction(action, browser);
  if (result.kind === "done") {
    const said = RESOURCE_RECOVERY.retried(action.kind, facts.display.label);
    if (said) effects.announce(said);
    return result;
  }
  const message = RESOURCE_RECOVERY.message(action.kind, facts.display.label, targetLabelOf(action));
  effects.dispatch({ type: "set-recovery", recovery: { result, entity: facts, action, message } });
  effects.announce(message);
  return result;
}

/** Runs the retained action again from inside its dialog. The dialog closes only once it went through. */
export async function retryResourceAction(effects: ResourceEffects, action: MapEntityAction | null = null, browser: MapEntityEffects = {}): Promise<MapEntityActionResult | null> {
  const recovery = effects.getState().recovery;
  const chosen = action ?? recovery?.action ?? null;
  if (!recovery || !isRecoverable(chosen)) return null;
  const result = await runMapEntityAction(chosen, browser);
  if (result.kind !== "done") {
    effects.dispatch({ type: "recovery-result", result });
    return result;
  }
  const said = RESOURCE_RECOVERY.retried(chosen.kind, recovery.entity.display.label);
  effects.dispatch({ type: "set-recovery", recovery: null });
  if (said) effects.announce(said);
  return result;
}

/** Copies the URL of a blocked open through the same selectable recovery surface. */
export function copyBlockedLink(effects: ResourceEffects, browser: MapEntityEffects = {}): Promise<MapEntityActionResult | null> {
  const recovery = effects.getState().recovery;
  const url = recovery ? blockedUrl(recovery.result, recovery.action) : "";
  if (!url) return Promise.resolve(null);
  const action: MapEntityAction = { kind: "copy-url", url };
  effects.dispatch({ type: "recovery-action", action, message: RESOURCE_RECOVERY.couldNotCopyLink });
  return retryResourceAction(effects, action, browser);
}

/** Closes the copy or open recovery dialog. Nothing about the Map changes. */
export function closeResourceRecovery(effects: ResourceEffects): void {
  effects.dispatch({ type: "set-recovery", recovery: null });
}

/** Closes the Add-back confirmation or the failed scene transaction without retrying it. */
export function closeSceneRecovery(effects: ResourceEffects): void {
  effects.dispatch({ type: "set-scene-recovery", recovery: null });
}

/** Closes one typed catalog recovery strip without discarding the draft it retained. */
export function closeMutationRecovery(effects: ResourceEffects): void {
  effects.dispatch({ type: "set-mutation-recovery", recovery: null });
}

/** Moves the open panel to one Area and reads that Area's inventory. */
export function viewResourceArea(effects: ResourceEffects, area: AreaKey): void {
  effects.dispatch({ type: "change-area", area });
  void loadResources(effects, area);
}

/** Reads the current Area's inventory again after a failed read. */
export function retryResourceLoad(effects: ResourceEffects): void {
  void loadResources(effects, effects.getState().area);
}

/** Reads current resources again and rebases the retained draft onto them, keeping the draft. */
export function reloadResourcesForDraft(effects: ResourceEffects): void {
  void loadResources(effects, effects.getState().area, { refreshObservations: false, rebaseDraft: true });
}

/** Checks one row's target again. */
export function refreshRowFacts(effects: ResourceEffects, row: ResourcePanelRow): void {
  const locator = resourceEntityForRow(row)?.locator;
  if (locator) void refreshResourceFacts(effects, [locator]);
}

/** Checks every listed row's target again. */
export function refreshAllRowFacts(effects: ResourceEffects, rows: readonly ResourcePanelRow[]): void {
  const locators = rows.map((row) => resourceEntityForRow(row)?.locator).filter((locator): locator is ResourceLocator => Boolean(locator));
  if (locators.length) void refreshResourceFacts(effects, locators);
}

/** Opens the details view of one resource. */
export function showResourceDetails(effects: ResourceEffects, locator: ResourceLocator): void {
  effects.dispatch({ type: "set-details", locator });
}

/** Returns from the details view to the inventory. */
export function closeResourceDetails(effects: ResourceEffects): void {
  effects.dispatch({ type: "set-details", locator: null });
}

/** Steps back from the draft form to the inventory, or resumes the retained draft. */
export function holdResourceDraft(effects: ResourceEffects, hidden: boolean): void {
  effects.dispatch({ type: "editor-hidden", hidden });
}

/** Throws the retained draft away. */
export function discardResourceDraft(effects: ResourceEffects): void {
  effects.dispatch({ type: "discard-editor" });
}

/** Records what the person typed in the inventory filter. */
export function filterResources(effects: ResourceEffects, value: string): void {
  effects.dispatch({ type: "set-filter", value });
}

/** Selects or clears one legacy review row for the next import. */
export function toggleLegacyCandidate(effects: ResourceEffects, key: LegacyCandidateKey, selected: boolean): void {
  effects.dispatch({ type: "toggle-legacy", key, selected });
}

/** The draft form's field edits, each one action of the closed union. */
export const RESOURCE_DRAFT_EDITS = {
  /** Records a chosen kind, which drops the inspection the previous kind produced. */
  kind(effects: ResourceEffects, kind: "worktree" | "repository" | "link"): void { effects.dispatch({ type: "editor-kind", kind }); },
  /** Records a typed target, which drops the inspection and the error of the previous one. */
  target(effects: ResourceEffects, value: string): void { effects.dispatch({ type: "editor-target", value }); },
  /** Records a typed label. */
  label(effects: ResourceEffects, value: string): void { effects.dispatch({ type: "editor-label", value }); },
  /** Records the confirmation that a missing path may be recorded as a future target. */
  confirmMissing(effects: ResourceEffects, confirmed: boolean): void { effects.dispatch({ type: "editor-confirm-missing", confirmed }); },
} as const;
