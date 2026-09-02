import core from "./area-board-core.js";
import { createAreaMapWorldController } from "./area-map-world-controller.js";
import { loadAreaMapAuthority } from "./area-map-rollout.js";

/** Loads the editor's generated stylesheet only when the map opens. */
function loadEditorStyle() {
  const existing = document.querySelector('link[data-tangent-area-map-style]');
  if (existing) return existing.dataset.loaded === "yes" ? Promise.resolve() : new Promise((resolve, reject) => {
    existing.addEventListener("load", resolve, { once: true }); existing.addEventListener("error", reject, { once: true });
  });
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/agent-shell-map.css"; link.dataset.tangentAreaMapStyle = "";
    link.addEventListener("load", () => { link.dataset.loaded = "yes"; resolve(); }, { once: true });
    link.addEventListener("error", reject, { once: true }); document.head.append(link);
  });
}

/** Loads the test editor or the production Excalidraw browser bundle. */
const editorLoader = () => globalThis.__TANGENT_AREA_EDITOR_LOADER__?.() ?? loadEditorStyle().then(() => import("/agent-shell-map.js"));

/** Includes every reciprocal sibling-overlap peer needed for one atomic source write. */
function symmetricOverlapClosure(world, changedAreas) {
  const nodes = new Map((world?.areas ?? []).map((node) => [node.key, node]));
  const closed = new Set(changedAreas ?? []);
  const pending = [...closed];
  while (pending.length) {
    const area = pending.shift();
    const node = nodes.get(area);
    if (!node) continue;
    for (const sibling of node.region?.layout?.overlapWith ?? []) {
      const peer = nodes.get(sibling);
      if (!peer || peer.parent !== node.parent || !(peer.region?.layout?.overlapWith ?? []).includes(area) || closed.has(sibling)) continue;
      closed.add(sibling); pending.push(sibling);
    }
  }
  return closed;
}

/** Posts one idempotent map gesture, retrying safe races and ambiguous acknowledgement loss. */
export async function saveAreaMapGestureRequest(api, request, { onEvent = null, gestureKind = "edit", shardCount = request.mutations?.length ?? 0, maxAttempts = 3, now = () => performance.now() } = {}) {
  const { operationId, gestureId = operationId } = request;
  const startedAt = now();
  const body = JSON.stringify(request);
  for (let retryAttempt = 0; retryAttempt < maxAttempts; retryAttempt += 1) {
    onEvent?.("area_map_save_phase", { operationId, gestureId, gestureKind, phase: retryAttempt ? "retry" : "request", retryAttempt, shardCount, duration: now() - startedAt });
    try {
      const result = await api("/api/areas/map-gestures", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tangent-operation-id": operationId },
        body,
      });
      onEvent?.("area_map_save_phase", { operationId, gestureId, gestureKind, phase: "acknowledged", outcome: "saved", status: Number(result.status ?? 200), retryAttempt, retryable: false, idempotent: result.idempotent === true, shardCount, duration: now() - startedAt, worldRevision: result.worldRevision, treeRevision: result.treeRevision });
      return result;
    } catch (error) {
      const result = error?.payload ?? {};
      const retryable = result.retryable === true || ["timeout", "transport"].includes(error?.kind);
      const status = Number(error?.status ?? 0);
      const failureKind = result.code ?? error?.kind ?? (status === 400 ? "invalid-request" : status === 409 ? "conflict" : status === 422 ? "validation" : status >= 500 ? "unavailable" : "transport");
      if (retryable && retryAttempt + 1 < maxAttempts) {
        onEvent?.("area_map_retry", { operationId, gestureId, phase: "scheduled", retryAttempt: retryAttempt + 1, status, failureKind, retryable: true, pendingCount: 1 });
        continue;
      }
      onEvent?.("area_map_save_phase", { operationId, gestureId, gestureKind, phase: "failed", outcome: "not-saved", status, failureKind, retryAttempt, retryable, shardCount, duration: now() - startedAt });
      throw error;
    }
  }
  throw new Error("Area map save retry loop ended unexpectedly");
}

