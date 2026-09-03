// The effects of the Resources panel: every request that reads facts, and the cadence that
// re-reads them. Each function takes the effects context first: the request function, the
// dispatcher, the state reader, the controller port, the announcer, the id minter and the
// scheduler, all injected so a test runs them against fakes and the reducer stays pure. The
// in-flight fences the old component kept in refs live in the context beside the request function.

import { selectedMapEntityElement, tangentOf } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, ResourceLocator, ResourceLocatorKey, ResourcePanelProjection, ResourceResolution, SceneElement, ShardHash } from "../../kernel/kernel-types.ts";
import { INTERNAL_ERRORS, RESOURCE_ANNOUNCEMENTS } from "../../copy.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { resourceLocatorKey } from "../../kernel/kernel-boundary.ts";
import type { AreaKey, OperationId } from "../../units/ids.ts";
import type { Count, Milliseconds } from "../../units/units.ts";
import { count, milliseconds } from "../../units/units.ts";
import { checkingResourceResolution, providerLifecycleLabel, resolutionKey, resourceEntityForRow, resourceRowKey, resourceResolutionForRow } from "./resource-rows.ts";
import { draftInspectRequest, draftNeedsMissingConfirmation, targetInputFrom } from "./resources-draft.ts";
import type { ResourcesState } from "./resources-state.ts";
import type { ResourcesAction } from "./resources-store-actions.ts";
import { readResourceFailure } from "./resources-wire.ts";
import type { InspectedTarget, ResourceDiscovery, ResourceResolutionsResult, ResourceTargetInput } from "./resources-wire.ts";

/** The request options the shell's api client reads. */
export type ResourceRequestInit = {
  readonly method?: "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
};

/** The shell's loopback api client, as the mount options pass it. */
export type ResourceApi = (path: string, init?: ResourceRequestInit) => Promise<unknown>;

/** The scheduler the cadence runs on: returns the function that stops it. */
export type ResourceScheduler = { readonly every: (callback: () => void, interval: Milliseconds) => () => void };

/** The controller methods the effects call. */
export type ResourceControllerPort = Pick<AreaMapController, "setResourceResolutions" | "installResourceSourceUpdates" | "flush" | "snapshot" | "world">;

/** Everything the effects are given. `MapRoot.tsx` builds one of these once and keeps it. */
export type ResourceEffectDeps = {
  readonly api: ResourceApi | null;
  readonly dispatch: (action: ResourcesAction) => void;
  readonly getState: () => ResourcesState;
  readonly controller: ResourceControllerPort;
  /** Speaks one sentence through the announce store; `visible` also shows it as the toast. */
  readonly announce: (text: string, visible?: boolean) => void;
  readonly mintOperationId: () => OperationId;
  /** The workspace rollout flag for resource writes. */
  readonly writesEnabled: () => boolean;
  readonly scheduler: ResourceScheduler;
  /** Hides one composed Block through the Map's own hide command. */
  readonly hideBlock: (block: SceneElement) => void;
};

/** The in-flight fences of the panel read: the newest generation wins and older answers are dropped. */
export type PanelLoadFence = { generation: Count; request: AbortController | null };

/** The in-flight fences of the scene resolve: which Blocks it last resolved and whether their observations were refreshed. */
export type SceneResolveFence = { requestKey: string; observationKey: string; request: AbortController | null; mapKeys: ReadonlySet<ResourceLocatorKey> };

/** The context every effect takes first: the dependencies and the fences. */
export type ResourceEffects = ResourceEffectDeps & { readonly panelLoad: PanelLoadFence; readonly sceneResolve: SceneResolveFence };

/** Builds the effects context with fresh fences. */
export function createResourceEffects(deps: ResourceEffectDeps): ResourceEffects {
  return { ...deps, panelLoad: { generation: count(0), request: null }, sceneResolve: { requestKey: "", observationKey: "", request: null, mapKeys: new Set() } };
}

