import { canvasHash, serializeAreaCanvas } from "./area-canvas.mjs";
import { safeAreaResourceOwner } from "./area-resource-catalog.mjs";
import { createBlockElements, setBlockHidden, tangentOf } from "./public/area-board-core.js";
import { isSafeResourceId, resourceLocatorKey } from "./public/area-map-entities.js";
import { AREA_MAP_LAYOUT, nearestFreeRectangle } from "./public/area-map-world-core.js";

const REPRESENTATION_SCHEMA = "area-map-resource-representation.v1";
const REPRESENTATION_KINDS = new Set(["place", "hide", "restore"]);

/** Returns one API-shaped failure without throwing expected representation errors. */
function failure(status, code, error, operationId = "", details = {}) {
  return { status, code, error, operationId, retryable: false, ...details };
}

/** Validates the complete Brain/UI representation request before any read. */
function validateRequest(request) {
  const operationId = typeof request?.operationId === "string" ? request.operationId : "";
  if (request?.schema !== REPRESENTATION_SCHEMA || !REPRESENTATION_KINDS.has(request?.kind) || !isSafeResourceId(operationId)) {
    return failure(400, "invalid-resource-request", "A resource representation request needs its schema, kind, and safe operation ID.", operationId);
  }
  const resource = request?.resource;
  if (!safeAreaResourceOwner(resource?.owner) || !isSafeResourceId(resource?.id)) {
    return failure(422, "invalid-resource-target", "A resource representation needs a safe physical Area owner and opaque resource ID.", operationId);
  }
  if (!safeAreaResourceOwner(request?.viewedFrom) || !(request.viewedFrom === resource.owner || request.viewedFrom.startsWith(`${resource.owner}/`))) {
    return failure(422, "invalid-resource-target", "The resource owner must be the viewed Area or one of its ancestors.", operationId);
  }
  return null;
}

/** Converts the injected hidden-status result into one stable status word. */
function hiddenStatus(value) {
  if (typeof value === "string") return value;
  return String(value?.status ?? value?.state ?? value?.hiddenStatus ?? value?.hidden ?? "");
}

/** Returns the read-only failure for a done or archived source Area. */
async function readOnlyFailure(readAreaStatus, owner, operationId) {
  const status = hiddenStatus(await readAreaStatus(owner));
  return ["done", "archived", "read-only"].includes(status)
    ? failure(423, "area-resource-read-only", `Map resources in ${owner} are read-only because the Area is ${status}.`, operationId, { area: owner, areaStatus: status })
    : null;
}

/** Extracts exact active same-owner catalog evidence from supported resolver shapes. */
function activeCatalogEvidence(resolution, locator) {
  if (!resolution || !["active", "current"].includes(resolution.state)) return null;
  const value = resolution.value ?? resolution.resource ?? resolution.record ?? resolution;
  const record = value.record ?? value;
  if (record?.membership?.state && record.membership.state !== "active") return null;
  const resolvedLocator = value.locator ?? resolution.locator ?? {
    owner: value.owner ?? resolution.owner,
    id: value.id ?? record?.id,
  };
  if (resourceLocatorKey(resolvedLocator) !== resourceLocatorKey(locator)) return null;
  return { label: String(value.label ?? resolution.label ?? record?.label ?? "Map resource") || "Map resource" };
}

/** Returns one typed missing-active-record result for Place. */
async function activeResourceFailure(resolveCatalogResource, resource, operationId) {
  const resolution = await resolveCatalogResource(resource);
  return activeCatalogEvidence(resolution, resource)
    ? null
    : failure(404, "resource-not-found", `Active Map resource ${resource.id} was not found in ${resource.owner}.`, operationId, { resource });
}

/** Returns each visible or retained hidden source root for one source-local resource ID. */
function resourceRoots(scene, id) {
  return (scene?.elements ?? []).filter((element) => {
    const tangent = tangentOf(element);
    return tangent?.kind === "resource" && tangent.ref === id;
  });
}

/** Reports a corrupt root/label deletion split that cannot be safely hidden or restored. */
function hasSplitDeletionState(scene, root) {
  const byId = new Map((scene?.elements ?? []).map((element) => [element.id, element]));
  return (root.boundElements ?? [])
    .filter((binding) => binding?.type === "text")
    .map((binding) => byId.get(binding.id))
    .filter(Boolean)
    .some((label) => Boolean(label.isDeleted) !== Boolean(root.isDeleted));
}