/** Replaces the host with one safe, visible world-authority error. */
function showWorldError(host, error, retry = null) {
  const section = document.createElement("section"); section.className = "area-board-empty"; section.setAttribute("role", "alert");
  const heading = document.createElement("h2"); heading.textContent = "The complete Area map did not load.";
  const detail = document.createElement("p"); detail.textContent = String(error?.message ?? error);
  section.append(heading, detail);
  if (retry) { const button = document.createElement("button"); button.type = "button"; button.textContent = "Retry"; button.addEventListener("click", retry); section.append(button); }
  host.replaceChildren(section);
}

/**
 * Builds one canonical source mutation while retaining hidden resource
 * representations. Other deleted Excalidraw records keep their established
 * remove-or-ignore behavior.
 */
function sourceSceneElementMutation(nextScene, oldScene = null) {
  const retained = core.hiddenResourceRecordIds(nextScene);
  const nextElements = new Map((nextScene?.elements ?? []).filter((element) => !core.isAreaBoundary(element) && (!element.isDeleted || retained.has(element.id))).map((element) => [element.id, element]));
  const structural = new Set((oldScene?.elements ?? []).filter(core.isAreaRegion).flatMap((element) => [element.id, ...(element.boundElements ?? []).map((binding) => binding.id)]));
  const remove = [];
  for (const element of oldScene?.elements ?? []) {
    if (!element.isDeleted && !core.isAreaBoundary(element) && !nextElements.has(element.id) && !structural.has(element.id)) remove.push(element.id);
  }
  return { put: [...nextElements.values()].map((element) => structuredClone(element)), remove };
}