/** Sends one resource request through the shell's api client: a GET with no body, a JSON POST with one. */
export function requestResource(effects: ResourceEffects, path: string, body: unknown = null, signal?: AbortSignal): Promise<unknown> {
  if (!effects.api) return Promise.reject(new Error(INTERNAL_ERRORS.resourcesUnavailable));
  const abort = signal ? { signal } : {};
  if (body === null) return effects.api(path, signal ? { signal } : undefined);
  return effects.api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...abort });
}

/** The inventory route for one Area. */
function panelPath(area: AreaKey): string {
  return `/api/areas/map-resources?area=${encodeURIComponent(area)}`;
}

/** True when a value is a projection the panel may install. */
export function isInstallableProjection(value: unknown): value is ResourcePanelProjection {
  if (typeof value !== "object" || value === null) return false;
  const state = (value as { state?: unknown }).state;
  return state === "current" || state === "partial" || state === "unavailable";
}

/** Installs validated read facts into the store and the controller, leaving scene and view authority untouched. */
export function installResourceProjection(effects: ResourceEffects, projection: unknown, area: AreaKey | null = null): boolean {
  if (!isInstallableProjection(projection)) return false;
  effects.dispatch({ type: "install-projection", projection, area });
  if (projection.state === "unavailable") return true;
  const values = projection.rows.map(resourceResolutionForRow).filter((value): value is ResourceResolution => value !== null);
  effects.controller.setResourceResolutions(values);
  return true;
}

/** Invalidates any older inventory read before newer transaction evidence is installed. */
export function cancelResourcePanelLoad(effects: ResourceEffects): void {
  effects.panelLoad.generation = count(effects.panelLoad.generation + 1);
  effects.panelLoad.request?.abort();
  effects.panelLoad.request = null;
}

/** Options of one inventory read. */
export type LoadResourcesOptions = { readonly refreshObservations?: boolean; readonly rebaseDraft?: boolean };

/** The locators of every row of a projection. */
function projectionLocators(projection: ResourcePanelProjection): ResourceLocator[] {
  return projection.rows.map((row) => resourceEntityForRow(row)?.locator).filter((locator): locator is ResourceLocator => Boolean(locator));
}

/**
 * Reads the confirmed inventory of one Area without starting discovery. Only the newest read
 * lands; rows already shown stay as last known when it fails. The retained draft is moved onto
 * the fresh rows, rebased when the person asked for a reload.
 */
export async function loadResources(effects: ResourceEffects, area: AreaKey | null = effects.getState().area, options: LoadResourcesOptions = {}): Promise<ResourcePanelProjection | null> {
  if (!area) return null;
  cancelResourcePanelLoad(effects);
  const generation = effects.panelLoad.generation;
  const request = new AbortController();
  effects.panelLoad.request = request;
  effects.dispatch({ type: "load-started" });
  try {
    const result = await requestResource(effects, panelPath(area), null, request.signal);
    if (effects.panelLoad.generation !== generation || effects.panelLoad.request !== request || !isInstallableProjection(result)) return null;
    installResourceProjection(effects, result, area);
    effects.dispatch({ type: "reconcile-editor", projection: result, area, rebaseDraft: options.rebaseDraft ?? false });
    const locators = projectionLocators(result);
    if ((options.refreshObservations ?? true) && locators.length) void refreshResourceFacts(effects, locators, { quiet: true });
    return result;
  } catch (error) {
    const failure = readResourceFailure(error, INTERNAL_ERRORS.resourcesUnavailable);
    if (effects.panelLoad.generation !== generation || effects.panelLoad.request !== request || failure.aborted) return null;
    effects.dispatch({ type: "load-failed", message: failure.message });
    return null;
  } finally {
    if (effects.panelLoad.request === request) effects.panelLoad.request = null;
  }
}

