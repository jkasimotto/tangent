import boardCore from "./area-board-core.js";
import worldCore from "./area-map-world-core.js";
import { createAreaMapWorldHistory } from "./area-map-world-history.js";
import { rebaseAreaMapOwners } from "./area-map-world-conflict.js";
import { createAreaMapWorldDraftStore } from "./area-map-world-draft-store.js";
import { areaInRestriction } from "./area-map-find-core.js";
import { resolveMapEntity, resourceLocatorKey } from "./area-map-entities.js";
import { WIRE_VALUES } from "./area-map-wire-values.js";

const VIEW_SCHEMA = "area-map-view.v2";
const DRAFT_SCHEMA = "area-map-draft.v1";
const DETAIL_ENTER_PX = 96;
// The shell polls facts on every server event, and each structural reload reads the whole world, so a poll reloads at most this often.
const TREE_POLL_INTERVAL_MS = 5_000;
const DETAIL_LEAVE_PX = 72;
const AREA_RESIZE_HANDLES = new Set(["n", "s", "e", "w", "nw", "ne", "sw", "se"]);

/** Makes an immutable controller-boundary copy. */
const clone = (value) => structuredClone(value);
/** Compares small serializable controller values. */
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
/** Returns the visible leaf name of one Area key. */
const leaf = (area) => String(area ?? "").split("/").at(-1) || "Area";
/** Returns the local fallback view key for one stable world. */
const viewKey = (worldId) => `tangent.area-map-view.v2:${worldId}`;

/** Classifies one save result without retaining messages or authored values. */
function failureKind(result = {}) {
  if (result.code) return String(result.code).slice(0, 40);
  const status = Number(result.status ?? 0);
  if (!status) return "transport";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status >= 500) return "unavailable";
  return status >= 400 ? "request" : "none";
}

/** Chooses conflict actions only for an external authority conflict, never a safe retry race. */
function failureSaveState(result = {}) {
  const status = Number(result.status ?? 0);
  return status === 409 && result.retryable !== true && result.code !== "head-race" ? "conflict" : "blocked";
}

/** Keeps only opaque correlation tokens that cannot contain paths or authored text. */
function safeCorrelationFields({ operationId = null, gestureId = null } = {}) {
  /** Accepts one bounded opaque machine correlation value through the guard registered beside its minter. */
  const safe = (wire, value) => wire.accepts(String(value ?? "")) ? String(value) : null;
  return Object.fromEntries([["operationId", safe(WIRE_VALUES.operationId, operationId)], ["gestureId", safe(WIRE_VALUES.gestureId, gestureId)]].filter(([, value]) => value));
}

/** Recovers save correlation from one private draft without exposing its authored payload. */
function draftCorrelation(record = null, result = {}) {
  const pending = record?.pending?.[0];
  const command = pending?.command;
  const direction = pending?.direction ?? "after";
  return safeCorrelationFields({
    operationId: result?.operationId ?? record?.failure?.operationId ?? command?.operationIds?.[direction],
    gestureId: result?.gestureId ?? record?.failure?.gestureId ?? command?.id,
  });
}

/** Returns the exact Excalidraw projection change, or null for a no-op poll. */
export function areaMapProjectionUpdate({ appliedFingerprint = null, currentSelection = [], scene = null, selection = [] } = {}) {
  const fingerprint = boardCore.authoredFingerprint(scene?.elements ?? []);
  const current = [...currentSelection].sort();
  const desired = [...selection].sort();
  const sceneChanged = appliedFingerprint !== fingerprint;
  if (!sceneChanged && same(current, desired)) return null;
  return {
    fingerprint,
    sceneChanged,
    selectedElementIds: Object.fromEntries(desired.map((id) => [id, true])),
  };
}

/** Returns Area-region geometry only for an explicit keyboard command. */
export function selectedAreaMapRegionChanges(elements, selectedIds, regionRects, { geometryCommand = null } = {}) {
  if (geometryCommand !== "keyboard-nudge") return [];
  const selected = new Set(selectedIds ?? []);
  return (elements ?? []).filter((element) => {
    if (element.isDeleted || element.customData?.tangent?.role !== "area-region" || !selected.has(element.id)) return false;
    const previous = regionRects?.get?.(element.customData.tangent.area);
    return previous && ["x", "y", "width", "height"].some((field) => Math.abs(Number(element[field]) - Number(previous[field])) >= 0.01);
  });
}

/** Returns the squared center distance between two structural rectangles. */
function regionDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const x = Number(left.x) + Number(left.width) / 2 - Number(right.x) - Number(right.width) / 2;
  const y = Number(left.y) + Number(left.height) / 2 - Number(right.y) - Number(right.height) / 2;
  return x * x + y * y;
}

/** Plans selected, located-descendant, then spatially nearby deferred loads. */
export function areaMapDeferredLoadPlan(world, composition, area, { includeDescendants = true, nearbyCount = 3, requireSelectedDeferred = false } = {}) {
  const available = (world?.areas ?? []).filter((node) => ["deferred", "load-error"].includes(node.shard?.state));
  const selected = available.filter((node) => node.key === area);
  if (requireSelectedDeferred && !selected.length) return [];
  const descendants = includeDescendants
    ? available.filter((node) => node.key.startsWith(`${area}/`)).sort((left, right) => left.depth - right.depth || left.key.localeCompare(right.key))
    : [];
  const planned = new Set([...selected, ...descendants].map((node) => node.key));
  const targetRect = composition?.regionRects?.get?.(area);
  const nearby = available.filter((node) => !planned.has(node.key)).sort((left, right) => {
    const distance = regionDistance(targetRect, composition?.regionRects?.get?.(left.key)) - regionDistance(targetRect, composition?.regionRects?.get?.(right.key));
    return distance || left.key.localeCompare(right.key);
  }).slice(0, Math.max(0, Number(nearbyCount) || 0));
  return [...selected, ...descendants, ...nearby].map((node) => node.key);
}

/** Selects source ownership for one new runtime element at an explicit command boundary. */
export function ownerForNewAreaMapElement({ copiedOwner = null, pasteOwner = null, startOwner = null, pointOwner = null } = {}) {
  return pasteOwner ?? copiedOwner ?? startOwner ?? pointOwner;
}

/** Converts one Excalidraw pointer-down state into a structural Area command. */
export function areaMapPointerCommand(pointerDownState = {}) {
  const handle = pointerDownState?.resize?.handleType || null;
  const resizing = Boolean(pointerDownState?.resize?.isResizing || handle);
  if (!resizing) return { kind: "move", handle: null };
  if (AREA_RESIZE_HANDLES.has(handle)) return { kind: "resize", handle };
  return { kind: "ignore", handle };
}

/** Reports whether structural block extent changed enough to affect Area layout. */
export function areaMapStructuralHullChanged(before, after) {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return ["x", "y", "width", "height"].some((field) => {
    const left = Number(before[field]); const right = Number(after[field]);
    return !Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) >= 0.01;
  });
}

/** Reads one private browser record without making storage availability authoritative. */
function readStored(storage, key) {
  try { return JSON.parse(storage?.getItem?.(key) || "null"); } catch { return null; }
}

/** Writes one private browser record when storage is available. */
function writeStored(storage, key, value) {
  try {
    if (value === null) storage?.removeItem?.(key);
    else storage?.setItem?.(key, JSON.stringify(value));
  } catch { /* This tab still owns its view and unsaved world. */ }
}