/** Mounts the complete hierarchy through one persistent browser island. */
function mountWorld(host, { world, getDocuments, searchDocuments = null, api, onBack, onNavigation = null, onViewState = null, onEntityVerb = null, onEvent = null, focus = null }) {
  host.replaceChildren();
  const loader = document.createElement("div"); loader.className = "area-board-loading"; loader.innerHTML = "<p>Loading drawing tools…</p>"; host.append(loader);
  let editor = null; let pendingNavigation = null; let pendingFind = false; let authority = null; let closing = false; let closePromise = null;
  /** Returns the source shard for one explicit owner. */
  const shardFor = (value, owner) => owner === "@root" ? value.rootShard : value.areas.find((entry) => entry.key === owner)?.shard;
  /** Merges one full source element into its owner mutation. */
  const putElement = (mutation, element) => mutation.put.set(element.id, structuredClone(element));

  /** Saves one immutable command as one source-space transaction. */
  const persist = async (nextWorld, changedAreas, changedOwners = new Set(), command = null, direction = "after") => {
    const previous = command?.[direction === "after" ? "before" : "after"]?.get?.("world") ?? nextWorld;
    const mutations = new Map();
    /** Returns the one merged mutation for a source owner. */
    const mutationFor = (owner) => {
      if (!mutations.has(owner)) mutations.set(owner, { owner, baseHash: shardFor(nextWorld, owner)?.hash ?? null, put: new Map(), remove: new Set() });
      return mutations.get(owner);
    };
    for (const owner of changedOwners) {
      const nextScene = shardFor(nextWorld, owner)?.scene; const oldScene = shardFor(previous, owner)?.scene;
      if (!nextScene) throw new Error(`Cannot save ${owner}: its map shard is unavailable`);
      const mutation = mutationFor(owner);
      const sceneMutation = sourceSceneElementMutation(nextScene, oldScene);
      for (const element of sceneMutation.put) putElement(mutation, element);
      for (const sourceId of sceneMutation.remove) mutation.remove.add(sourceId);
    }
    for (const area of symmetricOverlapClosure(nextWorld, changedAreas)) {
      const node = nextWorld.areas.find((entry) => entry.key === area); if (!node) continue;
      const mutation = mutationFor(node.parent); const ref = `${node.region.child}/${node.region.child.split("/").at(-1)}.md`;
      const [region, label] = core.createRegionElements({ id: node.region.sourceId, ref, title: node.region.child.split("/").at(-1), layout: node.region.layout, ...node.region.storedRect });
      if (node.region.labelSourceId && label.id !== node.region.labelSourceId) {
        region.boundElements = [{ id: node.region.labelSourceId, type: "text" }]; label.id = node.region.labelSourceId; label.containerId = node.region.sourceId;
      }
      putElement(mutation, region); putElement(mutation, label);
    }
    const payload = [...mutations.values()].map((mutation) => ({ ...mutation, put: [...mutation.put.values()], remove: [...mutation.remove] }));
    if (!payload.length) return { status: 200, hashes: {} };
    const operationIds = command ? command.operationIds ??= {} : null;
    const operationId = operationIds ? operationIds[direction] ??= crypto.randomUUID() : crypto.randomUUID();
    const gestureId = command?.id ?? operationId;
    return saveAreaMapGestureRequest(api, {
      schema: "area-map-gesture.v1", operationId, gestureId, worldId: nextWorld.worldId,
      treeRevision: nextWorld.treeRevision, worldRevision: nextWorld.worldRevision,
      reason: command?.kind ?? "map gesture", mutations: payload,
    }, {
      /** Forwards privacy-safe save phases through the map controller. */
      onEvent: (name, fields) => authority?.recordEvent(name, fields),
      gestureKind: command?.kind ?? "edit",
      shardCount: payload.length,
    });
  };

  /** Loads current world authority and exact source shards required for rebase. */
  const reloadWorld = async ({ locatedArea = world.locatedArea, owners = [] } = {}) => {
    const current = await api(`/api/areas/map-world?located=${encodeURIComponent(locatedArea)}`);
    if (current?.schema !== "area-map-world.v1") throw new Error(current?.error || "The current Area-map world is unavailable");
    await Promise.all(owners.map(async (owner) => {
      const node = current.areas.find((entry) => entry.key === owner);
      if (!node || node.shard.scene || node.shard.state === "unreadable") return;
      const loaded = await api(`/api/areas/map-shard?area=${encodeURIComponent(owner)}&worldRevision=${encodeURIComponent(current.worldRevision)}&located=${encodeURIComponent(locatedArea)}`);
      if (!loaded?.scene) throw new Error(loaded?.error || `The current ${owner} shard is unavailable`);
      node.shard = { ...node.shard, ...loaded };
    }));
    return current;
  };

  authority = createAreaMapWorldController({
    world, getDocuments, focus, persistWorld: persist, reloadWorld, onBack, onNavigation,
    /** Forwards coordinate-free world diagnostics. */
    onEvent(event) {
      onEvent?.(event);
      try { globalThis.dispatchEvent?.(new CustomEvent("tangent:area-map", { detail: event })); } catch { /* Diagnostics never block the map. */ }
    },
    /** Loads one deferred shard against the controller's current revision. */
    loadShard: (area, context = {}) => {
      const current = authority.world();
      return api(`/api/areas/map-shard?area=${encodeURIComponent(area)}&worldRevision=${encodeURIComponent(context.worldRevision ?? current.worldRevision)}&located=${encodeURIComponent(context.locatedArea ?? current.locatedArea)}`);
    },
    /** Persists only rendering and camera preferences for this world ID. */
    persistView: (value) => api("/api/areas/map-view", { method: "PUT", body: JSON.stringify({ worldId: world.worldId, view: value }) }),
  });
  const ready = editorLoader().then((module) => {
    if (closing) { loader.remove(); return null; }
    loader.remove(); editor = module.mountAreaBoardEditor(host, { world, controller: authority, scene: { elements: [], appState: {}, files: {} }, getDocuments, searchDocuments, onEntityVerb, onViewState });
    if (pendingNavigation) editor.navigateArea?.(pendingNavigation.area, pendingNavigation.settings);
    if (pendingFind) editor.openFind?.();
    return editor;
  }).catch((error) => {
    if (closing) return null;
    loader.remove(); showWorldError(host, error, () => mountWorld(host, { world, getDocuments, searchDocuments, api, onBack, onNavigation, onViewState, onEntityVerb, onEvent, focus })); throw error;
  });
  return {
    /** Returns the live composed scene after the editor mounts. */
    current: () => editor?.current?.() ?? null,
    /** Returns the elements held by the mounted Excalidraw runtime. */
    rendered: () => editor?.rendered?.() ?? null,
    /** Flushes both editor and controller save queues. */
    async flush() {
      await ready.catch(() => null);
      if (editor?.flush) await editor.flush();
      else await authority.flush();
    },
    /** Fits one Area now or after the editor finishes mounting. */
    navigateArea(area, settings) {
      if (!editor) { pendingNavigation = { area, settings }; return authority.navigateArea(area, settings); }
      return editor.navigateArea?.(area, settings);
    },
    /** Fits one Area without changing an active restriction target. */
    fitArea(area, settings) { return editor?.fitArea?.(area, settings) ?? authority.fitArea(area, settings); },
    /** Captures the exact private camera and selection for a temporary route. */
    captureView() { return editor?.captureView?.() ?? authority.captureView(); },
    /** Restores a captured private camera and selection without touching Map authority. */
    restoreView(value) { return editor?.restoreView?.(value) ?? authority.restoreView(value); },
    /** Returns keyboard focus to the mounted Map canvas. */
    focus() { return editor?.focus?.() ?? false; },
    /** Runs the map-owned Escape order. */
    escape() { return editor?.escape?.() ?? authority.escape(); },
    /** Opens map find after the browser island is ready. */
    openFind() { if (!editor) { pendingFind = true; return true; } return editor.openFind?.() ?? false; },
    /** Toggles Only in the mounted browser island. */
    toggleRestriction(area) { return editor?.toggleRestriction?.(area) ?? authority.toggleRestriction(area); },
    /** Reconciles fact or structural polling without remounting. */
    refreshFacts(documentsOrFocus, maybeFocus) {
      return editor?.refreshFacts
        ? editor.refreshFacts(documentsOrFocus, maybeFocus)
        : authority.refreshFacts(maybeFocus ?? documentsOrFocus);
    },
    /** Changes the rendering-only Focus mask. */
    setFocus(value) { if (editor?.setFocus) editor.setFocus(value); else authority.setFocus(value); return true; },
    /** Settles any live gesture, drains its save, then releases controller storage. */
    destroy() {
      closing = true;
      closePromise ??= ready.catch(() => null).then(async () => {
        editor?.destroy?.();
        await authority.flush();
      }).finally(() => authority.destroy());
      return closePromise;
    },
  };
}

