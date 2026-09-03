// Catalog mutations of the Resources panel: add, edit, remove, Suggestions, legacy import and
// their undo and retry. Each is one revision-fenced command with one stable operation id, so a
// retry after an interruption resends the same envelope and the server can replay its receipt.
// Scene-coupled mutations, which rewrite a Map source too, live in `resources-scene-mutations.ts`.

import type { ResourceCatalogRevision, ResourcePanelRow, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import { INTERNAL_ERRORS, RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import type { OperationId, ShardOwner } from "../../units/ids.ts";
import { count } from "../../units/units.ts";
import { legacyCandidateKey, resourceEntityForRow } from "./resource-rows.ts";
import { draftMutation, newResourceDraft } from "./resources-draft.ts";
import type { ResourceDraftRequest } from "./resources-draft.ts";
import { cancelResourcePanelLoad, inspectResourceDraft, installResourceProjection, refreshResourceFacts, requestResource } from "./resources-effects.ts";
import type { ResourceEffects } from "./resources-effects.ts";
import { resourceWritesAvailable } from "./resources-state.ts";
import type { ResourceMutationRecovery } from "./resources-state.ts";
import { catalogFencesFor, readResourceFailure, resourceMutationOwners, suggestionReference } from "./resources-wire.ts";
import type { ResourceMutation, ResourceMutationRequest, ResourceMutationResult } from "./resources-wire.ts";

/** How one catalog mutation is applied: its id and words, the fence it sends, or the retained envelope it resends. */
export type ApplyMutationOptions = {
  readonly operationId?: OperationId;
  readonly success?: string;
  readonly expectedCatalogs?: readonly ResourceCatalogRevision[] | null;
  readonly request?: ResourceMutationRequest | null;
};

/** The mutation kinds whose answer names a resource whose facts are refreshed at once. */
const REFRESH_AFTER: ReadonlySet<ResourceMutation["kind"]> = new Set(["add", "edit", "add-suggestion", "import-legacy"]);

/** True when the panel holds current read facts, the only state a mutation may be sent from. */
function catalogIsCurrent(effects: ResourceEffects): boolean {
  const state = effects.getState();
  return state.projection?.state === "current" && state.transport.state === "current";
}

/** Builds the envelope of a fresh mutation. An undo carries no fence. */
function mutationRequest(effects: ResourceEffects, mutation: ResourceMutation, operationId: OperationId, expectedCatalogs: readonly ResourceCatalogRevision[] | null | undefined): ResourceMutationRequest | null {
  const state = effects.getState();
  if (!state.area) return null;
  const base = { schema: "area-map-resource-mutation.v1" as const, operationId, viewedFrom: state.area, mutation };
  if (mutation.kind === "undo") return base;
  const fences = expectedCatalogs ? expectedCatalogs.map((catalog) => ({ ...catalog })) : catalogFencesFor(state.projection?.catalogs, resourceMutationOwners(mutation));
  return { ...base, expectedCatalogs: fences };
}

/** Installs what an accepted mutation answered: its projection, its undo, and a refresh of the resource it named. */
function acceptMutation(effects: ResourceEffects, mutation: ResourceMutation, result: ResourceMutationResult, success: string): void {
  const area = effects.getState().area;
  cancelResourcePanelLoad(effects);
  if (result.projection) installResourceProjection(effects, result.projection, area);
  const undo = result.undo?.state === "available" && area
    ? { token: result.undo.token, owner: area, sourceCoupled: Boolean(result.sourceUpdates?.length), operationId: effects.mintOperationId() }
    : null;
  effects.dispatch({ type: "set-undo", undo });
  effects.dispatch({ type: "set-mutation-recovery", recovery: null });
  const locator = result.resource?.locator;
  if (locator && REFRESH_AFTER.has(mutation.kind)) void refreshResourceFacts(effects, [locator], { quiet: true });
  effects.announce(success);
}

/** Records a refused mutation: the projection it carried, the draft's error, the recovery strip, and the words. */
function refuseMutation(effects: ResourceEffects, error: unknown, retained: Omit<ResourceMutationRecovery, "code" | "recovery" | "message">): void {
  const failure = readResourceFailure(error, INTERNAL_ERRORS.notSaved);
  if (failure.projection) {
    cancelResourcePanelLoad(effects);
    installResourceProjection(effects, failure.projection, effects.getState().area);
  }
  const inspection = failure.code === "missing-target-confirmation-required" ? failure.recovery.inspection ?? null : null;
  effects.dispatch({ type: "editor-failed", message: failure.message, operationId: retained.operationId, inspection });
  effects.dispatch({ type: "set-mutation-recovery", recovery: { ...retained, code: failure.code ?? "resource-mutation-failed", recovery: failure.recovery, message: failure.message } });
  effects.announce(RESOURCE_ANNOUNCEMENTS.notSaved(failure.message));
}

/** Applies one revision-fenced catalog command with one stable operation id. Returns the answer, or null when refused. */
export async function applyResourceMutation(effects: ResourceEffects, mutation: ResourceMutation, options: ApplyMutationOptions = {}): Promise<ResourceMutationResult | null> {
  if (!catalogIsCurrent(effects)) { effects.announce(RESOURCE_ANNOUNCEMENTS.readOnlyUntilLoaded); return null; }
  const operationId = options.operationId ?? effects.mintOperationId();
  const success = options.success ?? RESOURCE_ANNOUNCEMENTS.updated;
  const request = options.request ? structuredClone(options.request) : mutationRequest(effects, mutation, operationId, options.expectedCatalogs);
  if (!request) return null;
  effects.dispatch({ type: "set-mutation-recovery", recovery: null });
  effects.dispatch({ type: "set-busy", busy: mutation.kind });
  try {
    const result = (await requestResource(effects, "/api/areas/map-resources/apply", request)) as ResourceMutationResult;
    acceptMutation(effects, mutation, result, success);
    return result;
  } catch (error) {
    refuseMutation(effects, error, { mutation, operationId, success, request });
    return null;
  } finally {
    effects.dispatch({ type: "set-busy", busy: null });
  }
}

/** Retries one unchanged catalog envelope after an interruption with unknown commit outcome. */
export function retryResourceMutationRecovery(effects: ResourceEffects): Promise<ResourceMutationResult | null> {
  const retained = effects.getState().mutationRecovery;
  if (!retained?.mutation || !retained.request) return Promise.resolve(null);
  return applyResourceMutation(effects, retained.mutation, retained);
}

/** Applies one explicit legacy Branch owner choice as a new reviewed intent. */
export function chooseLegacyBranch(effects: ResourceEffects, choice: { readonly owner: ShardOwner; readonly targetFingerprint?: string | undefined }): boolean {
  const retained = effects.getState().mutationRecovery;
  if (retained?.mutation?.kind !== "import-legacy") return false;
  const selections = retained.mutation.selections.map((selection) => ({
    ...selection,
    attachDeclaredBranch: selection.candidate.owner === choice.owner && selection.candidate.targetFingerprint === choice.targetFingerprint,
  }));
  effects.dispatch({ type: "set-mutation-recovery", recovery: null });
  void applyResourceMutation(effects, { ...retained.mutation, selections }, { success: retained.success });
  return true;
}

/** Imports every selected legacy row as one atomic multi-owner mutation. */
export async function importSelectedLegacy(effects: ResourceEffects): Promise<ResourceMutationResult | null> {
  const state = effects.getState();
  const candidates = (state.projection?.legacyReview ?? []).filter((candidate) => candidate.state === "candidate" && state.legacySelected.has(legacyCandidateKey(candidate)));
  if (!candidates.length || !resourceWritesAvailable(state, effects.writesEnabled())) return null;
  const selections = candidates.map((candidate) => ({ candidate: suggestionReference(candidate), attachDeclaredBranch: Boolean(candidate.declaredBranch) }));
  const result = await applyResourceMutation(effects, { kind: "import-legacy", selections }, { success: RESOURCE_ANNOUNCEMENTS.legacyImportedCount(count(candidates.length)) });
  if (result) {
    effects.dispatch({ type: "clear-legacy-selection" });
    effects.dispatch({ type: "legacy-review-hidden", hidden: false });
  }
  return result;
}

/** Opens an Add, Edit or Suggestion draft without changing current facts. Refused while the catalog is not current. */
export function editResource(effects: ResourceEffects, request: ResourceDraftRequest = {}): boolean {
  const state = effects.getState();
  if (!resourceWritesAvailable(state, effects.writesEnabled())) { effects.announce(RESOURCE_ANNOUNCEMENTS.readOnlyUntilLoaded); return false; }
  effects.dispatch({ type: "open-editor", draft: newResourceDraft(request, state.area, effects.mintOperationId(), state.projection) });
  return true;
}

/** Inspects, confirms and saves the retained draft. The draft closes on success and keeps its words on refusal. */
export async function saveResourceDraft(effects: ResourceEffects): Promise<ResourceMutationResult | null> {
  const input = await inspectResourceDraft(effects);
  const draft = effects.getState().editor;
  if (!input || !draft) return null;
  const mutation = draftMutation(draft, input, effects.getState().area);
  if (!mutation) return null;
  const success = draft.mode === "edit" ? RESOURCE_ANNOUNCEMENTS.edited : RESOURCE_ANNOUNCEMENTS.added;
  const result = await applyResourceMutation(effects, mutation, { operationId: draft.operationId, expectedCatalogs: draft.expectedCatalogs, success });
  if (result) effects.dispatch({ type: "discard-editor" });
  return result;
}

/** Removes one direct row's resource from its Area. The Block, if it is on the Map, is untouched. */
export function removeResource(effects: ResourceEffects, row: ResourcePanelRow): Promise<ResourceMutationResult | null> {
  const locator = resourceEntityForRow(row)?.locator;
  if (!locator || !resourceWritesAvailable(effects.getState(), effects.writesEnabled())) {
    effects.announce(RESOURCE_ANNOUNCEMENTS.readOnlyUntilLoaded);
    return Promise.resolve(null);
  }
  return applyResourceMutation(effects, { kind: "remove", resource: locator }, { success: RESOURCE_ANNOUNCEMENTS.removed });
}

/** Dismisses one Suggestion in the Area that owns it, so the server accepts the write. */
export function dismissSuggestion(effects: ResourceEffects, suggestion: ResourceSuggestion): Promise<ResourceMutationResult | null> {
  if (!resourceWritesAvailable(effects.getState(), effects.writesEnabled())) {
    effects.announce(RESOURCE_ANNOUNCEMENTS.readOnlyUntilLoaded);
    return Promise.resolve(null);
  }
  return applyResourceMutation(effects, { kind: "dismiss-suggestion", suggestion: suggestionReference(suggestion) }, { success: RESOURCE_ANNOUNCEMENTS.suggestionDismissed });
}

/** Opens the details of the duplicate resource a refused add named. */
export function openRecoveryResource(effects: ResourceEffects): boolean {
  const locator = effects.getState().mutationRecovery?.recovery.existing;
  if (!locator) return false;
  effects.dispatch({ type: "set-details", locator });
  effects.dispatch({ type: "set-mutation-recovery", recovery: null });
  return true;
}

/** The Area that owns the resource or Suggestion one refused mutation tried to write. */
export function recoveryOwner(recovery: ResourceMutationRecovery | null): ShardOwner | null {
  if (!recovery) return null;
  return recovery.recovery.owner ?? resourceMutationOwners(recovery.mutation)[0] ?? null;
}
