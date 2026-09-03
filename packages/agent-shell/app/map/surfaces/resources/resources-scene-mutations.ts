// Scene-coupled resource mutations: the ones that rewrite an Area's Map source together with its
// catalog. Associating a generic Link, adding a gone resource back, and undoing either. Each waits
// for the canonical Map to be saved, fences the exact source hash, and installs the server's source
// update as authority without a Map history entry. Also the row's live Map state, read from the
// loaded source bytes ahead of the catalog's cadence fact, and the Hide command.

import { tangentOf } from "../../kernel/kernel-boundary.ts";
import type { MapEntityFacts, ResourcePanelRow, SourceElement, World } from "../../kernel/kernel-types.ts";
import { INTERNAL_ERRORS, RESOURCE_ANNOUNCEMENTS, SCENE_RECOVERY, TRANSACTION } from "../../copy.ts";
import type { Representation } from "../../copy.ts";
import { areaKey, shardOwner } from "../../units/ids.ts";
import type { AreaKey, OperationId } from "../../units/ids.ts";
import { resourceEntityForRow, rowCanAddBack, savedRepresentationForRow } from "./resource-rows.ts";
import { targetInputFrom } from "./resources-draft.ts";
import { cancelResourcePanelLoad, inspectTarget, installResourceProjection, isInstallableProjection, loadResources, refreshResourceFacts, requestResource, resourceSourceShard } from "./resources-effects.ts";
import type { ResourceEffects } from "./resources-effects.ts";
import { applyResourceMutation } from "./resources-mutations.ts";
import { resourceWritesAvailable } from "./resources-state.ts";
import type { ResourceSceneRecovery } from "./resources-state.ts";
import { readResourceFailure } from "./resources-wire.ts";
import type { AddBackSource, ResourceMutation, ResourceMutationRequest, ResourceMutationResult } from "./resources-wire.ts";

/** How one scene mutation is applied: its id and words, or the retained envelope and owner it resends. */
export type ApplySceneOptions = {
  readonly operationId?: OperationId;
  readonly success?: string;
  readonly request?: ResourceMutationRequest | null;
  readonly owner?: AreaKey | null;
};

/** A failure the flow itself raised before or after the server answered, with the code the recovery names. */
type SceneFlowError = Error & { code: string };

/** Builds a flow error with its code. */
function sceneError(message: string, code: string): SceneFlowError {
  return Object.assign(new Error(message), { code });
}

/** The loaded source element of one resource locator, hidden ones included, or null. */
export function sourceResourceBlock(world: World, row: ResourcePanelRow | null | undefined): SourceElement | null {
  const locator = resourceEntityForRow(row)?.locator;
  if (!locator) return null;
  const node = world.areas.find((entry) => entry.key === areaKey(locator.owner));
  return node?.shard.scene?.elements.find((element) => {
    const tangent = tangentOf(element);
    return tangent?.kind === "resource" && tangent.ref === locator.id;
  }) ?? null;
}

/** The row's Map state, with retained live source bytes ahead of the catalog's cadence fact. */
export function representationForRow(world: World, row: ResourcePanelRow): Representation {
  const source = sourceResourceBlock(world, row);
  if (source) return source.isDeleted ? "hidden" : "on-map";
  return savedRepresentationForRow(row);
}

/** The veil words for one scene mutation. */
function sceneBusyLabel(mutation: ResourceMutation): string {
  if (mutation.kind === "undo") return TRANSACTION.undoing;
  return mutation.kind === "add-back-gone" ? TRANSACTION.addingBack : TRANSACTION.addingLink;
}

/** The Area whose source a scene mutation rewrites. Every source owner is an Area, never the root shard. */
function sceneOwner(mutation: ResourceMutation, retained: AreaKey | null | undefined): AreaKey | null {
  if (retained) return retained;
  if (mutation.kind === "associate-generic-link") return areaKey(mutation.owner);
  return mutation.kind === "add-back-gone" ? areaKey(mutation.oldResource.owner) : null;
}

/** Throws unless the canonical Map is saved, the one state a scene mutation may start from or land in. */
function requireSaved(effects: ResourceEffects, message: string): void {
  if (effects.controller.snapshot().save.state !== "saved") throw sceneError(message, "resource-representation-conflict");
}

/** Reads the owner's current catalog and source hash and builds the fenced envelope of a fresh scene mutation. */
async function sceneRequest(effects: ResourceEffects, mutation: ResourceMutation, area: AreaKey, operationId: OperationId): Promise<ResourceMutationRequest> {
  const projection = await requestResource(effects, `/api/areas/map-resources?area=${encodeURIComponent(area)}`);
  if (!isInstallableProjection(projection) || projection.state !== "current") throw sceneError(INTERNAL_ERRORS.catalogNotLoaded, "resource-catalog-unavailable");
  cancelResourcePanelLoad(effects);
  installResourceProjection(effects, projection, area);
  const shard = resourceSourceShard(effects, area);
  if (!shard || effects.controller.snapshot().save.state !== "saved") throw sceneError(INTERNAL_ERRORS.sourceNotReady, "resource-source-load-failed");
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: area,
    mutation,
    expectedCatalogs: (projection.catalogs ?? []).filter((catalog) => areaKey(catalog.owner) === area),
    expectedScenes: [{ owner: shardOwner(area), hash: shard.hash }],
  };
}