/** Mounts one direct format-2 shard for the rollback window. */
function mountLegacy(host, { area, payload, api, onBack = null }) {
  host.replaceChildren();
  const loader = document.createElement("div"); loader.className = "area-board-loading"; loader.innerHTML = "<p>Loading drawing tools…</p>"; host.append(loader);
  let editor = null; let pending = null; let failed = null; let timer = null; let runner = null; let destroyed = false;
  let baseHash = payload.hash ?? null;
  const initial = structuredClone(payload.scene ?? payload.canvas ?? core.createEmptyScene());

  /** Saves the latest direct shard without allowing a world mutation route. */
  async function drain() {
    if (runner) return runner;
    runner = (async () => {
      while (pending && !failed) {
        const scene = pending; pending = null;
        editor?.setSaveState?.({ state: "saving" });
        try {
          const result = await api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area, baseHash, canvas: scene, operationId: crypto.randomUUID() }) });
          if (result?.error || Number(result?.status ?? 200) >= 400) throw Object.assign(new Error(result.error || "The legacy Area canvas did not save"), { result });
          baseHash = result.hash ?? result.hashes?.[area] ?? baseHash;
          editor?.setSaveState?.({ state: pending ? "dirty" : "saved" });
        } catch (error) {
          failed = { scene, error };
          editor?.setSaveState?.({ state: Number(error?.status ?? error?.result?.status) === 409 ? "conflict" : "blocked", result: error?.result });
        }
      }
    })().finally(() => { runner = null; });
    return runner;
  }

  /** Coalesces live Excalidraw changes into an ordered direct-shard save. */
  function queue(scene) {
    if (destroyed) return;
    pending = scene;
    if (failed) { editor?.setSaveState?.({ state: "blocked", result: failed.error?.result }); return; }
    editor?.setSaveState?.({ state: "dirty" });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void drain(); }, 250);
  }

  /** Retries the failed source scene while retaining any later local change. */
  function retry() {
    if (failed && !pending) pending = failed.scene;
    failed = null;
    return drain();
  }

  /** Flushes the pending format-2 scene through the transaction-backed canvas route. */
  async function flushPending() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    await drain();
  }

  const ready = editorLoader().then((module) => {
    loader.remove();
    editor = module.mountAreaBoardEditor(host, {
      legacy: true, area, scene: initial, onBack,
      onSceneChange: queue, onSaveNow: flushPending, onRetry: retry,
      initialSaveState: { state: "saved" },
    });
    return editor;
  }).catch((error) => {
    loader.remove(); showWorldError(host, error, () => mountLegacy(host, { area, payload, api, onBack })); throw error;
  });

  return {
    /** Returns the direct source scene after the editor mounts. */
    current: () => editor?.current?.() ?? initial,
    /** Flushes only the direct format-2 source queue. */
    async flush() { await ready.catch(() => null); await flushPending(); },
    /** A rollback shard has no composed Area camera target. */
    fitArea: () => null,
    /** A rollback shard has no complete-world private view snapshot. */
    captureView: () => null,
    /** A rollback shard cannot restore a complete-world private view snapshot. */
    restoreView: () => null,
    /** Returns focus to the direct editor when supported. */
    focus: () => editor?.focus?.() ?? false,
    /** A rollback shard has no composed Area navigation target. */
    navigateArea: () => null,
    /** A rollback shard has no complete-world Area finder. */
    openFind: () => false,
    /** A rollback shard has no complete-world restriction. */
    toggleRestriction: () => false,
    /** Leaves the rollback editor through its map-local boundary. */
    escape() { return editor?.escape?.() ?? onBack?.(); },
    /** Fact polling never replaces direct source authority. */
    refreshFacts: () => false,
    /** Focus is a complete-world render mask and does not mutate rollback authority. */
    setFocus: () => false,
    /** Releases the direct editor after its last local save starts. */
    destroy() { void flushPending(); destroyed = true; editor?.destroy?.(); },
  };
}

