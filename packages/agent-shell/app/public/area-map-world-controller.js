import boardCore from "./area-board-core.js";
import worldCore from "./area-map-world-core.js";
import { createAreaMapWorldHistory } from "./area-map-world-history.js";
import { rebaseAreaMapOwners } from "./area-map-world-conflict.js";
import { createAreaMapWorldDraftStore } from "./area-map-world-draft-store.js";

const VIEW_SCHEMA = "area-map-view.v2";
const DRAFT_SCHEMA = "area-map-draft.v1";
const DETAIL_ENTER_PX = 96;
const DETAIL_LEAVE_PX = 72;

/** Makes an immutable controller-boundary copy. */
const clone = (value) => structuredClone(value);
/** Compares small serializable controller values. */
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
/** Returns the visible leaf name of one Area key. */
const leaf = (area) => String(area ?? "").split("/").at(-1) || "Area";
/** Returns the local fallback view key for one stable world. */
const viewKey = (worldId) => `tangent.area-map-view.v2:${worldId}`;

/** Selects source ownership for one new runtime element at an explicit command boundary. */
export function ownerForNewAreaMapElement({ copiedOwner = null, pasteOwner = null, startOwner = null, pointOwner = null } = {}) {
  return pasteOwner ?? copiedOwner ?? startOwner ?? pointOwner;
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
  let locatedArea = world.locatedArea;
  let cameraTarget = locatedArea;
  let cameraTrail = [];
  let selection = new Set();
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
  let authorityGeneration = 0;
  let viewTimer = null;
  let pendingView = null;
  let draft = null;
  let treeRefresh = null;
  let treeRefreshRequested = false;
  const recoveryStore = suppliedDraftStore ?? createAreaMapWorldDraftStore();

  /** Emits one coordinate-free structured client event. */
  function recordEvent(name, fields = {}) {
    try { onEvent?.({ name, at: Date.now(), ...clone(fields) }); } catch { /* Diagnostics never affect map authority. */ }
  }

  /** Returns the runtime region for one Area. */
  function regionElement(area) {
    return composition.scene.elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData?.tangent?.area === area) ?? null;
  }

  /** Reports whether fold hides one structural descendant. */
  function foldedAncestor(area, includeSelf = false) {
    return [...folded].find((root) => includeSelf ? area === root || area.startsWith(`${root}/`) : area.startsWith(`${root}/`)) ?? null;
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
    const scene = boardCore.refreshTangentFacts(clone(composition.scene), getDocuments()).scene;
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
        if (area === locatedArea) {
          element.strokeWidth = Math.max(3, Number(element.strokeWidth ?? 2));
          element.strokeColor = "#4c6ef5";
        }
        if (folded.has(area)) element.opacity = Math.min(Number(element.opacity ?? 100), 45);
        if (foldedAncestor(area)) hidden.add(element.id);
        continue;
      }
      const owner = element.customData?.tangentWorld?.owner;
      if (owner && (foldedAncestor(owner, true) || !detailAreas.has(owner))) {
        hidden.add(element.id);
        if (boardCore.tangentOf(element)) hiddenBlocks.add(element.id);
      }
      if (boardCore.tangentOf(element) && !boardCore.blockMatchesFocus(element, getDocuments(), focus, locatedArea)) {
        hidden.add(element.id); hiddenBlocks.add(element.id);
        for (const binding of element.boundElements ?? []) if (binding.type === "text") hidden.add(binding.id);
      }
    }
    for (const element of scene.elements) {
      if (element.type !== "arrow") continue;
      const endpointFolded = Object.values(element.customData?.tangentWorldEndpoints ?? {}).some((endpoint) => endpoint?.owner && foldedAncestor(endpoint.owner, true));
      if (endpointFolded || hiddenBlocks.has(element.startBinding?.elementId) || hiddenBlocks.has(element.endBinding?.elementId)) {
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
      world, composition, scene: projectedScene, hiddenIds,
      focus, folded, detailAreas, camera, locatedArea, cameraTarget, cameraTrail, viewRestored: Boolean(validView),
      selection, save, draft, dirtyOwners,
      nextEscape: selection.size ? "Esc clears selection" : cameraTrail.length ? `Esc → ${leaf(cameraTrail.at(-1))}` : "Esc → Work",
    };
  }

  /** Applies acknowledged hashes to every later immutable command snapshot. */
  function applyHashes(target, hashes = {}) {
    if (!target?.areas) return;
    for (const [owner, hash] of Object.entries(hashes)) {
      if (owner === "@root") { if (target.rootShard) target.rootShard.hash = hash; continue; }
      const node = target.areas.find((entry) => entry.key === owner);
      if (node) node.shard.hash = hash;
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
    Promise.resolve(recoveryStore.save(draft)).catch(() => {});
  }

  /** Clears private recovery after every required command is durable. */
  function clearDraft() { draft = null; Promise.resolve(recoveryStore.remove(world.worldId)).catch(() => {}); }

  /** Persists one immutable command selected by the shared history queue. */
  async function persistCommand(command, direction) {
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
    try {
      const result = await persistWorld?.(clone(commandWorld), changedAreas, changedOwners, command, direction) ?? {};
      if (generation !== authorityGeneration) return { status: 499, cancelled: true };
      if (result?.error || result?.status === 409 || result?.status >= 400) {
        save = { state: result?.status === 409 ? "conflict" : "blocked", result };
        failedSave = { command: clone(command), direction };
        storeDraft(result);
        return result;
      }
      applyHashes(world, result.hashes ?? {});
      applyRevision(world, result);
      const commands = [...worldHistory.state.undo, ...worldHistory.state.redo, ...worldHistory.state.queue.map((item) => item.command)];
      for (const item of commands) for (const value of [item.before.get("world"), item.after.get("world")]) {
        applyHashes(value, result.hashes); applyRevision(value, result);
      }
      failedSave = null;
      const hasLater = recoveryQueue.length || worldHistory.state.queue.length || worldHistory.state.active && worldHistory.state.active.command?.id !== command.id;
      if (!hasLater) clearDraft();
      saveBarrier?.resolve?.(); saveBarrier = null;
      save = { state: worldHistory.state.queue.length ? "dirty" : "saved", result };
      return result;
    } catch (error) {
      if (generation !== authorityGeneration) return { status: 499, cancelled: true };
      const result = { ...(error?.payload ?? {}), status: Number(error?.status ?? error?.payload?.status ?? 503), error: String(error?.message ?? error) };
      save = { state: result.status === 409 ? "conflict" : "blocked", result };
      failedSave = { command: clone(command), direction };
      storeDraft(result);
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
      if (node.shard?.state !== "deferred" || !previous?.shard?.scene || node.shard.hash !== previous.shard.hash) continue;
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
    onNavigation?.({ area: locatedArea, trail: [...cameraTrail], nextEscape: cameraTrail.length ? `Esc → ${leaf(cameraTrail.at(-1))}` : "Esc → Work" });
    notify("tree-reconciled");
  }

  /** Starts one pointer or text command boundary. */
  function beginGesture(kind = "pointer") {
    if (!gesture) {
      gesture = { kind, before: clone(world), changedAreas: new Set(), changedOwners: new Set() };
      worldHistory.begin(kind, historyState(world), [...selection]);
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
    install(nextWorld, "preview");
    worldHistory.update(historyState(world, gesture.changedAreas, gesture.changedOwners), [...selection]);
  }

  /** Ends one gesture as exactly one world command. */
  function endGesture(kind = gesture?.kind ?? "pointer") {
    if (!gesture) return null;
    const current = gesture; gesture = null;
    if (same(current.before, world)) { worldHistory.state.open = null; return null; }
    const command = worldHistory.finish(historyState(world, current.changedAreas, current.changedOwners), [...selection]);
    if (command) {
      if (failedSave) storeDraft(save.result);
      else save = { state: "dirty", result: null };
      notify(failedSave ? "recovery-dirty" : "dirty");
    }
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
    const element = regionElement(area);
    selection = new Set(element ? [element.id] : []);
    notify("selection");
    return element;
  }

  /** Synchronizes selection from Excalidraw without entering history. */
  function setSelection(ids = []) {
    const next = new Set(ids);
    if (same([...selection].sort(), [...next].sort())) return;
    selection = next; notify("selection");
  }

  /** Fits a camera target and records only a session-local return step. */
  function fitArea(area, { push = true, select = true } = {}) {
    const element = regionElement(area);
    if (!element) return null;
    if (push && cameraTarget && cameraTarget !== area) cameraTrail = [...cameraTrail, cameraTarget];
    cameraTarget = area; locatedArea = area;
    if (select) selection = new Set([element.id]);
    saveView();
    onNavigation?.({ area, trail: [...cameraTrail], nextEscape: cameraTrail.length ? `Esc → ${leaf(cameraTrail.at(-1))}` : "Esc → Work" });
    notify("camera-target");
    return element;
  }

  /** Unwinds selection, then camera history, then the Work parent. */
  function escape() {
    if (selection.size) { selection = new Set(); notify("selection"); return { kind: "selection" }; }
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

  /** Materializes one deferred shard in the existing world. */
  async function materialize(area) {
    const node = world.areas.find((entry) => entry.key === area);
    if (!node || !["deferred", "load-error"].includes(node.shard.state) || !loadShard) return node?.shard ?? null;
    const startedAt = performance.now();
    const generation = authorityGeneration; const requestedRevision = world.worldRevision;
    node.shard = { ...node.shard, state: "loading" }; install(world, "loading");
    try {
      const loaded = await loadShard(area, { locatedArea, worldRevision: world.worldRevision });
      if (generation !== authorityGeneration || requestedRevision !== world.worldRevision) return world.areas.find((entry) => entry.key === area)?.shard ?? null;
      if (loaded?.worldRevision !== world.worldRevision || !["ready", "missing"].includes(loaded?.state)) throw new Error(loaded?.error || "map world changed");
      const current = world.areas.find((entry) => entry.key === area);
      current.shard = { ...current.shard, ...loaded };
      install(world, "loaded"); recordEvent("area_map_shard_loaded", { owner: area, state: current.shard.state, bytes: JSON.stringify(loaded).length, duration: performance.now() - startedAt }); return current.shard;
    } catch (error) {
      if (generation !== authorityGeneration || requestedRevision !== world.worldRevision) return world.areas.find((entry) => entry.key === area)?.shard ?? null;
      const current = world.areas.find((entry) => entry.key === area);
      current.shard = { ...current.shard, state: "load-error", errors: [String(error?.message ?? error)] };
      install(world, "load-error"); recordEvent("area_map_shard_loaded", { owner: area, state: "load-error", bytes: 0, duration: performance.now() - startedAt }); return current.shard;
    }
  }

  /** Reconciles a changed Area tree after local authored work reaches authority. */
  async function reconcileTree() {
    treeRefreshRequested = true;
    if (treeRefresh) return treeRefresh;
    if (!reloadWorld || hasPendingAuthoredWork()) return false;
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
        recordEvent("area_map_tree_refresh_failed", { errorKind: error?.name ?? "Error" });
        notify("tree-refresh-failed");
        return false;
      } finally {
        treeRefresh = null;
      }
    })();
    return treeRefresh;
  }

  /** Repaints current facts and checks structural authority without remounting. */
  function refreshFacts(nextFocus = focus) {
    focus = clone(nextFocus ?? {}); factsRevision += 1; notify("facts");
    return reconcileTree();
  }

  /** Retries an ordered failed save. */
  async function retry() {
    if (!failedSave && !recoveryQueue.length) return worldHistory.flush();
    const pending = [failedSave, ...recoveryQueue].filter(Boolean); failedSave = null; recoveryQueue = [];
    save = { state: "dirty", result: null }; notify("retry");
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index]; recoveryQueue = pending.slice(index + 1);
      const result = await persistCommand(item.command, item.direction);
      if (result?.error || result?.status >= 400) { storeDraft(result); return result; }
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
    cameraTrail = cameraTrail.map((area) => survivingArea(area, fresh, locatedArea)).filter((area, index, values) => area && values.indexOf(area) === index && area !== cameraTarget);
    const keys = new Set(fresh.areas.map((node) => node.key));
    folded = new Set([...folded].filter((area) => keys.has(area)));
    detailAreas = new Set([...detailAreas].filter((area) => keys.has(area)));
    worldHistory.state.undo.length = 0; worldHistory.state.redo.length = 0; worldHistory.state.queue.length = 0; worldHistory.state.open = null;
    authorityGeneration += 1; gesture = null; failedSave = null; saveBarrier?.resolve?.(); saveBarrier = null; selection = new Set(); save = { state: "saved", result: null };
    recoveryQueue = []; clearDraft(); install(fresh, "reload");
    onNavigation?.({ area: locatedArea, trail: [...cameraTrail], nextEscape: cameraTrail.length ? `Esc → ${leaf(cameraTrail.at(-1))}` : "Esc → Work" });
    return clone(world);
  }

  /** Rebases local source-ID changes over current shards, then submits a new operation. */
  async function keepMine() {
    if (!failedSave || save.state !== "conflict" || !reloadWorld) return null;
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
        ...clone(pending.command), id: crypto.randomUUID(), kind: "conflict-rebase",
        before: historyState(current, changedAreas, changedOwners),
        after: historyState(rebased, changedAreas, changedOwners),
      };
      failedSave = null; install(rebased, "rebased");
      const result = await persistCommand(rebasedCommand, "after");
      if (!result?.error && result?.status < 400 && recoveryQueue.length) return retry();
      return result;
    } catch (error) {
      const result = { status: Number(error?.status ?? 503), error: String(error?.message ?? error) };
      failedSave = pending; save = { state: result.status === 409 ? "conflict" : "blocked", result }; notify("rebase-failed");
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
    draft = { ...draft, restored: true };
    save = { state: Number(draft.status) === 409 ? "conflict" : "blocked", result: { ...(draft.failure ?? {}), draft: true } }; notify("draft-ready");
    return true;
  }

  /** Discards the offered draft only on Julian's explicit act. */
  function discardDraft() { clearDraft(); recoveryQueue = []; notify("draft-discarded"); }

  updateSemanticDetail();
  project();
  recordEvent("area_map_world_loaded", {
    revision: world.worldRevision,
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
  Promise.resolve(recoveryStore.load(world.worldId)).then((record) => {
    if (destroyed || record?.schema !== DRAFT_SCHEMA || record.worldId !== world.worldId) return;
    draft = record; notify("draft-found");
  }).catch(() => {});

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
    undo: () => worldHistory.undo(),
    /** Redoes one map-owned command word. */
    redo: () => worldHistory.redo(),
    selectArea, setSelection, fitArea, escape, toggleFold, setFocus, setCamera,
    materialize, refreshFacts,
    /** Waits for all queued map persistence. */
    flush: () => worldHistory.flush(),
    retry, reload, keepMine, restoreDraft, discardDraft, recordEvent,
    /** Releases timers and subscribers. */
    destroy() {
      destroyed = true; authorityGeneration += 1; saveBarrier?.resolve?.(); saveBarrier = null; listeners.clear();
      if (viewTimer !== null) clearTimeout(viewTimer);
      if (pendingView && persistView) Promise.resolve(persistView(pendingView)).catch(() => {});
      viewTimer = null; pendingView = null; recoveryStore.close?.();
    },
  };
}

export default { createAreaMapWorldController };
