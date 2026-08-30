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

/** Replaces the host with one safe, visible world-authority error. */
function showWorldError(host, error, retry = null) {
  const section = document.createElement("section"); section.className = "area-board-empty"; section.setAttribute("role", "alert");
  const heading = document.createElement("h2"); heading.textContent = "The complete Area map did not load.";
  const detail = document.createElement("p"); detail.textContent = String(error?.message ?? error);
  section.append(heading, detail);
  if (retry) { const button = document.createElement("button"); button.type = "button"; button.textContent = "Retry"; button.addEventListener("click", retry); section.append(button); }
  host.replaceChildren(section);
}

/** Mounts the complete hierarchy through one persistent browser island. */
function mountWorld(host, { world, getDocuments, api, onBack, onNavigation = null, onEntityVerb = null, onEvent = null, focus = null }) {
  host.replaceChildren();
  const loader = document.createElement("div"); loader.className = "area-board-loading"; loader.innerHTML = "<p>Loading drawing tools…</p>"; host.append(loader);
  let editor = null; let pendingFit = null; let authority = null;
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
      const nextElements = new Map((nextScene.elements ?? []).filter((element) => !element.isDeleted && !core.isAreaBoundary(element)).map((element) => [element.id, element]));
      const structural = new Set((oldScene?.elements ?? []).filter(core.isAreaRegion).flatMap((element) => [element.id, ...(element.boundElements ?? []).map((binding) => binding.id)]));
      for (const element of nextElements.values()) putElement(mutation, element);
      for (const element of oldScene?.elements ?? []) if (!element.isDeleted && !core.isAreaBoundary(element) && !nextElements.has(element.id) && !structural.has(element.id)) mutation.remove.add(element.id);
    }
    for (const area of changedAreas) {
      const node = nextWorld.areas.find((entry) => entry.key === area); if (!node) continue;
      const mutation = mutationFor(node.parent); const ref = `${node.region.child}/${node.region.child.split("/").at(-1)}.md`;
      const [region, label] = core.createRegionElements({ id: node.region.sourceId, ref, title: node.region.child.split("/").at(-1), ...node.region.storedRect });
      if (node.region.labelSourceId && label.id !== node.region.labelSourceId) {
        region.boundElements = [{ id: node.region.labelSourceId, type: "text" }]; label.id = node.region.labelSourceId; label.containerId = node.region.sourceId;
      }
      putElement(mutation, region); putElement(mutation, label);
    }
    const payload = [...mutations.values()].map((mutation) => ({ ...mutation, put: [...mutation.put.values()], remove: [...mutation.remove] }));
    if (!payload.length) return { status: 200, hashes: {} };
    const operationIds = command ? command.operationIds ??= {} : null;
    const operationId = operationIds ? operationIds[direction] ??= crypto.randomUUID() : crypto.randomUUID();
    const startedAt = performance.now();
    authority?.recordEvent("area_map_save_phase", { operationId, phase: "request", shardCount: payload.length, duration: 0 });
    try {
      const result = await api("/api/areas/map-gestures", { method: "POST", body: JSON.stringify({ schema: "area-map-gesture.v1", operationId, worldId: nextWorld.worldId, treeRevision: nextWorld.treeRevision, reason: command?.kind ?? "map gesture", mutations: payload }) });
      authority?.recordEvent("area_map_save_phase", { operationId, phase: "acknowledged", shardCount: payload.length, duration: performance.now() - startedAt });
      return result;
    } catch (error) {
      const result = error?.payload ?? {};
      if (Number(error?.status) === 409 || result.conflict) authority?.recordEvent("area_map_save_conflict", { operationId, conflictingOwners: result.conflictingOwners ?? result.owners ?? [] });
      else authority?.recordEvent("area_map_save_phase", { operationId, phase: "failed", shardCount: payload.length, duration: performance.now() - startedAt });
      throw error;
    }
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
    persistView: (value) => api("/api/areas/map-view", { method: "POST", body: JSON.stringify({ worldId: world.worldId, view: value }) }),
  });
  const ready = editorLoader().then((module) => {
    loader.remove(); editor = module.mountAreaBoardEditor(host, { world, controller: authority, scene: { elements: [], appState: {}, files: {} }, getDocuments, onEntityVerb });
    if (pendingFit) editor.fitArea?.(pendingFit.area, pendingFit.settings); return editor;
  }).catch((error) => {
    loader.remove(); showWorldError(host, error, () => mountWorld(host, { world, getDocuments, api, onBack, onNavigation, onEntityVerb, onEvent, focus })); throw error;
  });
  return {
    /** Returns the live composed scene after the editor mounts. */
    current: () => editor?.current?.() ?? null,
    /** Flushes both editor and controller save queues. */
    async flush() { await ready.catch(() => null); await authority.flush(); },
    /** Fits one Area now or after the editor finishes mounting. */
    fitArea(area, settings) { if (!editor) { pendingFit = { area, settings }; return authority.selectArea(area); } return editor.fitArea?.(area, settings); },
    /** Runs the map-owned Escape order. */
    escape() { return editor?.escape?.() ?? authority.escape(); },
    /** Reconciles fact or structural polling without remounting. */
    refreshFacts(documentsOrFocus, maybeFocus) {
      return editor?.refreshFacts
        ? editor.refreshFacts(documentsOrFocus, maybeFocus)
        : authority.refreshFacts(maybeFocus ?? documentsOrFocus);
    },
    /** Changes the rendering-only Focus mask. */
    setFocus(value) { if (editor?.setFocus) editor.setFocus(value); else authority.setFocus(value); return true; },
    /** Releases the editor island and controller. */
    destroy() { editor?.destroy?.(); authority.destroy(); },
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
    /** Has no persistence work when world authority is missing. */
    flush: async () => null,
    /** Cannot fit an Area without world authority. */
    fitArea: () => null,
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

export { loadAreaMapAuthority, mount, mountLegacy, mountWorld };
export default { loadAreaMapAuthority, mount, mountLegacy, mountWorld };