/** Installs what an accepted scene mutation answered: the source update as authority, then the projection and undo. */
async function acceptSceneMutation(effects: ResourceEffects, result: ResourceMutationResult, area: AreaKey, success: string): Promise<void> {
  if (!Array.isArray(result.sourceUpdates) || !result.sourceUpdates.length) throw sceneError(INTERNAL_ERRORS.noSourceUpdate, "resource-source-invalid");
  requireSaved(effects, INTERNAL_ERRORS.changeStartedMidInstall);
  effects.controller.installResourceSourceUpdates([...result.sourceUpdates]);
  cancelResourcePanelLoad(effects);
  if (result.projection) installResourceProjection(effects, result.projection, area);
  else await loadResources(effects, area, { refreshObservations: false });
  const undo = result.undo?.state === "available" ? { token: result.undo.token, owner: area, sourceCoupled: true, operationId: effects.mintOperationId() } : null;
  effects.dispatch({ type: "set-undo", undo });
  const locator = result.resource?.locator;
  if (locator) void refreshResourceFacts(effects, [locator], { quiet: true });
  effects.announce(success);
}

/**
 * Applies a catalog-plus-scene mutation only after canonical Map writes are fully saved. A retained
 * envelope is resent byte for byte; a fresh one is fenced to the owner's catalog revision and source
 * hash. On failure the retained envelope waits in the scene recovery dialog for Retry.
 */
export async function applySceneResourceMutation(effects: ResourceEffects, mutation: ResourceMutation, options: ApplySceneOptions = {}): Promise<ResourceMutationResult | null> {
  const area = sceneOwner(mutation, options.owner);
  if (!area) return null;
  const operationId = options.operationId ?? effects.mintOperationId();
  const success = options.success ?? RESOURCE_ANNOUNCEMENTS.resourceUpdated;
  let request = options.request ? structuredClone(options.request) : null;
  effects.dispatch({ type: "set-scene-recovery", recovery: null });
  effects.dispatch({ type: "set-busy", busy: mutation.kind });
  effects.dispatch({ type: "set-scene-busy", busy: { label: sceneBusyLabel(mutation) } });
  try {
    await effects.controller.flush();
    requireSaved(effects, INTERNAL_ERRORS.saveBeforeResourceChange);
    request ??= await sceneRequest(effects, mutation, area, operationId);
    const result = (await requestResource(effects, "/api/areas/map-resources/apply", request)) as ResourceMutationResult;
    await acceptSceneMutation(effects, result, area, success);
    return result;
  } catch (error) {
    const failure = readResourceFailure(error, INTERNAL_ERRORS.notSavedTogether);
    if (failure.projection) {
      cancelResourcePanelLoad(effects);
      installResourceProjection(effects, failure.projection, area);
    }
    const code = failure.code ?? "resource-transaction-failed";
    effects.dispatch({ type: "set-scene-recovery", recovery: { phase: "error", mutation, operationId, success, request, owner: area, code, message: failure.message } });
    effects.announce(RESOURCE_ANNOUNCEMENTS.resourceNotSaved(failure.message));
    return null;
  } finally {
    effects.dispatch({ type: "set-busy", busy: null });
    effects.dispatch({ type: "set-scene-busy", busy: null });
  }
}

/** Associates one selected generic Link Block with the Area that owns its source element. */
export function associateGenericLink(effects: ResourceEffects, entity: MapEntityFacts | null): boolean {
  if (!resourceWritesAvailable(effects.getState(), effects.writesEnabled())) { effects.announce(RESOURCE_ANNOUNCEMENTS.writesNotEnabled); return false; }
  if (entity?.reference.kind !== "link" || !entity.source.owner || !entity.source.sourceId) return false;
  const mutation: ResourceMutation = { kind: "associate-generic-link", owner: entity.source.owner, sourceElementId: entity.source.sourceId, labelForNewRecord: null };
  void applySceneResourceMutation(effects, mutation, { success: RESOURCE_ANNOUNCEMENTS.linkAdded });
  return true;
}

/** Opens the Add-back confirmation for a gone row that is still on the Map and still has a safe Last-known target. */
export function requestAddBack(effects: ResourceEffects, row: ResourcePanelRow): boolean {
  if (!resourceWritesAvailable(effects.getState(), effects.writesEnabled())) { effects.announce(RESOURCE_ANNOUNCEMENTS.reloadBeforeAddBack); return false; }
  const entity = resourceEntityForRow(row);
  const target = entity?.lastKnown?.target;
  if (!entity || !target || !rowCanAddBack(row) || representationForRow(effects.controller.world(), row) !== "on-map") return false;
  const label = entity.lastKnown?.label || SCENE_RECOVERY.resourceFallback(entity.locator.id);
  effects.dispatch({ type: "set-scene-recovery", recovery: { phase: "confirm-add-back", operationId: effects.mintOperationId(), row: structuredClone(row), label, target: target.url ?? target.path ?? "" } });
  return true;
}