/** Reads the resolutions out of a resolve or refresh answer, under either name the server uses. */
export function resolutionsOf(result: unknown): ResourceResolution[] {
  if (Array.isArray(result)) return result as ResourceResolution[];
  const answer = (result ?? {}) as Exclude<ResourceResolutionsResult, readonly unknown[]>;
  return [...(answer.resolutions ?? answer.results ?? [])];
}

/** The locator key of the one selected resource Block, or null when the selection is not one resource Block. */
function focusedResourceKey(effects: ResourceEffects): ResourceLocatorKey | null {
  const snapshot = effects.controller.snapshot();
  const focused = selectedMapEntityElement(snapshot.composition.scene.elements, snapshot.selection);
  const tangent = focused ? tangentOf(focused) : null;
  const owner = focused?.customData?.tangentWorld?.owner;
  if (tangent?.kind !== "resource" || !owner) return null;
  return resourceLocatorKey({ owner, id: tangent.ref as ResourceLocator["id"] });
}

/** The resolutions a refresh starts from: the cached one per key, else the row's own. */
function previousResolutions(state: ResourcesState, keys: readonly ResourceLocatorKey[]): Map<ResourceLocatorKey, ResourceResolution> {
  const previous = new Map<ResourceLocatorKey, ResourceResolution>();
  for (const key of keys) {
    const row = state.projection?.rows.find((candidate) => resourceRowKey(candidate) === key);
    const value = state.resolutions.get(key) ?? (row ? resourceResolutionForRow(row) : null);
    if (value) previous.set(key, value);
  }
  return previous;
}

/** Speaks the state change of the selected Block after a refresh, or the plain refreshed sentence when not quiet. */
function announceRefresh(effects: ResourceEffects, previous: ReadonlyMap<ResourceLocatorKey, ResourceResolution>, values: readonly ResourceResolution[], quiet: boolean): void {
  const focusedKey = focusedResourceKey(effects);
  const current = focusedKey ? values.find((value) => resolutionKey(value) === focusedKey) : undefined;
  const priorLabel = providerLifecycleLabel(focusedKey ? previous.get(focusedKey) : null);
  const nextLabel = providerLifecycleLabel(current);
  if (current?.value && priorLabel && nextLabel && priorLabel !== nextLabel) effects.announce(RESOURCE_ANNOUNCEMENTS.nowState(current.value.label, nextLabel));
  else if (!quiet) effects.announce(RESOURCE_ANNOUNCEMENTS.statusRefreshed);
}

/** Options of one facts refresh. */
export type RefreshOptions = { readonly quiet?: boolean };

/**
 * Refreshes system-owned observations of the named resources without entering Map history or save
 * state. Rows already checking are skipped; the rest show Checking until the server answers, and
 * keep their prior facts when it does not.
 */
export async function refreshResourceFacts(effects: ResourceEffects, locators: readonly ResourceLocator[], options: RefreshOptions = {}): Promise<unknown> {
  const state = effects.getState();
  const requested = locators.filter((locator) => {
    const key = resourceLocatorKey(locator);
    return key !== null && !state.refreshing.has(key);
  });
  if (!requested.length) return null;
  const keys = requested.map(resourceLocatorKey).filter((key): key is ResourceLocatorKey => key !== null);
  const previous = previousResolutions(state, keys);
  const checking = [...previous.values()].map(checkingResourceResolution);
  effects.dispatch({ type: "refresh-started", keys, checking });
  if (checking.length) {
    effects.controller.setResourceResolutions(checking);
    const focusedKey = focusedResourceKey(effects);
    const focused = focusedKey && keys.includes(focusedKey) ? checking.find((value) => resolutionKey(value) === focusedKey) : undefined;
    if (focused) effects.announce(RESOURCE_ANNOUNCEMENTS.checking(focused.value?.label ?? RESOURCE_ANNOUNCEMENTS.resourceFallback), false);
  }
  try {
    const result = await requestResource(effects, "/api/areas/map-resources/refresh", { resources: requested });
    const values = resolutionsOf(result);
    const projection = (result as { projection?: unknown } | null)?.projection;
    if (projection) installResourceProjection(effects, projection);
    effects.controller.setResourceResolutions(values);
    effects.dispatch({ type: "refresh-finished", keys, resolutions: values });
    announceRefresh(effects, previous, values, options.quiet ?? false);
    return result;
  } catch (error) {
    const values = [...previous.values()];
    if (values.length) effects.controller.setResourceResolutions(values);
    effects.dispatch({ type: "refresh-finished", keys, resolutions: values });
    if (!options.quiet) effects.announce(RESOURCE_ANNOUNCEMENTS.refreshFailed(readResourceFailure(error, "").message));
    return null;
  }
}