/** Creates the one browser authority for a composed Area-map world. */
export function createAreaMapWorldController({
  world: initialWorld,
  getDocuments = () => [],
  focus: initialFocus = {},
  loadShard = null,
  reloadWorld = null,
  treePollInterval = TREE_POLL_INTERVAL_MS,
  persistWorld = null,
  persistView = null,
  draftStore: suppliedDraftStore = null,
  onBack = null,
  onNavigation = null,
  onEvent = null,
  storage = globalThis.localStorage,
} = {}) {
  if (!initialWorld?.worldId || !Array.isArray(initialWorld.areas)) throw new Error("Area map world is required");
  const worldLoadStarted = performance.now();

  const listeners = new Set();
  const storedView = readStored(storage, viewKey(initialWorld.worldId));
  const validView = initialWorld.view?.schema === VIEW_SCHEMA ? initialWorld.view : storedView?.schema === VIEW_SCHEMA ? storedView : null;
  let world = clone(initialWorld);
  let composition = worldCore.composeAreaMapWorld(world);
  let focus = clone(initialFocus ?? {});
  let folded = new Set(validView?.foldedAreas ?? []);
  let detailAreas = new Set(validView?.detailAreas ?? []);
  let camera = {
    scrollX: Number(validView?.pan?.x ?? 0),
    scrollY: Number(validView?.pan?.y ?? 0),
    zoom: Number(validView?.zoom ?? 1) || 1,
  };
  const initialAreaKeys = new Set(world.areas.map((node) => node.key));
  let locatedArea = initialAreaKeys.has(validView?.locatedArea) ? validView.locatedArea : world.locatedArea;
  let cameraTarget = initialAreaKeys.has(validView?.cameraTarget) ? validView.cameraTarget : locatedArea;
  let cameraTrail = (validView?.cameraTrail ?? []).filter((area, index, values) => initialAreaKeys.has(area) && area !== cameraTarget && values.indexOf(area) === index);
  let restrictionArea = validView && Object.hasOwn(validView, "restrictionArea")
    ? initialAreaKeys.has(validView.restrictionArea) ? validView.restrictionArea : null
    : initialAreaKeys.has(locatedArea) ? locatedArea : null;
  const initialElementIds = new Set(composition.scene.elements.map((element) => element.id));
  let selection = new Set((validView?.selection ?? []).filter((id) => initialElementIds.has(id)));
  let findRevealId = null;
  let hiddenIds = new Set();
  let projectedScene = composition.scene;
  let save = { state: "saved", result: null };
  let failedSave = null;
  let recoveryQueue = [];
  let saveBarrier = null;
  let worldHistory = null;
  let gesture = null;
  let destroyed = false;
  let revision = 0;
  let factsRevision = 0;
  let resourceResolutions = new Map();
  let mapKinds = null;
  let figures = null;
  const figureCache = new Map();
  let authorityGeneration = 0;
  let viewTimer = null;
  let pendingView = null;
  let draft = null;
  // True only while a draft loaded at startup is still an unanswered offer, so a later save cannot delete work the person never chose to throw away.
  let draftOffered = false;
  let draftEpoch = 0;
  let draftWrites = Promise.resolve();
  let draftLoad = Promise.resolve();
  let recoveryStoreClosed = false;
  let treeRefresh = null;
  let treeRefreshRequested = false;
  let treeReloadFinishedAt = null;
  const inFlightLoads = new Map();
  const recoveryStore = suppliedDraftStore ?? createAreaMapWorldDraftStore();

  /** Emits one coordinate-free structured client event. */
  function recordEvent(name, fields = {}) {
    try { onEvent?.({ name, at: Date.now(), ...clone(fields) }); } catch { /* Diagnostics never affect map authority. */ }
  }

  /** Returns the runtime region for one Area. */
  function regionElement(area) {
    return composition.scene.elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData?.tangent?.area === area) ?? null;
  }

  /** Reports whether one Area belongs to the exact current structural scope. */
  function areaInScope(area) {
    return !restrictionArea || areaInRestriction(area, restrictionArea);
  }

  /** Returns the structural Area keys admitted by the current restriction. */
  function scopedAreas() {
    return new Set(world.areas.filter((node) => areaInScope(node.key)).map((node) => node.key));
  }

  /** Returns user-owned folds, except ancestors that would hide the target. */
  function effectiveFolds() {
    return new Set([...folded].filter((root) => !restrictionArea || !restrictionArea.startsWith(`${root}/`)));
  }

  /** Reports whether fold hides one structural descendant. */
  function foldedAncestor(area, includeSelf = false, folds = effectiveFolds()) {
    return [...folds].find((root) => includeSelf ? area === root || area.startsWith(`${root}/`) : area.startsWith(`${root}/`)) ?? null;
  }

  /** Recomputes semantic-detail membership with hysteresis. */
  function updateSemanticDetail() {
    const next = new Set(detailAreas);
    for (const node of world.areas) {
      const box = composition.regionRects.get(node.key);
      if (!box) continue;
      const edge = Math.min(box.width, box.height) * camera.zoom;
      if (next.has(node.key) ? edge < DETAIL_LEAVE_PX : edge >= DETAIL_ENTER_PX) {
        if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
      }
    }
    detailAreas = next;
  }

  /** Builds a disposable render mask. Source and composed elements stay unchanged. */
  function project() {
    /** Converts one resolved resource into the normal Tangent Block fact cache. */
    const resourceFact = (element, tangent) => {
      const owner = element.customData?.tangentWorld?.owner;
      const key = resourceLocatorKey({ owner, id: tangent.ref });
      const entity = key ? resolveMapEntity({ element, kinds: mapKinds, resource: resourceResolutions.get(key) ?? null }) : null;
      if (!entity) return null;
      return {
        kind: entity.display.kindLabel,
        kindId: entity.kindId,
        states: entity.states,
        title: entity.display.label,
        status: [entity.display.targetClue, ...entity.display.stateText].filter(Boolean).join(" · "),
        ghost: entity.sourceState !== "current",
        success: entity.display.externalTreatment === "success",
      };
    };
    const scene = boardCore.refreshTangentFacts(clone(composition.scene), getDocuments(), { resourceFact, figures, figureCache }).scene;
    const visibleFolds = effectiveFolds();
    const hidden = new Set();
    const hiddenBlocks = new Set();
    for (const element of scene.elements) {
      const role = element.customData?.tangent?.role;
      if (role === "area-region") {
        const area = element.customData.tangent.area;
        element.locked = false;
        element.isDeleted = false;
        element.angle = 0;
        // A transparent fill gives every nested Area a real drag surface.
        // Resize still starts only on the discrete handles inferred by the island.
        element.backgroundColor = "#ffffff01";
        element.fillStyle = "solid";
        if (!areaInScope(area)) { hidden.add(element.id); continue; }
        if (area === locatedArea) {
          element.strokeWidth = Math.max(3, Number(element.strokeWidth ?? 2));
          element.strokeColor = "#4c6ef5";
        }
        if (visibleFolds.has(area)) element.opacity = Math.min(Number(element.opacity ?? 100), 45);
        if (foldedAncestor(area, false, visibleFolds)) hidden.add(element.id);
        continue;
      }
      const revealedByFind = element.id === findRevealId || element.containerId === findRevealId;
      const owner = element.customData?.tangentWorld?.owner;
      if (owner && !areaInScope(owner)) {
        hidden.add(element.id);
        if (boardCore.tangentOf(element)) hiddenBlocks.add(element.id);
      } else if (!revealedByFind && owner && (foldedAncestor(owner, true, visibleFolds) || !detailAreas.has(owner))) {
        hidden.add(element.id);
        if (boardCore.tangentOf(element)) hiddenBlocks.add(element.id);
      }
      if (!revealedByFind && boardCore.tangentOf(element) && !boardCore.blockMatchesFocus(element, getDocuments(), focus, locatedArea, resourceFact)) {
        hidden.add(element.id); hiddenBlocks.add(element.id);
        for (const binding of element.boundElements ?? []) if (binding.type === "text") hidden.add(binding.id);
      }
    }
    for (const element of scene.elements) {
      const sourceId = element.customData?.tangentWorldEphemeral?.sourceId ?? null;
      if (sourceId && hidden.has(sourceId)) hidden.add(element.id);
    }
    for (const element of scene.elements) {
      if (element.type !== "arrow") continue;
      const endpointFolded = Object.values(element.customData?.tangentWorldEndpoints ?? {}).some((endpoint) => endpoint?.owner && foldedAncestor(endpoint.owner, true, visibleFolds));
      const endpointOutside = Object.values(element.customData?.tangentWorldEndpoints ?? {}).some((endpoint) => endpoint?.owner && !areaInScope(endpoint.owner));
      const ownerOutside = element.customData?.tangentWorld?.owner && !areaInScope(element.customData.tangentWorld.owner);
      if (ownerOutside || endpointOutside || endpointFolded || hiddenBlocks.has(element.startBinding?.elementId) || hiddenBlocks.has(element.endBinding?.elementId)) {
        hidden.add(element.id);
        for (const binding of element.boundElements ?? []) if (binding.type === "text") hidden.add(binding.id);
      }
    }
    for (const element of scene.elements) if (hidden.has(element.id)) element.isDeleted = true;
    hiddenIds = hidden;
    projectedScene = scene;
  }

  /** Saves private view state without entering world history. */
  function saveView() {
    const value = {
      schema: VIEW_SCHEMA,
      worldId: world.worldId,
      pan: { x: camera.scrollX, y: camera.scrollY },
      zoom: camera.zoom,
      foldedAreas: [...folded].sort(),
      detailAreas: [...detailAreas].sort(),
      locatedArea,
      cameraTarget,
      cameraTrail: [...cameraTrail],
      restrictionArea,
      selection: [...selection].sort(),
    };
    writeStored(storage, viewKey(world.worldId), value);
    pendingView = value;
    if (!persistView) return;
    if (viewTimer !== null) clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      viewTimer = null; const next = pendingView; pendingView = null;
      Promise.resolve(persistView(next)).catch(() => {});
    }, 250);
  }

  /** Publishes one coherent controller snapshot. */
  function notify(reason = "world") {
    if (destroyed) return;
    revision += 1;
    project();
    const value = snapshot(reason);
    for (const listener of listeners) listener(value);
  }

  /** Returns a read-only public snapshot. */
  function snapshot(reason = "read") {
    const dirtyOwners = new Set(gesture?.changedOwners ?? []);
    for (const area of gesture?.changedAreas ?? []) dirtyOwners.add(world.areas.find((node) => node.key === area)?.parent);
    for (const item of [failedSave, ...recoveryQueue, worldHistory?.state.active, ...(worldHistory?.state.queue ?? [])].filter(Boolean)) {
      const command = item.command ?? item; const direction = item.direction ?? "after"; const commandState = command?.[direction];
      if (!commandState?.get) continue;
      for (const owner of commandState.get("changedOwners") ?? []) dirtyOwners.add(owner);
      const commandWorld = commandState.get("world");
      for (const area of commandState.get("changedAreas") ?? []) dirtyOwners.add(commandWorld?.areas?.find((node) => node.key === area)?.parent);
    }
    dirtyOwners.delete(undefined);
    return {
      reason, revision, factsRevision,
      world, composition, scene: projectedScene, hiddenIds, mapKinds,
      focus, folded: effectiveFolds(), manualFolded: folded, restrictionArea, scopedAreas: scopedAreas(), findRevealId, detailAreas, camera, locatedArea, cameraTarget, cameraTrail, viewRestored: Boolean(validView),
      selection, save, draft, dirtyOwners,
      nextEscape: selection.size ? "Esc clears selection" : cameraTrail.length ? `Esc → ${leaf(cameraTrail.at(-1))}` : "Esc → Work",
    };
  }

  /** Applies acknowledged hashes to every later immutable command snapshot. */
  function applyHashes(target, hashes = {}) {
    if (!target?.areas) return;
    for (const [owner, hash] of Object.entries(hashes)) {
      if (owner === "@root") { if (target.rootShard) { target.rootShard.hash = hash; target.rootShard.revision = hash; } continue; }
      const node = target.areas.find((entry) => entry.key === owner);
      if (node) { node.shard.hash = hash; node.shard.revision = hash; }
    }
  }

  /** Applies the server revision acknowledged for one committed transaction. */
  function applyRevision(target, result = {}) {
    if (!target) return;
    if (result.worldRevision) target.worldRevision = result.worldRevision;
    if (result.treeRevision) target.treeRevision = result.treeRevision;
  }

  /** Wraps one world and its exact shard effects for the shared history primitive. */
  function historyState(value, changedAreas = [], changedOwners = []) {
    return new Map([
      ["world", clone(value)],
      ["changedAreas", [...changedAreas].sort()],
      ["changedOwners", [...changedOwners].sort()],
    ]);
  }

  /** Returns every failed or later command still required for recovery. */
  function recoveryCommands() {
    const values = [failedSave, ...recoveryQueue, worldHistory?.state.active, ...(worldHistory?.state.queue ?? [])].filter(Boolean);
    const seen = new Set();
    return values.flatMap((item) => {
      const command = item.command ?? item; const direction = item.direction ?? "after"; const key = `${command.id}:${direction}`;
      if (!command?.id || seen.has(key)) return [];
      seen.add(key); return [{ command: clone(command), direction }];
    });
  }

  /** Stores complete recovery only after a save failed or conflicted. */
  function storeDraft(result = save.result) {
    const pending = recoveryCommands();
    draft = {
      schema: DRAFT_SCHEMA,
      worldId: world.worldId,
      worldRevision: world.worldRevision,
      savedAt: new Date().toISOString(),
      locatedArea,
      world: clone(world),
      pending,
      history: { undo: clone(worldHistory?.state.undo ?? []), redo: clone(worldHistory?.state.redo ?? []) },
      baseHashes: Object.fromEntries([["@root", world.rootShard?.hash ?? null], ...world.areas.map((node) => [node.key, node.shard.hash ?? null])]),
      owners: [...new Set(pending.flatMap((item) => {
        const state = item.command[item.direction]; const value = state.get("world");
        return [...(state.get("changedOwners") ?? []), ...(state.get("changedAreas") ?? []).map((area) => value.areas.find((node) => node.key === area)?.parent).filter(Boolean)];
      }))].sort(),
      status: result?.status ?? 0,
      failure: clone(result ?? {}),
    };
    draftOffered = false;
    draftEpoch += 1;
    const record = clone(draft);
    const correlation = draftCorrelation(record, result);
    draftWrites = draftWrites.catch(() => null).then(async () => {
      const startedAt = performance.now();
      try {
        await recoveryStore.save(record);
        recordEvent("area_map_draft", { phase: "stored", draftState: "available", pendingCount: record.pending.length, status: record.status, failureKind: failureKind(record.failure), duration: performance.now() - startedAt, ...correlation });
      } catch {
        recordEvent("area_map_draft", { phase: "failed", draftState: "unavailable", pendingCount: record.pending.length, failureKind: "storage", duration: performance.now() - startedAt, ...correlation });
      }
    });
  }

  /** Clears private recovery after every required command is durable. */
  function clearDraft(result = {}) {
    draftOffered = false;
    draftEpoch += 1;
    const correlation = draftCorrelation(draft, result);
    draft = null;
    const worldId = world.worldId;
    draftWrites = draftWrites.catch(() => null).then(async () => {
      const startedAt = performance.now();
      try {
        await recoveryStore.remove(worldId);
        recordEvent("area_map_draft", { phase: "cleared", draftState: "none", pendingCount: 0, duration: performance.now() - startedAt, ...correlation });
      } catch {
        recordEvent("area_map_draft", { phase: "failed", draftState: "unavailable", pendingCount: 0, failureKind: "storage", duration: performance.now() - startedAt, ...correlation });
      }
    });
  }

  /** Closes recovery storage once every earlier read and ordered write settles. */
  function closeRecoveryStoreWhenIdle() {
    void Promise.allSettled([draftLoad, draftWrites]).then(() => {
      if (recoveryStoreClosed) return;
      recoveryStoreClosed = true;
      recoveryStore.close?.();
    });
  }

  /** Persists one immutable command selected by the shared history queue. */
  async function persistCommand(command, direction) {
    if (destroyed) return { status: 499, cancelled: true };
    const generation = authorityGeneration;
    if (failedSave) {
      saveBarrier ??= {};
      saveBarrier.promise ??= new Promise((resolve) => { saveBarrier.resolve = resolve; });
      await saveBarrier.promise;
      if (generation !== authorityGeneration) return { status: 499, cancelled: true };
    }
    const state = command[direction];
    const commandWorld = state.get("world");
    const currentHashes = Object.fromEntries([["@root", world.rootShard?.hash ?? null], ...world.areas.map((node) => [node.key, node.shard.hash ?? null])]);
    applyHashes(commandWorld, currentHashes); applyRevision(commandWorld, world);
    const changedAreas = new Set(state.get("changedAreas") ?? []);
    const changedOwners = new Set(state.get("changedOwners") ?? []);
    save = { state: "saving", result: null }; notify("saving");
    const saveStartedAt = performance.now();
    recordEvent("area_map_save", { gestureId: command.id, gestureKind: command.kind, phase: "started", saveState: "saving", shardCount: changedOwners.size, affectedCount: changedAreas.size + changedOwners.size, pendingCount: worldHistory.state.queue.length });
    try {
      const result = await persistWorld?.(clone(commandWorld), changedAreas, changedOwners, command, direction) ?? {};
      if (generation !== authorityGeneration) return { status: 499, cancelled: true };
      if (result?.error || result?.status === 409 || result?.status >= 400) {
        save = { state: failureSaveState(result), result };
        failedSave = { command: clone(command), direction };
        storeDraft(result);
        recordEvent("area_map_save", { operationId: result.operationId, gestureId: command.id, gestureKind: command.kind, phase: "failed", saveState: save.state, status: Number(result.status ?? 0), failureKind: failureKind(result), retryable: result.retryable === true, shardCount: changedOwners.size, affectedCount: changedAreas.size + changedOwners.size, pendingCount: worldHistory.state.queue.length, duration: performance.now() - saveStartedAt });
        return result;
      }
      applyHashes(world, result.hashes ?? {});
      applyRevision(world, result);
      const commands = [...worldHistory.state.undo, ...worldHistory.state.redo, ...worldHistory.state.queue.map((item) => item.command)];
      for (const item of commands) for (const value of [item.before.get("world"), item.after.get("world")]) {
        applyHashes(value, result.hashes); applyRevision(value, result);
      }
      failedSave = null;
      const hasLater = Boolean(gesture || worldHistory.state.open || recoveryQueue.length || worldHistory.state.queue.length || worldHistory.state.active && worldHistory.state.active.command?.id !== command.id);
      if (!hasLater && !draftOffered) clearDraft({ operationId: result.operationId, gestureId: command.id });
      saveBarrier?.resolve?.(); saveBarrier = null;
      save = { state: hasLater ? "dirty" : "saved", result };
      recordEvent("area_map_save", { operationId: result.operationId, gestureId: command.id, gestureKind: command.kind, phase: "acknowledged", outcome: "saved", saveState: save.state, status: Number(result.status ?? 200), idempotent: result.idempotent === true, shardCount: changedOwners.size, affectedCount: changedAreas.size + changedOwners.size, pendingCount: worldHistory.state.queue.length, duration: performance.now() - saveStartedAt, worldRevision: result.worldRevision, treeRevision: result.treeRevision });
      return result;
    } catch (error) {
      if (generation !== authorityGeneration) return { status: 499, cancelled: true };
      const result = { ...(error?.payload ?? {}), status: Number(error?.status ?? error?.payload?.status ?? 503), error: String(error?.message ?? error) };
      save = { state: failureSaveState(result), result };
      failedSave = { command: clone(command), direction };
      storeDraft(result);
      recordEvent("area_map_save", { operationId: result.operationId, gestureId: command.id, gestureKind: command.kind, phase: "failed", saveState: save.state, status: result.status, failureKind: failureKind(result), retryable: result.retryable === true, shardCount: changedOwners.size, affectedCount: changedAreas.size + changedOwners.size, pendingCount: worldHistory.state.queue.length, duration: performance.now() - saveStartedAt });
      return result;
    } finally {
      notify("save-result");
      if (treeRefreshRequested) setTimeout(() => { void reconcileTree(); }, 0);
    }
  }

  /** Rebuilds derived geometry from one authoritative world. */
  function install(nextWorld, reason = "world") {
    world = clone(nextWorld);
    composition = worldCore.composeAreaMapWorld(world);
    updateSemanticDetail();
    notify(reason);
  }

  /** Reports whether an authored command must settle before authority can change. */
  function hasPendingAuthoredWork() {
    return Boolean(gesture || failedSave || worldHistory?.state.open || worldHistory?.state.active
      || worldHistory?.state.queue.length || worldHistory?.state.scheduled
      || ["dirty", "saving", "blocked", "conflict"].includes(save.state));
  }

  /** Keeps already-loaded unchanged shards when a structural poll returns a new tree. */
  function retainLoadedShards(fresh) {
    for (const node of fresh.areas ?? []) {
      const previous = world.areas.find((entry) => entry.key === node.key);
      const revisionsMatch = node.shard?.revision && previous?.shard?.revision
        ? node.shard.revision === previous.shard.revision
        : node.shard?.hash !== null && node.shard?.hash !== undefined && node.shard.hash === previous?.shard?.hash;
      if (node.shard?.state !== "deferred" || !previous?.shard?.scene || !revisionsMatch) continue;
      node.shard = { ...node.shard, state: previous.shard.state, scene: clone(previous.shard.scene) };
    }
    return fresh;
  }

  /** Returns the same Area or its nearest surviving ancestor in one fresh tree. */
  function survivingArea(area, fresh, fallback = fresh.locatedArea) {
    const keys = new Set((fresh.areas ?? []).map((node) => node.key));
    let candidate = area;
    while (candidate && !keys.has(candidate)) candidate = candidate.includes("/") ? candidate.slice(0, candidate.lastIndexOf("/")) : "";
    return candidate || (keys.has(fallback) ? fallback : fresh.areas?.[0]?.key ?? null);
  }

  /** Installs a changed Area tree without replacing the controller or private view. */
  function installTreeRevision(nextWorld) {
    const fresh = retainLoadedShards(clone(nextWorld));
    const selectedAreas = new Set([...selection].map((id) => composition.scene.elements.find((element) => element.id === id)?.customData?.tangent?.area).filter(Boolean));
    const selectedOrigins = [...selection].map((id) => composition.origins.get(id)).filter((origin) => origin && !origin.regionKey);
    locatedArea = survivingArea(locatedArea, fresh);
    cameraTarget = survivingArea(cameraTarget, fresh, locatedArea);
    if (restrictionArea) restrictionArea = survivingArea(restrictionArea, fresh, locatedArea);
    cameraTrail = cameraTrail.map((area) => survivingArea(area, fresh, locatedArea)).filter((area, index, values) => area && values.indexOf(area) === index && area !== cameraTarget);
    const keys = new Set(fresh.areas.map((node) => node.key));
    folded = new Set([...folded].filter((area) => keys.has(area)));
    detailAreas = new Set([...detailAreas].filter((area) => keys.has(area)));
    worldHistory.state.undo.length = 0; worldHistory.state.redo.length = 0; worldHistory.state.queue.length = 0; worldHistory.state.open = null;
    authorityGeneration += 1;
    world = fresh;
    composition = worldCore.composeAreaMapWorld(world);
    const runtimeIds = new Set(composition.scene.elements.map((element) => element.id));
    selection = new Set([
      ...[...selectedAreas].map((area) => regionElement(area)?.id).filter(Boolean),
      ...selectedOrigins.map((origin) => worldCore.runtimeId(origin.owner, origin.sourceId)).filter((id) => runtimeIds.has(id)),
    ]);
    updateSemanticDetail();
    recordEvent("area_map_tree_reconciled", { treeRevision: world.treeRevision, areaCount: world.areas.length, selectedCount: selection.size });
    onNavigation?.({ area: locatedArea, trail: [...cameraTrail], nextEscape: snapshot().nextEscape });
    notify("tree-reconciled");
  }

  /** Starts one pointer or text command boundary. */
  function beginGesture(kind = "pointer") {
    if (!gesture) {
      const gestureId = worldHistory.begin(kind, historyState(world), [...selection]);
      gesture = { id: gestureId, kind, startedAt: performance.now(), before: clone(world), changedAreas: new Set(), changedOwners: new Set() };
      recordEvent("area_map_gesture", { gestureId, gestureKind: kind, phase: "started", selectedCount: selection.size });
    }
    return clone(gesture.before);
  }

  /** Applies a preview without creating history or starting a save. */
  function preview(nextWorld, { changedAreas = [], changedOwners = [] } = {}) {
    if (!gesture) beginGesture();
    for (const area of changedAreas) gesture.changedAreas.add(area);
    for (const owner of changedOwners) gesture.changedOwners.add(owner);
    worldHistory.state.open.before.set("changedAreas", [...gesture.changedAreas].sort());
    worldHistory.state.open.before.set("changedOwners", [...gesture.changedOwners].sort());
    if (!failedSave) save = { state: "dirty", result: null };
    install(nextWorld, "preview");
    worldHistory.update(historyState(world, gesture.changedAreas, gesture.changedOwners), [...selection]);
  }

  /** Ends one gesture as exactly one world command. */
  function endGesture(kind = gesture?.kind ?? "pointer") {
    if (!gesture) return null;
    const current = gesture; gesture = null;
    if (same(current.before, world)) {
      worldHistory.state.open = null;
      if (!failedSave && !worldHistory.state.active && !worldHistory.state.queue.length) save = { state: "saved", result: save.result };
      recordEvent("area_map_gesture", { gestureId: current.id, gestureKind: kind, phase: "finished", outcome: "unchanged", affectedCount: 0, duration: performance.now() - current.startedAt });
      notify("gesture-unchanged");
      return null;
    }
    const command = worldHistory.finish(historyState(world, current.changedAreas, current.changedOwners), [...selection]);
    if (command) {
      if (failedSave) storeDraft(save.result);
      else save = { state: "dirty", result: null };
      notify(failedSave ? "recovery-dirty" : "dirty");
    }
    recordEvent("area_map_gesture", { gestureId: current.id, gestureKind: kind, phase: "finished", outcome: command ? "queued" : "unchanged", affectedCount: current.changedAreas.size + current.changedOwners.size, pendingCount: worldHistory.state.queue.length, duration: performance.now() - current.startedAt });
    if (treeRefreshRequested) setTimeout(() => { void reconcileTree(); }, 0);
    return command;
  }

  /** Applies a non-pointer edit as one complete command. */
  function commitWorld(nextWorld, changes = {}, kind = "edit") {
    const before = beginGesture(kind);
    preview(nextWorld, changes);
    return endGesture(kind) ?? before;
  }

  /** Selects one Area without changing the camera. */
  function selectArea(area) {
    if (!areaInScope(area)) return null;
    const element = regionElement(area);
    findRevealId = null;
    selection = new Set(element ? [element.id] : []);
    saveView();
    notify("selection");
    if (element) void prioritizeLoads(area, { includeDescendants: false, requireSelectedDeferred: true });
    return element;
  }

  /** Synchronizes selection from Excalidraw without entering history. */
  function setSelection(ids = []) {
    const selectable = new Set(projectedScene.elements.filter((element) => !element.isDeleted).map((element) => element.id));
    const next = new Set([...ids].filter((id) => selectable.has(id)));
    if (same([...selection].sort(), [...next].sort())) return;
    selection = next; saveView(); notify("selection");
  }

  /** Shows one otherwise masked block while it is the current find match. */
  function setFindReveal(id = null) {
    const next = id || null;
    if (findRevealId === next) return false;
    findRevealId = next; notify("find-reveal"); return true;
  }

  /** Fits a camera target and records only a session-local return step. */
  function fitArea(area, { push = true, select = true } = {}) {
    if (!areaInScope(area)) return null;
    const element = regionElement(area);
    if (!element) return null;
    if (push && cameraTarget && cameraTarget !== area) cameraTrail = [...cameraTrail, cameraTarget];
    cameraTarget = area; locatedArea = area;
    if (select) selection = new Set([element.id]);
    saveView();
    onNavigation?.({ area, trail: [...cameraTrail], nextEscape: snapshot().nextEscape });
    notify("camera-target");
    void prioritizeLoads(area, { nearbyCount: 0 });
    return element;
  }

  /** Turns the temporary ancestor-and-descendant restriction on or off. */
  function setRestriction(area = null) {
    if (area && !regionElement(area)) return { active: Boolean(restrictionArea), area: restrictionArea, excludedCount: world.areas.length - scopedAreas().size };
    restrictionArea = area || null;
    selection = new Set(); findRevealId = null;
    if (restrictionArea) {
      const element = fitArea(restrictionArea, { push: false, select: false });
      return { active: true, area: restrictionArea, excludedCount: world.areas.length - scopedAreas().size, element };
    }
    notify("restriction");
    return { active: false, area: null, excludedCount: 0, element: null };
  }

  /** Toggles Only for an explicit selected or located Area. */
  function toggleRestriction(area = locatedArea) {
    return setRestriction(restrictionArea === area ? null : area);
  }

  /** Navigates inside the current projection without changing its restriction. */
  function navigateArea(area, { push = true, select = false } = {}) {
    if (!select) selection = new Set();
    findRevealId = null;
    return fitArea(area, { push, select });
  }

  /** Unwinds selection and camera history without changing Only. */
  function escape() {
    if (selection.size) { selection = new Set(); findRevealId = null; saveView(); notify("selection"); return { kind: "selection" }; }
    if (cameraTrail.length) {
      const area = cameraTrail.at(-1); cameraTrail = cameraTrail.slice(0, -1);
      const element = fitArea(area, { push: false, select: false });
      return { kind: "camera", area, element };
    }
    onBack?.();
    return { kind: "work" };
  }

  /** Changes fold as private view state. */
  function toggleFold(area) {
    if (restrictionArea && restrictionArea.startsWith(`${area}/`)) return null;
    const next = new Set(folded); if (next.has(area)) next.delete(area); else next.add(area);
    folded = next; saveView(); notify("fold"); return folded.has(area);
  }

  /** Changes Focus as a render mask only. */
  function setFocus(next) { focus = clone(next ?? {}); notify("focus"); }

  /** Stores camera state and refreshes semantic zoom without changing authority. */
  function setCamera(next = {}) {
    const candidate = { scrollX: Number(next.scrollX ?? camera.scrollX), scrollY: Number(next.scrollY ?? camera.scrollY), zoom: Number(next.zoom ?? camera.zoom) || 1 };
    if (["scrollX", "scrollY", "zoom"].every((field) => Math.abs(candidate[field] - camera[field]) < 0.0001)) return;
    camera = candidate;
    updateSemanticDetail(); saveView(); notify("camera");
  }

  /** Captures every private Map view property needed for an exact temporary return. */
  function captureView() {
    return clone({ camera, locatedArea, cameraTarget, cameraTrail, restrictionArea, selection: [...selection], findRevealId });
  }

  /** Restores one private Map view without changing authored world authority or history. */
  function restoreView(value = {}) {
    const areaKeys = new Set(world.areas.map((node) => node.key));
    const elementIds = new Set(composition.scene.elements.map((element) => element.id));
    camera = {
      scrollX: Number(value.camera?.scrollX ?? camera.scrollX),
      scrollY: Number(value.camera?.scrollY ?? camera.scrollY),
      zoom: Number(value.camera?.zoom ?? camera.zoom) || 1,
    };
    locatedArea = areaKeys.has(value.locatedArea) ? value.locatedArea : locatedArea;
    cameraTarget = areaKeys.has(value.cameraTarget) ? value.cameraTarget : locatedArea;
    cameraTrail = (value.cameraTrail ?? []).filter((area, index, values) => areaKeys.has(area) && area !== cameraTarget && values.indexOf(area) === index);
    restrictionArea = value.restrictionArea && areaKeys.has(value.restrictionArea) ? value.restrictionArea : null;
    selection = new Set((value.selection ?? []).filter((id) => elementIds.has(id)));
    findRevealId = value.findRevealId && elementIds.has(value.findRevealId) ? value.findRevealId : null;
    updateSemanticDetail(); saveView();
    onNavigation?.({ area: locatedArea, trail: [...cameraTrail], nextEscape: snapshot().nextEscape });
    notify("view-restored");
    return snapshot("view-restored");
  }

  /** Materializes one deferred shard in the existing world. A missing shard outside the eager set has no scene either; loading it supplies the projected empty scene so a nested Area with no Map file yet can still receive Blocks. */
  function materialize(area) {
    if (inFlightLoads.has(area)) return inFlightLoads.get(area);
    const node = world.areas.find((entry) => entry.key === area);
    const loadable = ["deferred", "load-error"].includes(node?.shard?.state) || (node?.shard?.state === "missing" && !node.shard.scene);
    if (!node || !loadable || !loadShard) return Promise.resolve(node?.shard ?? null);
    const task = (async () => {
      const startedAt = performance.now();
      const generation = authorityGeneration; const requestedRevision = world.worldRevision;
      node.shard = { ...node.shard, state: "loading" }; install(world, "loading");
      try {
        const loaded = await loadShard(area, { locatedArea, worldRevision: world.worldRevision });
        if (generation !== authorityGeneration || requestedRevision !== world.worldRevision) return world.areas.find((entry) => entry.key === area)?.shard ?? null;
        if (loaded?.worldRevision !== world.worldRevision || !["ready", "missing"].includes(loaded?.state)) throw new Error(loaded?.error || "map world changed");
        const current = world.areas.find((entry) => entry.key === area);
        current.shard = { ...current.shard, ...loaded };
        install(world, "loaded"); recordEvent("area_map_shard_loaded", { worldRevision: world.worldRevision, shardRevision: current.shard.revision ?? current.shard.hash, shardState: current.shard.state, bytes: JSON.stringify(loaded).length, duration: performance.now() - startedAt }); return current.shard;
      } catch (error) {
        if (generation !== authorityGeneration || requestedRevision !== world.worldRevision) return world.areas.find((entry) => entry.key === area)?.shard ?? null;
        const current = world.areas.find((entry) => entry.key === area);
        current.shard = { ...current.shard, state: "load-error", errors: [String(error?.message ?? error)] };
        install(world, "load-error"); recordEvent("area_map_shard_loaded", { worldRevision: world.worldRevision, shardState: "load-error", failureKind: "load", bytes: 0, duration: performance.now() - startedAt }); return current.shard;
      }
    })();
    inFlightLoads.set(area, task);
    void task.finally(() => { if (inFlightLoads.get(area) === task) inFlightLoads.delete(area); });
    return task;
  }

  /** Starts deferred reads in selected, descendant, then nearby priority order. */
  function prioritizeLoads(area, options = {}) {
    const plan = areaMapDeferredLoadPlan(world, composition, area, options);
    return Promise.all(plan.map((owner) => materialize(owner)));
  }

  /**
   * Reconciles a changed Area tree after local authored work reaches authority. A fact poll
   * reloads at most once per `treePollInterval`, because the shell polls on every server event and
   * a busy machine polls many times a second; a save or a finished gesture reconciles at once. A
   * skipped poll leaves the request standing, so the next save or gesture still reconciles.
   */
  async function reconcileTree({ polled = false } = {}) {
    treeRefreshRequested = true;
    if (treeRefresh) return treeRefresh;
    if (!reloadWorld || hasPendingAuthoredWork()) return false;
    if (polled && treeReloadFinishedAt !== null && performance.now() - treeReloadFinishedAt < treePollInterval) return false;
    treeRefreshRequested = false;
    const expectedWorldId = world.worldId;
    treeRefresh = (async () => {
      try {
        const fresh = await reloadWorld({ locatedArea, owners: [] });
        if (destroyed) return false;
        if (!fresh?.worldId || fresh.worldId !== expectedWorldId) throw new Error("The current Area-map world is unavailable");
        if (hasPendingAuthoredWork()) { treeRefreshRequested = true; return false; }
        if (fresh.treeRevision === world.treeRevision) return false;
        installTreeRevision(fresh);
        return true;
      } catch (error) {
        recordEvent("area_map_tree_refresh_failed", { failureKind: "refresh" });
        notify("tree-refresh-failed");
        return false;
      } finally {
        treeReloadFinishedAt = performance.now();
        treeRefresh = null;
      }
    })();
    return treeRefresh;
  }

  /** Repaints current facts and checks structural authority without remounting. */
  function refreshFacts(nextFocus = focus) {
    focus = clone(nextFocus ?? {}); factsRevision += 1; notify("facts");
    return reconcileTree({ polled: true });
  }

  /**
   * Installs the Map kinds definition Julian owns. A changed revision repaints
   * every fact and drops the drawn-figure cache; the same revision is a no-op,
   * so the resource cadence can re-read the catalog freely.
   */
  function setMapKinds(catalog) {
    if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.kinds)) return false;
    if (mapKinds && mapKinds.revision === catalog.revision) return false;
    mapKinds = clone(catalog);
    figures = { kinds: new Map(mapKinds.kinds.map((entry) => [entry.id, entry])), icons: mapKinds.icons ?? {} };
    figureCache.clear();
    factsRevision += 1;
    notify("map-kinds");
    return true;
  }

  /** Installs current resource read facts without changing world or Map history authority. */
  function setResourceResolutions(values = [], { replace = false } = {}) {
    if (!Array.isArray(values)) return false;
    const next = replace ? new Map() : new Map(resourceResolutions);
    for (const resolution of values) {
      const locator = resolution?.value?.locator ?? resolution?.locator;
      const key = resourceLocatorKey(locator);
      if (key) next.set(key, clone(resolution));
    }
    if (same([...next], [...resourceResolutions])) return false;
    resourceResolutions = next;
    factsRevision += 1;
    notify("resource-facts");
    return true;
  }

  /** Parses one trusted transaction source update without accepting a partial scene. */
  function sourceUpdateScene(update) {
    let scene;
    try { scene = JSON.parse(String(update?.serializedSource ?? "")); }
    catch { throw Object.assign(new Error("A resource transaction returned an invalid Map source."), { code: "resource-source-invalid" }); }
    if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements) || typeof update?.owner !== "string" || !update.owner) {
      throw Object.assign(new Error("A resource transaction returned an invalid Map source."), { code: "resource-source-invalid" });
    }
    return scene;
  }

  /** Applies only changed Tangent metadata to one historical world snapshot. */
  function rebaseResourceSemantics(target, owner, changes, update) {
    const node = target?.areas?.find((entry) => entry.key === owner);
    if (!node?.shard?.scene) return;
    for (const [sourceId, tangent] of changes) {
      const element = node.shard.scene.elements.find((candidate) => candidate.id === sourceId);
      if (!element) continue;
      element.customData = { ...(element.customData ?? {}), tangent: clone(tangent) };
    }
    node.shard.hash = update.hash;
    node.shard.revision = update.hash;
    if (update.treeRevision) target.treeRevision = update.treeRevision;
    if (update.worldRevision) target.worldRevision = update.worldRevision;
  }

  /** Returns every retained command whose snapshots can later become source authority. */
  function retainedHistoryCommands() {
    const items = [
      ...(worldHistory?.state.undo ?? []),
      ...(worldHistory?.state.redo ?? []),
      worldHistory?.state.open,
      worldHistory?.state.active?.command,
      ...(worldHistory?.state.queue ?? []).map((item) => item.command),
      failedSave?.command,
      ...recoveryQueue.map((item) => item.command),
    ].filter(Boolean);
    return [...new Map(items.map((command) => [command.id, command])).values()];
  }

  /** Installs scene-coupled transaction authority without a Map history entry. */
  function installResourceSourceUpdates(updates = []) {
    if (!Array.isArray(updates) || !updates.length) return false;
    if (hasPendingAuthoredWork()) {
      throw Object.assign(new Error("Save or recover the current Map change before changing resource authority."), {
        code: "resource-representation-conflict",
      });
    }
    const next = clone(world);
    const prepared = updates.map((update) => {
      const node = next.areas.find((entry) => entry.key === update?.owner);
      if (!node?.shard?.scene || typeof update?.hash !== "string" || !update.hash) {
        throw Object.assign(new Error("A resource transaction returned an unknown Map source."), { code: "resource-source-invalid" });
      }
      const scene = sourceUpdateScene(update);
      const previous = new Map(node.shard.scene.elements.map((element) => [element.id, element.customData?.tangent ?? null]));
      const changes = new Map(scene.elements.flatMap((element) => {
        const before = previous.get(element.id) ?? null;
        const after = element.customData?.tangent ?? null;
        return same(before, after) ? [] : [[element.id, after]];
      }));
      if (!changes.size) throw Object.assign(new Error("A resource transaction returned no semantic Map change."), { code: "resource-source-invalid" });
      node.shard = { ...node.shard, state: "ready", hash: update.hash, revision: update.hash, scene };
      return { update, changes };
    });
    const revisions = new Set(prepared.map(({ update }) => `${update.treeRevision ?? ""}\0${update.worldRevision ?? ""}`));
    if (revisions.size !== 1) throw Object.assign(new Error("A resource transaction returned inconsistent Map revisions."), { code: "resource-source-invalid" });
    const final = prepared.at(-1)?.update;
    if (final?.treeRevision) next.treeRevision = final.treeRevision;
    if (final?.worldRevision) next.worldRevision = final.worldRevision;
    for (const command of retainedHistoryCommands()) for (const state of [command.before, command.after]) {
      const historical = state?.get?.("world");
      for (const { update, changes } of prepared) rebaseResourceSemantics(historical, update.owner, changes, update);
    }
    install(next, "resource-source-update");
    return true;
  }

  /** Retries an ordered failed save. */
  async function retry() {
    if (!failedSave && !recoveryQueue.length) return worldHistory.flush();
    const pending = [failedSave, ...recoveryQueue].filter(Boolean); failedSave = null; recoveryQueue = [];
    save = { state: "dirty", result: null }; notify("retry");
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index]; recoveryQueue = pending.slice(index + 1);
      recordEvent("area_map_retry", { gestureId: item.command?.id, phase: "started", retryAttempt: index + 1, pendingCount: pending.length - index });
      const result = await persistCommand(item.command, item.direction);
      if (result?.error || result?.status >= 400) {
        recordEvent("area_map_retry", { operationId: result?.operationId, gestureId: item.command?.id, phase: "failed", retryAttempt: index + 1, pendingCount: pending.length - index, status: Number(result?.status ?? 0), failureKind: failureKind(result), retryable: result?.retryable === true });
        return result;
      }
      recordEvent("area_map_retry", { operationId: result?.operationId, gestureId: item.command?.id, phase: "acknowledged", outcome: "saved", retryAttempt: index + 1, pendingCount: pending.length - index - 1, status: Number(result?.status ?? 200) });
    }
    return save.result;
  }

  /** Loads current authority and clears authored history while preserving the private view. */
  async function reload(nextWorld = null) {
    const fresh = clone(nextWorld ?? await reloadWorld?.({ locatedArea, owners: [] }));
    if (!fresh?.worldId) throw new Error("The current Area-map world is unavailable");
    retainLoadedShards(fresh);
    locatedArea = survivingArea(locatedArea, fresh);
    cameraTarget = survivingArea(cameraTarget, fresh, locatedArea);
    if (restrictionArea) restrictionArea = survivingArea(restrictionArea, fresh, locatedArea);
    cameraTrail = cameraTrail.map((area) => survivingArea(area, fresh, locatedArea)).filter((area, index, values) => area && values.indexOf(area) === index && area !== cameraTarget);
    const keys = new Set(fresh.areas.map((node) => node.key));
    folded = new Set([...folded].filter((area) => keys.has(area)));
    detailAreas = new Set([...detailAreas].filter((area) => keys.has(area)));
    worldHistory.state.undo.length = 0; worldHistory.state.redo.length = 0; worldHistory.state.queue.length = 0; worldHistory.state.open = null;
    const retainedSelection = [...selection];
    authorityGeneration += 1; gesture = null; failedSave = null; saveBarrier?.resolve?.(); saveBarrier = null; save = { state: "saved", result: null };
    recoveryQueue = []; clearDraft(); install(fresh, "reload");
    const elementIds = new Set(composition.scene.elements.map((element) => element.id));
    selection = new Set(retainedSelection.filter((id) => elementIds.has(id)));
    saveView(); notify("reload-selection");
    onNavigation?.({ area: locatedArea, trail: [...cameraTrail], nextEscape: snapshot().nextEscape });
    return clone(world);
  }

  /** Rebases local source-ID changes over current shards, then submits a new operation. */
  async function keepMine() {
    if (!failedSave) return null;
    if (save.state === "blocked") {
      storeDraft(save.result);
      await draftWrites;
      const result = { ...(save.result ?? {}), retained: true };
      save = { state: "blocked", result };
      notify("draft-kept");
      recordEvent("area_map_draft", { phase: "kept", draftState: "active", pendingCount: recoveryQueue.length + 1, status: Number(result.status ?? 0), failureKind: failureKind(result), ...draftCorrelation(draft) });
      return result;
    }
    if (save.state !== "conflict" || !reloadWorld) return null;
    const pending = failedSave;
    const mineState = pending.command[pending.direction];
    const baseState = pending.command[pending.direction === "after" ? "before" : "after"];
    const mine = mineState.get("world"); const base = baseState.get("world");
    const changedAreas = new Set(mineState.get("changedAreas") ?? []);
    const changedOwners = new Set(mineState.get("changedOwners") ?? []);
    save = { state: "saving", result: null }; notify("rebase-loading");
    try {
      const current = await reloadWorld({ locatedArea, owners: [...changedOwners] });
      if (!current?.worldId || current.worldId !== mine.worldId) throw Object.assign(new Error("The Area-map world changed"), { status: 409 });
      /** Returns one Area-owned scene from a world snapshot. */
      const byOwner = (value, owner) => value.areas.find((node) => node.key === owner)?.shard.scene;
      const baseByOwner = new Map([...changedOwners].map((owner) => [owner, byOwner(base, owner)]));
      const mineByOwner = new Map([...changedOwners].map((owner) => [owner, byOwner(mine, owner)]));
      const currentByOwner = new Map([...changedOwners].map((owner) => [owner, byOwner(current, owner)]));
      const rebasedScenes = rebaseAreaMapOwners({ baseByOwner, mineByOwner, currentByOwner });
      const rebased = clone(current);
      for (const [owner, scene] of rebasedScenes) rebased.areas.find((node) => node.key === owner).shard.scene = scene;
      for (const area of changedAreas) {
        const mineNode = mine.areas.find((node) => node.key === area);
        const currentNode = rebased.areas.find((node) => node.key === area);
        if (!mineNode || !currentNode || mineNode.parent !== currentNode.parent || mineNode.region.sourceId !== currentNode.region.sourceId) throw Object.assign(new Error(`${area} changed parent`), { status: 409 });
        currentNode.region = clone(mineNode.region);
      }
      const rebasedCommand = {
        ...clone(pending.command), id: crypto.randomUUID(), kind: "conflict-rebase", operationIds: {},
        before: historyState(current, changedAreas, changedOwners),
        after: historyState(rebased, changedAreas, changedOwners),
      };
      failedSave = null; install(rebased, "rebased");
      const result = await persistCommand(rebasedCommand, "after");
      if (!result?.error && result?.status < 400 && recoveryQueue.length) return retry();
      return result;
    } catch (error) {
      const result = { status: Number(error?.status ?? 503), error: String(error?.message ?? error) };
      failedSave = pending; save = { state: failureSaveState(result), result }; notify("rebase-failed");
      return result;
    }
  }

  /** Restores the offered draft in memory without writing it. */
  function restoreDraft() {
    if (!draft?.world) return false;
    install(draft.world, "draft-restored"); locatedArea = world.areas.some((node) => node.key === draft.locatedArea) ? draft.locatedArea : locatedArea;
    worldHistory.state.undo.splice(0, worldHistory.state.undo.length, ...(clone(draft.history?.undo ?? [])));
    worldHistory.state.redo.splice(0, worldHistory.state.redo.length, ...(clone(draft.history?.redo ?? [])));
    const pending = clone(draft.pending ?? []); failedSave = pending.shift() ?? null; recoveryQueue = pending;
    draft = { ...draft, restored: true }; draftOffered = false;
    const result = { ...(draft.failure ?? {}), status: Number(draft.status ?? draft.failure?.status ?? 0), draft: true };
    save = { state: failureSaveState(result), result }; notify("draft-ready");
    recordEvent("area_map_draft", { phase: "restored", draftState: "active", pendingCount: pending.length + Boolean(failedSave), status: result.status, failureKind: failureKind(result), ...draftCorrelation(draft) });
    return true;
  }

  /** Discards the offered draft only on Julian's explicit act. */
  function discardDraft() {
    const pendingCount = draft?.pending?.length ?? 0;
    const correlation = draftCorrelation(draft);
    clearDraft(correlation); recoveryQueue = []; notify("draft-discarded");
    recordEvent("area_map_draft", { phase: "discarded", draftState: "none", pendingCount, ...correlation });
  }

  updateSemanticDetail();
  project();
  recordEvent("area_map_world_loaded", {
    worldRevision: world.worldRevision,
    areaCount: world.areas.length,
    eagerShards: world.areas.filter((node) => node.shard.scene).length,
    bytes: JSON.stringify(world).length,
    usableTime: performance.now() - worldLoadStarted,
    completeTime: performance.now() - worldLoadStarted,
  });
  worldHistory = createAreaMapWorldHistory({
    /** Applies undo and redo snapshots without involving Excalidraw history. */
    apply(state, selected) {
      install(state.get("world"), "history"); selection = new Set(selected); notify("selection");
    },
    save: persistCommand,
  });
  const loadEpoch = draftEpoch;
  draftLoad = Promise.resolve(recoveryStore.load(world.worldId)).then((record) => {
    if (destroyed || draftEpoch !== loadEpoch || record?.schema !== DRAFT_SCHEMA || record.worldId !== world.worldId) return;
    draft = record; draftOffered = true; notify("draft-found");
    recordEvent("area_map_draft", { phase: "found", draftState: "available", pendingCount: record.pending?.length ?? 0, status: Number(record.status ?? 0), failureKind: failureKind(record.failure), ...draftCorrelation(record) });
  }).catch(() => { recordEvent("area_map_draft", { phase: "failed", draftState: "unavailable", pendingCount: 0, failureKind: "storage" }); });

  return {
    /** Subscribes to immutable controller snapshots. */
    subscribe(listener) { listeners.add(listener); listener(snapshot("subscribe")); return () => listeners.delete(listener); },
    snapshot,
    /** Returns an immutable copy of current world authority. */
    world: () => clone(world),
    /** Returns the current composed runtime scene and origins. */
    composition: () => composition,
    beginGesture, preview, endGesture, commitWorld,
    /** Undoes one map-owned command word. */
    undo: () => {
      const changed = worldHistory.undo();
      if (changed && failedSave) storeDraft(save.result);
      return changed;
    },
    /** Redoes one map-owned command word. */
    redo: () => {
      const changed = worldHistory.redo();
      if (changed && failedSave) storeDraft(save.result);
      return changed;
    },
    selectArea, setSelection, setFindReveal, fitArea, navigateArea, setRestriction, toggleRestriction, escape, toggleFold, setFocus, setCamera, captureView, restoreView,
    materialize, prioritizeLoads, refreshFacts, setMapKinds, setResourceResolutions, installResourceSourceUpdates,
    /** Drains durable work, but never waits for a user Retry decision after a failed save. */
    async flush() {
      while (worldHistory.state.scheduled || worldHistory.state.active || worldHistory.state.queue.length) {
        if (failedSave) {
          await draftWrites;
          return save.result;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await draftWrites;
      return save.result;
    },
    retry, reload, keepMine, restoreDraft, discardDraft, recordEvent,
    /** Releases timers and subscribers. */
    destroy() {
      destroyed = true; authorityGeneration += 1; saveBarrier?.resolve?.(); saveBarrier = null; listeners.clear();
      if (viewTimer !== null) clearTimeout(viewTimer);
      if (pendingView && persistView) Promise.resolve(persistView(pendingView)).catch(() => {});
      viewTimer = null; pendingView = null; closeRecoveryStoreWhenIdle();
    },
  };
}

export default { createAreaMapWorldController };