/** Classifies the one permitted representation or returns its typed conflict. */
function inspectRepresentation(scene, resource, operationId) {
  const roots = resourceRoots(scene, resource.id);
  if (roots.length > 1) {
    return { error: failure(409, "resource-representation-conflict", `Map resource ${resource.id} has more than one source representation in ${resource.owner}.`, operationId, { resource, representationCount: roots.length }) };
  }
  const root = roots[0] ?? null;
  if (root && hasSplitDeletionState(scene, root)) {
    return { error: failure(409, "resource-representation-conflict", `Map resource ${resource.id} has inconsistent hidden source records in ${resource.owner}.`, operationId, { resource }) };
  }
  return { root, state: !root ? "never-placed" : root.isDeleted ? "hidden" : "on-map" };
}

/** Returns collision walls from the same finite, visible source geometry the world pipeline consumes. */
function occupiedRectangles(scene) {
  return (scene?.elements ?? []).filter((element) => {
    if (element?.isDeleted || element?.customData?.tangentWorldEphemeral || element?.containerId) return false;
    if (element?.customData?.tangent?.role === "boundary") return false;
    return [element?.x, element?.y, element?.width, element?.height].every(Number.isFinite);
  });
}

/** Creates one source-local resource Block at the canonical Area-center default and resolves collisions. */
function placeResourceBlock(scene, resource, label) {
  const id = `tangent-resource-${resource.id}`;
  if ((scene.elements ?? []).some((element) => element.id === id || element.id === `${id}-tangent-label`)) {
    return { error: `The deterministic source IDs for Map resource ${resource.id} are already in use.` };
  }
  const initial = createBlockElements({ id, kind: "resource", ref: resource.id, title: label, x: 0, y: 0 });
  const root = initial[0];
  const preferred = {
    x: (AREA_MAP_LAYOUT.minimumWidth - root.width) / 2,
    y: (AREA_MAP_LAYOUT.minimumHeight - AREA_MAP_LAYOUT.labelBand - root.height) / 2,
    width: root.width,
    height: root.height,
  };
  const placed = nearestFreeRectangle(preferred, occupiedRectangles(scene), { gap: AREA_MAP_LAYOUT.spacing });
  const elements = createBlockElements({ id, kind: "resource", ref: resource.id, title: label, x: placed.x, y: placed.y, width: placed.width, height: placed.height });
  const changed = structuredClone(scene);
  changed.elements.push(...elements);
  return { scene: changed, root: elements[0] };
}

/** Builds one design-shaped authoritative source update. */
function sourceUpdates(owner, scene, hash, serializedSource = serializeAreaCanvas(scene)) {
  return [{ owner, serializedSource, hash: hash ?? canvasHash(serializedSource) }];
}

/** Returns a successful current-state receipt without creating a transaction. */
function idempotentResult(request, source, representation, root) {
  const scene = structuredClone(source.scene);
  const serializedSource = typeof source.text === "string" ? source.text : serializeAreaCanvas(scene);
  return {
    status: 200,
    operationId: request.operationId,
    idempotent: true,
    kind: request.kind,
    resource: request.resource,
    representation,
    sourceId: root?.id ?? null,
    sourceUpdates: sourceUpdates(request.resource.owner, scene, source.hash, serializedSource),
  };
}

/** Converts a transaction refusal into the resource representation error vocabulary. */
function transactionFailure(result, request) {
  const status = Number(result?.status ?? 503);
  const code = String(result?.code ?? "");
  const conflict = status === 409 && code !== "operation-id-reused" && (result?.conflict === true || ["shard-conflict", "world-race", "source-conflict", "target-race", "head-race"].includes(code));
  return failure(
    status,
    conflict ? "resource-representation-conflict" : code || "resource-source-load-failed",
    String(result?.error ?? (conflict ? "The resource source scene changed before it could be saved." : "The resource source scene could not be saved.")),
    request.operationId,
    {
      resource: request.resource,
      ...(result?.currentHash ? { currentHash: result.currentHash } : {}),
      ...(result?.currentHashes ? { currentHashes: result.currentHashes } : {}),
    },
  );
}

/** Validates one source read before semantic inspection. */
function sourceReadFailure(source, request) {
  if (source?.ok === false) {
    return failure(409, "resource-source-invalid", `The source Map for ${request.resource.owner} is invalid.`, request.operationId, { resource: request.resource });
  }
  if (!source?.scene || !Array.isArray(source.scene.elements)) {
    return failure(503, "resource-source-load-failed", `The source Map for ${request.resource.owner} could not be loaded.`, request.operationId, { resource: request.resource });
  }
  return null;
}

/**
 * Coordinates source-shard Place, Hide, and Restore operations.
 *
 * `resolveCatalogResource(locator)` returns a state that distinguishes an
 * active record from a tombstone or missing record. Current design-shaped
 * resolutions (`{state:"current", value:{locator,label}}`) are also accepted.
 */