/** The distinct resource locators of the loaded, visible Blocks of a composed scene. */
export function sceneResourceLocators(elements: readonly SceneElement[]): ResourceLocator[] {
  const byKey = new Map<ResourceLocatorKey, ResourceLocator>();
  for (const element of elements) {
    const tangent = tangentOf(element);
    const owner = element.customData?.tangentWorld?.owner;
    if (element.isDeleted || tangent?.kind !== "resource" || !owner) continue;
    const locator: ResourceLocator = { owner, id: tangent.ref as ResourceLocator["id"] };
    const key = resourceLocatorKey(locator);
    if (key) byKey.set(key, locator);
  }
  return [...byKey.values()];
}

/**
 * Resolves every loaded resource Block in one bounded request, once per scene change and once per
 * cadence tick. Facts never touch scene authority. The first resolve of a set of Blocks also
 * refreshes their observations; a cadence tick re-reads cached facts only.
 */
export function resolveSceneResources(effects: ResourceEffects, elements: readonly SceneElement[], cadence: Count): void {
  if (!effects.api) return;
  const fence = effects.sceneResolve;
  const resources = sceneResourceLocators(elements);
  const keys = resources.map(resourceLocatorKey).filter((key): key is ResourceLocatorKey => key !== null);
  const key = JSON.stringify([...keys].sort());
  const requestKey = `${cadence}:${key}`;
  if (fence.requestKey === requestKey) return;
  fence.requestKey = requestKey;
  fence.request?.abort();
  const previousKeys = [...fence.mapKeys];
  fence.mapKeys = new Set(keys);
  if (!resources.length) {
    effects.controller.setResourceResolutions([], { replace: true });
    effects.dispatch({ type: "install-resolutions", resolutions: [], dropKeys: previousKeys });
    fence.observationKey = "";
    return;
  }
  const refreshObservations = fence.observationKey !== key;
  const request = new AbortController();
  fence.request = request;
  void requestResource(effects, "/api/areas/map-resources/resolve", { resources }, request.signal).then((result) => {
    if (fence.request !== request) return;
    const values = resolutionsOf(result);
    effects.controller.setResourceResolutions(values, { replace: true });
    effects.dispatch({ type: "install-resolutions", resolutions: values, dropKeys: previousKeys });
    if (refreshObservations) {
      fence.observationKey = key;
      void refreshResourceFacts(effects, resources, { quiet: true });
    }
  }, () => { /* An unresolved Block stays inert and compatible. */ });
}

/** Aborts every in-flight read, for unmount. */
export function cancelResourceRequests(effects: ResourceEffects): void {
  cancelResourcePanelLoad(effects);
  effects.sceneResolve.request?.abort();
  effects.sceneResolve.request = null;
}

/** The cadence the Map re-reads facts on: the configured one above the floor, else the default. */
export function resourceCadenceInterval(configured: Milliseconds | null): Milliseconds {
  if (configured === null || !(configured > 0)) return LAYOUT.resourceCadence;
  return milliseconds(Math.max(LAYOUT.resourceCadenceFloor, configured));
}

/** Starts the cadence ticker and returns the function that stops it. */
export function installResourceCadence(effects: ResourceEffects, configured: Milliseconds | null): () => void {
  return effects.scheduler.every(() => effects.dispatch({ type: "cadence-tick" }), resourceCadenceInterval(configured));
}

