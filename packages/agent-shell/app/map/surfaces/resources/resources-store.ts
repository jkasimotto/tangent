// The Resources panel reducer: (state, action) -> state, pure. It never fetches, never reads a
// clock, never mints an id and never mutates a collection; every map and set it returns is new.
// The effects in `resources-effects.ts` and the mutations in `resources-mutations.ts` dispatch
// here after the server answers. Each action is one named function below, so the switch reads
// as the list of what can happen to the panel.

import type { ResourceLocatorKey, ResourcePanelProjection, ResourceResolution, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import { RESOURCES_PANEL, RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import type { AreaKey } from "../../units/ids.ts";
import { count } from "../../units/units.ts";
import { legacyCandidateKey, resolutionKey, resourceEntityForRow, resourceResolutionForRow, resourceRowKey } from "./resource-rows.ts";
import type { ResourceDraft, ResourceMutationRecovery, ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";
import { draftCatalogExpectations, sameCatalogRevisions } from "./resources-draft.ts";
import { projectionErrorMessage } from "./resources-wire.ts";

export { INITIAL_RESOURCES_STATE } from "./resources-state.ts";

/** The recovery codes a fresh read clears, because the read is the reload they asked for. */
const RELOAD_CLEARS: ReadonlySet<string> = new Set(["catalog-revision-changed", "suggestion-changed"]);

/** The fields that reset when the panel moves to another Area. */
const AREA_RESET = {
  projection: null, discovery: null, mutationRecovery: null, legacySelected: new Set<string>(), legacyReviewHidden: false,
} as const;

/** Opens the panel on an Area. Moving to a different Area drops that Area's draft, rows and recovery. */
function open(state: ResourcesState, area: AreaKey): ResourcesState {
  const moved = state.area !== area ? { ...state, ...AREA_RESET, editor: null } : state;
  return { ...moved, area, open: true, details: null, filter: "" };
}

/** Moves the open panel to the Area that owns an inherited row or Suggestion. The draft is kept. */
function changeArea(state: ResourcesState, area: AreaKey): ResourcesState {
  return { ...state, ...AREA_RESET, area, details: null };
}

/** Marks a read in flight: the first read loads, later reads refresh. */
function loadStarted(state: ResourcesState): ResourcesState {
  return { ...state, transport: { state: state.transport.state === "idle" ? "loading" : "refreshing", error: "" } };
}

/** Records a failed read. Rows already shown stay as last known. */
function loadFailed(state: ResourcesState, message: string): ResourcesState {
  return { ...state, transport: { state: state.projection ? "last-known" : "unavailable", error: message } };
}

/** The resolutions map with every row of a projection filed under its locator key. */
function withRowResolutions(current: ReadonlyMap<ResourceLocatorKey, ResourceResolution>, projection: ResourcePanelProjection): ReadonlyMap<ResourceLocatorKey, ResourceResolution> {
  const next = new Map(current);
  for (const row of projection.rows) {
    const key = resourceRowKey(row);
    const resolution = resourceResolutionForRow(row);
    if (key && resolution) next.set(key, resolution);
  }
  return next;
}

/** Installs validated read facts. An unavailable read keeps the rows it had as last known. */
function installProjection(state: ResourcesState, projection: ResourcePanelProjection, area: AreaKey | null): ResourcesState {
  const target = area ?? state.area;
  if (projection.state === "unavailable") {
    const retained = target === state.area && Boolean(state.projection?.rows.length);
    const error = projectionErrorMessage(projection.error, RESOURCES_PANEL.didNotLoad);
    return { ...state, area: target, projection: retained ? state.projection : projection, transport: { state: retained ? "last-known" : "unavailable", error } };
  }
  const legacyKeys = new Set(projection.legacyReview.map(legacyCandidateKey));
  return {
    ...state,
    area: target,
    projection,
    transport: { state: projection.state, error: "" },
    legacySelected: new Set([...state.legacySelected].filter((key) => legacyKeys.has(key))),
    resolutions: withRowResolutions(state.resolutions, projection),
  };
}

/** The draft moved onto the rows of a fresh projection: an edit follows its row, an add follows the Area. */
function remapDraft(draft: ResourceDraft, projection: ResourcePanelProjection, area: AreaKey): ResourceDraft {
  if (draft.mode === "edit") {
    const id = resourceEntityForRow(draft.row)?.locator.id;
    const matches = id ? projection.rows.filter((row) => resourceEntityForRow(row)?.locator.id === id) : [];
    const match = matches[0];
    return matches.length === 1 && match ? { ...draft, row: match } : draft;
  }
  return draft.mode === "add" && draft.owner !== area ? { ...draft, owner: area } : draft;
}

/** The recovery strip a stale draft shows: the catalog changed, reload before you save. */
function staleDraftRecovery(draft: ResourceDraft, projection: ResourcePanelProjection): ResourceMutationRecovery {
  return {
    code: "catalog-revision-changed",
    recovery: { code: "catalog-revision-changed", projection },
    mutation: null,
    operationId: draft.operationId,
    success: RESOURCE_ANNOUNCEMENTS.updated,
    request: null,
    message: RESOURCE_ANNOUNCEMENTS.resourcesChanged,
  };
}

/** Clears a reload-shaped recovery once a read landed. */
function clearReloadRecovery(state: ResourcesState): ResourcesState {
  return state.mutationRecovery && RELOAD_CLEARS.has(state.mutationRecovery.code) ? { ...state, mutationRecovery: null } : state;
}

/**
 * Moves the retained draft onto a fresh projection. A reload rebases it onto the new catalog
 * revisions. Otherwise a draft whose row or catalog changed turns stale and shows the reload strip.
 */
function reconcileEditor(state: ResourcesState, projection: ResourcePanelProjection, area: AreaKey, rebaseDraft: boolean): ResourcesState {
  const cleared = clearReloadRecovery(state);
  const current = cleared.editor;
  if (!current) return cleared;
  const remapped = remapDraft(current, projection, area);
  const expectations = draftCatalogExpectations(remapped, projection);
  if (rebaseDraft) return { ...cleared, editor: { ...remapped, expectedCatalogs: expectations, stale: false, error: "" } };
  const locatorChanged = resourceRowKey(current.row) !== resourceRowKey(remapped.row);
  if (!locatorChanged && sameCatalogRevisions(current.expectedCatalogs, expectations)) return cleared;
  return { ...cleared, editor: { ...remapped, stale: true, error: RESOURCE_ANNOUNCEMENTS.resourcesChanged }, mutationRecovery: staleDraftRecovery(current, projection) };
}

/** Replaces the resolutions a scene resolve answered, dropping the keys the previous resolve owned. */
function installResolutions(state: ResourcesState, resolutions: readonly ResourceResolution[], dropKeys: readonly ResourceLocatorKey[]): ResourcesState {
  const next = new Map(state.resolutions);
  for (const key of dropKeys) next.delete(key);
  for (const resolution of resolutions) {
    const key = resolutionKey(resolution);
    if (key) next.set(key, resolution);
  }
  return { ...state, resolutions: next };
}

/** Marks rows as checking and shows their Checking resolutions. */
function refreshStarted(state: ResourcesState, keys: readonly ResourceLocatorKey[], checking: readonly ResourceResolution[]): ResourcesState {
  const started = installResolutions(state, checking, []);
  return { ...started, refreshing: new Set([...state.refreshing, ...keys]) };
}

/** Clears the checking marks and installs what the refresh answered, or what it had before on failure. */
function refreshFinished(state: ResourcesState, keys: readonly ResourceLocatorKey[], resolutions: readonly ResourceResolution[]): ResourcesState {
  const finished = installResolutions(state, resolutions, []);
  return { ...finished, refreshing: new Set([...state.refreshing].filter((key) => !keys.includes(key))) };
}

/** Applies one change to the draft, or nothing when there is no draft. */
function editDraft(state: ResourcesState, change: (draft: ResourceDraft) => ResourceDraft): ResourcesState {
  return state.editor ? { ...state, editor: change(state.editor) } : state;
}

/** Records a refused save on the draft. A missing-target refusal also carries the inspection to confirm. */
function editorFailed(state: ResourcesState, message: string, operationId: ResourceDraft["operationId"] | null, inspection: ResourceDraft["inspection"]): ResourcesState {
  return editDraft(state, (draft) => ({
    ...draft,
    error: message,
    operationId: operationId ?? draft.operationId,
    ...(inspection ? { inspection, confirmMissing: false } : {}),
  }));
}

/** Toggles one legacy review row's selection. */
function toggleLegacy(state: ResourcesState, key: string, selected: boolean): ResourcesState {
  const next = new Set(state.legacySelected);
  if (selected) next.add(key);
  else next.delete(key);
  return { ...state, legacySelected: next };
}

/** Replaces the Suggestions of the current projection, as discovery does when it answers without a projection. */
function setSuggestions(state: ResourcesState, suggestions: readonly ResourceSuggestion[]): ResourcesState {
  return state.projection ? { ...state, projection: { ...state.projection, suggestions: [...suggestions] } } : state;
}

/** The pure reducer over the Resources panel. */
export function resourcesReducer(state: ResourcesState, action: ResourcesAction): ResourcesState {
  switch (action.type) {
    case "open": return open(state, action.area);
    case "close": return { ...state, open: false, details: null };
    case "change-area": return changeArea(state, action.area);
    case "set-filter": return { ...state, filter: action.value };
    case "set-details": return { ...state, details: action.locator };
    case "set-narrow": return { ...state, narrow: action.narrow };
    case "cadence-tick": return { ...state, cadence: count(state.cadence + 1) };
    case "request-focus": return { ...state, pendingFocus: action.focus };
    case "load-started": return loadStarted(state);
    case "load-failed": return loadFailed(state, action.message);
    case "install-projection": return installProjection(state, action.projection, action.area);
    case "reconcile-editor": return reconcileEditor(state, action.projection, action.area, action.rebaseDraft);
    case "set-suggestions": return setSuggestions(state, action.suggestions);
    case "install-resolutions": return installResolutions(state, action.resolutions, action.dropKeys);
    case "refresh-started": return refreshStarted(state, action.keys, action.checking);
    case "refresh-finished": return refreshFinished(state, action.keys, action.resolutions);
    case "open-editor": return { ...state, editor: action.draft, details: null };
    case "discard-editor": return { ...state, editor: null };
    case "editor-hidden": return editDraft(state, (draft) => ({ ...draft, hidden: action.hidden }));
    case "editor-kind": return editDraft(state, (draft) => ({ ...draft, kind: action.kind, inspection: null, confirmMissing: false }));
    case "editor-target": return editDraft(state, (draft) => ({ ...draft, target: action.value, inspection: null, confirmMissing: false, error: "" }));
    case "editor-label": return editDraft(state, (draft) => ({ ...draft, label: action.value, error: "" }));
    case "editor-confirm-missing": return editDraft(state, (draft) => ({ ...draft, confirmMissing: action.confirmed }));
    case "editor-inspected": return editDraft(state, (draft) => ({ ...draft, inspection: action.inspection, error: action.message }));
    case "editor-failed": return editorFailed(state, action.message, action.operationId, action.inspection);
    case "set-busy": return { ...state, busy: action.busy };
    case "set-undo": return { ...state, undo: action.undo };
    case "set-mutation-recovery": return { ...state, mutationRecovery: action.recovery };
    case "set-discovery": return { ...state, discovery: action.discovery };
    case "set-scene-busy": return { ...state, sceneBusy: action.busy };
    case "set-scene-recovery": return { ...state, sceneRecovery: action.recovery };
    case "toggle-legacy": return toggleLegacy(state, action.key, action.selected);
    case "clear-legacy-selection": return { ...state, legacySelected: new Set() };
    case "legacy-review-hidden": return { ...state, legacyReviewHidden: action.hidden };
    case "set-recovery": return { ...state, recovery: action.recovery };
    case "recovery-result": return state.recovery ? { ...state, recovery: { ...state.recovery, result: action.result } } : state;
    case "recovery-action": return state.recovery ? { ...state, recovery: { ...state.recovery, action: action.action, message: action.message } } : state;
  }
}