export function createAreaResourceRepresentationCoordinator({ transactions, resolveCatalogResource, readAreaStatus }) {
  if (!transactions || typeof transactions.read !== "function" || typeof transactions.saveMany !== "function" || typeof transactions.withRead !== "function") {
    throw new TypeError("resource representations require map transaction read, withRead, and saveMany authority");
  }
  if (typeof resolveCatalogResource !== "function" || typeof readAreaStatus !== "function") {
    throw new TypeError("resource representations require catalog and Area-status readers");
  }

  /** Applies one exact representation request and returns a typed result. */
  async function apply(request, { session = null } = {}) {
    const invalid = validateRequest(request);
    if (invalid) return invalid;
    const { resource, operationId, kind } = request;
    try {
      const snapshot = await transactions.withRead(async () => {
        const readOnly = await readOnlyFailure(readAreaStatus, resource.owner, operationId);
        if (readOnly) return { error: readOnly };
        const source = await transactions.read(resource.owner);
        const sourceFailure = sourceReadFailure(source, request);
        if (sourceFailure) return { error: sourceFailure };
        const catalog = kind === "place" ? await resolveCatalogResource(resource) : null;
        return { source, catalog };
      });
      if (snapshot.error) return snapshot.error;
      const inspected = inspectRepresentation(snapshot.source.scene, resource, operationId);
      if (inspected.error) return inspected.error;
      if (kind === "place" && !activeCatalogEvidence(snapshot.catalog, resource)) {
        return failure(404, "resource-not-found", `Active Map resource ${resource.id} was not found in ${resource.owner}.`, operationId, { resource });
      }
      if (kind === "place" && inspected.state === "hidden") {
        return failure(409, "resource-representation-conflict", `Map resource ${resource.id} is hidden; restore its retained Block instead of placing another.`, operationId, { resource, representation: "hidden" });
      }
      if (kind === "place" && inspected.state === "on-map") return idempotentResult(request, snapshot.source, "on-map", inspected.root);
      if (kind === "hide" && inspected.state === "hidden") return idempotentResult(request, snapshot.source, "hidden", inspected.root);
      if (kind === "restore" && inspected.state === "on-map") return idempotentResult(request, snapshot.source, "on-map", inspected.root);
      if (kind !== "place" && inspected.state === "never-placed") {
        return failure(404, "resource-not-found", `Map resource ${resource.id} has no retained source Block in ${resource.owner}.`, operationId, { resource });
      }

      let changed;
      let root;
      if (kind === "place") {
        const evidence = activeCatalogEvidence(snapshot.catalog, resource);
        const placed = placeResourceBlock(snapshot.source.scene, resource, evidence.label);
        if (placed.error) return failure(409, "resource-representation-conflict", placed.error, operationId, { resource });
        changed = placed.scene;
        root = placed.root;
      } else {
        changed = setBlockHidden(snapshot.source.scene, inspected.root.id, kind === "hide");
        root = changed.elements.find((element) => element.id === inspected.root.id);
      }

      /** Rechecks semantic authority while the canonical source transaction owns its write lock. */
      const preflight = async () => {
        const readOnly = await readOnlyFailure(readAreaStatus, resource.owner, operationId);
        if (readOnly) return readOnly;
        if (kind === "place") return await activeResourceFailure(resolveCatalogResource, resource, operationId);
        return null;
      };
      const saved = await transactions.saveMany([
        { area: resource.owner, baseHash: snapshot.source.hash ?? null, canvas: changed, reason: `${kind} Map resource ${resource.id}` },
      ], {
        operationId,
        worldId: "area-map-resources",
        area: resource.owner,
        session,
        preflight,
      });
      if (Number(saved?.status ?? 200) >= 400 || saved?.committed === false) return transactionFailure(saved, request);
      const serializedSource = serializeAreaCanvas(changed);
      const hash = saved?.hashes?.[resource.owner] ?? saved?.hash ?? canvasHash(serializedSource);
      return {
        status: 200,
        operationId,
        idempotent: Boolean(saved?.idempotent),
        kind,
        resource,
        representation: kind === "hide" ? "hidden" : "on-map",
        sourceId: root.id,
        sourceUpdates: sourceUpdates(resource.owner, changed, hash, serializedSource),
      };
    } catch (error) {
      return failure(
        Number(error?.status ?? 503),
        String(error?.code ?? "resource-source-load-failed"),
        String(error?.message ?? "The resource representation operation failed."),
        operationId,
        { resource },
      );
    }
  }

  return { apply };
}

/** Short factory alias for server composition call sites. */
export const createAreaResourceRepresentations = createAreaResourceRepresentationCoordinator;

export default { createAreaResourceRepresentationCoordinator, createAreaResourceRepresentations };