/** Re-reads an open inventory on a cadence tick without turning the catalog cadence into provider polling. */
export function refreshOpenPanel(effects: ResourceEffects): Promise<ResourcePanelProjection | null> {
  const state = effects.getState();
  if (!state.cadence || !state.open || !state.area) return Promise.resolve(null);
  return loadResources(effects, state.area, { refreshObservations: false });
}

/** Runs bounded worktree discovery for the panel's Area while keeping confirmed inventory authoritative. */
export async function discoverResources(effects: ResourceEffects): Promise<ResourceDiscovery | null> {
  const area = effects.getState().area;
  if (!effects.writesEnabled() || !area) return null;
  effects.dispatch({ type: "set-busy", busy: "discover" });
  effects.dispatch({ type: "set-discovery", discovery: { state: "checking", sources: [], problems: [] } });
  try {
    const result = (await requestResource(effects, "/api/areas/map-resources/discover", { area })) as ResourceDiscovery;
    if (result.projection) installResourceProjection(effects, result.projection, area);
    else if (Array.isArray(result.suggestions)) effects.dispatch({ type: "set-suggestions", suggestions: result.suggestions });
    effects.dispatch({ type: "set-discovery", discovery: result });
    effects.announce(result.problems?.length ? RESOURCE_ANNOUNCEMENTS.discoveryFinishedWithProblems : RESOURCE_ANNOUNCEMENTS.discoveryFinished);
    return result;
  } catch (error) {
    const failure = readResourceFailure(error, "");
    effects.dispatch({ type: "set-discovery", discovery: { state: "unavailable", sources: [], problems: [{ code: failure.code ?? "discovery-unavailable", message: failure.message, retryable: true }] } });
    effects.announce(RESOURCE_ANNOUNCEMENTS.discoveryFailed(failure.message));
    return null;
  } finally {
    effects.dispatch({ type: "set-busy", busy: null });
  }
}

/** Inspects a target through the server and returns what it found. */
export async function inspectTarget(effects: ResourceEffects, request: { kind: string; url?: string; path?: string }): Promise<InspectedTarget> {
  return (await requestResource(effects, "/api/areas/map-resources/inspect-target", request)) as InspectedTarget;
}

/**
 * Inspects the retained draft's target. Returns the input a mutation records, or null when the
 * draft is stale, the path is missing and unconfirmed, or the inspection failed; each case is
 * written onto the draft and spoken.
 */
export async function inspectResourceDraft(effects: ResourceEffects): Promise<ResourceTargetInput | null> {
  const draft = effects.getState().editor;
  if (!draft) return null;
  if (draft.stale) { effects.announce(RESOURCE_ANNOUNCEMENTS.resourcesChanged); return null; }
  effects.dispatch({ type: "set-busy", busy: "inspect" });
  try {
    const inspected = await inspectTarget(effects, draftInspectRequest(draft));
    if (draftNeedsMissingConfirmation(draft, inspected)) {
      effects.dispatch({ type: "editor-inspected", inspection: inspected, message: RESOURCE_ANNOUNCEMENTS.missingPathConfirm });
      return null;
    }
    return targetInputFrom(inspected);
  } catch (error) {
    const message = readResourceFailure(error, "").message;
    effects.dispatch({ type: "editor-failed", message, operationId: null, inspection: null });
    effects.announce(RESOURCE_ANNOUNCEMENTS.targetNotAccepted(message));
    return null;
  } finally {
    effects.dispatch({ type: "set-busy", busy: null });
  }
}

/** The loaded, saved source shard of one Area, the only shard that can take part in an exact scene mutation. */
export function resourceSourceShard(effects: ResourceEffects, area: AreaKey | null): { hash: ShardHash } | null {
  if (!area) return null;
  const node = effects.controller.world().areas.find((entry) => entry.key === area);
  const hash = node?.shard.hash;
  return node?.shard.scene && hash ? { hash } : null;
}