/** Mounts the rollout-selected authority without crossing between save routes. */
function mount(host, options) {
  if (options.world?.schema === "area-map-world.v1") return mountWorld(host, options);
  if (options.legacy === true && options.payload) return mountLegacy(host, options);
  showWorldError(host, "This view did not receive one authoritative world.");
  return {
    /** Returns no scene when world authority is missing. */
    current: () => null,
    /** Returns no rendered scene when world authority is missing. */
    rendered: () => null,
    /** Has no persistence work when world authority is missing. */
    flush: async () => null,
    /** Cannot fit an Area without world authority. */
    fitArea: () => null,
    /** Cannot capture a view without world authority. */
    captureView: () => null,
    /** Cannot restore a view without world authority. */
    restoreView: () => null,
    /** Cannot focus a missing Map. */
    focus: () => false,
    /** Cannot navigate without world authority. */
    navigateArea: () => null,
    /** Cannot find without world authority. */
    openFind: () => false,
    /** Cannot restrict without world authority. */
    toggleRestriction: () => false,
    /** Cannot change view history without world authority. */
    escape: () => null,
    /** Cannot reconcile facts without world authority. */
    refreshFacts: () => false,
    /** Cannot change Focus without world authority. */
    setFocus: () => false,
    /** Releases the visible error fallback. */
    destroy() {},
  };
}

export { loadAreaMapAuthority, mount, mountLegacy, mountWorld, sourceSceneElementMutation, symmetricOverlapClosure };
export default { loadAreaMapAuthority, mount, mountLegacy, mountWorld, sourceSceneElementMutation, symmetricOverlapClosure };