/** Confirms a missing record's Last-known target with the server before it is added back. */
async function confirmedLastKnownSource(effects: ResourceEffects, retained: Extract<ResourceSceneRecovery, { phase: "confirm-add-back" | "error-add-back" }>): Promise<AddBackSource | null> {
  const entity = resourceEntityForRow(retained.row);
  const target = entity?.lastKnown?.target;
  if (!target) return null;
  effects.dispatch({ type: "set-scene-recovery", recovery: null });
  effects.dispatch({ type: "set-busy", busy: "add-back-gone" });
  effects.dispatch({ type: "set-scene-busy", busy: { label: TRANSACTION.confirmingLastKnown } });
  try {
    const inspected = await inspectTarget(effects, target.kind === "link" ? { kind: "link", url: target.url ?? "" } : { kind: target.kind, path: target.path ?? "" });
    return { kind: "confirmed-last-known", input: targetInputFrom(inspected), label: entity?.lastKnown?.label ?? "" };
  } catch (error) {
    const message = readResourceFailure(error, "").message;
    effects.dispatch({ type: "set-scene-recovery", recovery: { ...retained, phase: "error-add-back", message } });
    effects.announce(RESOURCE_ANNOUNCEMENTS.resourceNotSaved(message));
    return null;
  } finally {
    effects.dispatch({ type: "set-busy", busy: null });
    effects.dispatch({ type: "set-scene-busy", busy: null });
  }
}

/** Confirms Last-known authority, then replaces the visible gone id in one exact transaction. */
export async function confirmAddBack(effects: ResourceEffects, retained: ResourceSceneRecovery | null = effects.getState().sceneRecovery): Promise<ResourceMutationResult | null> {
  if (!retained || retained.phase === "error") return null;
  const entity = resourceEntityForRow(retained.row);
  if (!entity?.lastKnown?.target) return null;
  const source: AddBackSource | null = entity.reason === "missing-record" ? await confirmedLastKnownSource(effects, retained) : { kind: "tombstone" };
  if (!source) return null;
  return applySceneResourceMutation(effects, { kind: "add-back-gone", oldResource: entity.locator, source }, {
    operationId: retained.operationId,
    success: RESOURCE_ANNOUNCEMENTS.addedBack(retained.label),
  });
}

/** Retries the retained scene action with the operation id of its first attempt. */
export function retrySceneResourceMutation(effects: ResourceEffects): Promise<ResourceMutationResult | null> {
  const retained = effects.getState().sceneRecovery;
  if (!retained) return Promise.resolve(null);
  if (retained.phase === "error-add-back") return confirmAddBack(effects, retained);
  if (retained.phase === "confirm-add-back") return Promise.resolve(null);
  return applySceneResourceMutation(effects, retained.mutation, retained);
}

/** Undoes the last accepted change through its retained server token: a catalog undo, or a scene undo through the saved-source boundary. */
export function undoResourceChange(effects: ResourceEffects): Promise<ResourceMutationResult | null> {
  const undo = effects.getState().undo;
  if (!undo?.token) return Promise.resolve(null);
  const mutation: ResourceMutation = { kind: "undo", token: undo.token };
  if (!undo.sourceCoupled) return applyResourceMutation(effects, mutation, { operationId: undo.operationId, success: RESOURCE_ANNOUNCEMENTS.undone });
  const request: ResourceMutationRequest = { schema: "area-map-resource-mutation.v1", operationId: undo.operationId, viewedFrom: undo.owner, mutation };
  return applySceneResourceMutation(effects, mutation, { operationId: undo.operationId, owner: undo.owner, request, success: RESOURCE_ANNOUNCEMENTS.undone });
}

/** Hides the row's live Block through the Map's own hide command. The Area resource stays. */
export function hideResourceOnMap(effects: ResourceEffects, row: ResourcePanelRow): boolean {
  if (!resourceWritesAvailable(effects.getState(), effects.writesEnabled())) { effects.announce(RESOURCE_ANNOUNCEMENTS.reloadBeforeRepresentation); return false; }
  const entity = resourceEntityForRow(row);
  const locator = entity?.locator;
  const block = effects.controller.snapshot().composition.scene.elements.find((element) => {
    const tangent = tangentOf(element);
    return !element.isDeleted && tangent?.kind === "resource" && tangent.ref === locator?.id && element.customData?.tangentWorld?.owner === locator?.owner;
  });
  if (!block) { effects.announce(RESOURCE_ANNOUNCEMENTS.notVisibleOnMap); return false; }
  effects.hideBlock(block);
  effects.announce(RESOURCE_ANNOUNCEMENTS.hid(entity?.label ?? RESOURCE_ANNOUNCEMENTS.resourceWordFallback));
  return true;
}
