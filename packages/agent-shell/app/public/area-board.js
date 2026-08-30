import core from "./area-board-core.js";
import draftStore from "./area-board-draft-store.js";
import boardSave from "./area-board-save.js";

/** Loads the editor's generated stylesheet only when the map opens. */
function loadEditorStyle() {
  const existing = document.querySelector('link[data-tangent-area-map-style]');
  if (existing) return existing.dataset.loaded === "yes" ? Promise.resolve() : new Promise((resolve, reject) => {
    existing.addEventListener("load", resolve, { once: true });
    existing.addEventListener("error", reject, { once: true });
  });
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/agent-shell-map.css"; link.dataset.tangentAreaMapStyle = "";
    link.addEventListener("load", () => { link.dataset.loaded = "yes"; resolve(); }, { once: true });
    link.addEventListener("error", reject, { once: true });
    document.head.append(link);
  });
}

/** Loads the test editor or the production Excalidraw browser bundle. */
const editorLoader = () => globalThis.__TANGENT_AREA_EDITOR_LOADER__?.() ?? loadEditorStyle().then(() => import("/agent-shell-map.js"));

/** Mounts the complete hierarchy through one persistent browser island. */
function mountWorld(host, { world, getDocuments, api, onBack }) {
  host.replaceChildren();
  const loader = document.createElement("div");
  loader.className = "area-board-loading";
  loader.innerHTML = "<p>Loading drawing tools…</p>";
  host.append(loader);
  let editor = null;
  let saveState = "saved";
  let chain = Promise.resolve();
  /** Saves direct region changes in their parent shards. */
  const persist = (nextWorld, changedAreas, changedOwners = new Set()) => {
    const writes = [];
    for (const area of changedAreas) {
      const node = nextWorld.areas.find((entry) => entry.key === area);
      if (!node || node.parent === "@root") continue;
      const parent = nextWorld.areas.find((entry) => entry.key === node.parent);
      if (!parent || parent.shard.state === "unreadable") continue;
      const scene = structuredClone(parent.shard.scene ?? core.createEmptyScene());
      const ref = `${area}/${area.split("/").at(-1)}.md`;
      const [region, label] = core.createRegionElements({ id: node.region.sourceId, ref, title: area.split("/").at(-1), ...node.region.storedRect });
      const ids = new Set([region.id, label.id]);
      scene.elements = [...scene.elements.filter((element) => !ids.has(element.id)), region, label];
      writes.push({ area: node.parent, baseHash: parent.shard.hash ?? null, canvas: scene, reason: `${area.split("/").at(-1)} region` });
    }
    for (const owner of changedOwners) {
      const node = nextWorld.areas.find((entry) => entry.key === owner);
      if (!node || node.shard.state === "unreadable") continue;
      const existing = writes.find((write) => write.area === owner);
      if (existing) existing.canvas = structuredClone(node.shard.scene);
      else writes.push({ area: owner, baseHash: node.shard.hash ?? null, canvas: structuredClone(node.shard.scene), reason: `${owner.split("/").at(-1)} map` });
    }
    if (!writes.length) return;
    saveState = "saving"; editor?.setSaveState({ state: saveState });
    chain = chain.then(async () => {
      const result = await api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area: writes[0].area, writes, operationId: crypto.randomUUID() }) });
      if (result?.error || result?.status === 409) throw Object.assign(new Error(result.error || "map changed elsewhere"), { result });
      for (const [area, hash] of Object.entries(result.hashes ?? {})) {
        const node = nextWorld.areas.find((entry) => entry.key === area);
        if (node) node.shard.hash = hash;
      }
      saveState = "saved"; editor?.setSaveState({ state: saveState });
    }).catch((error) => { saveState = "blocked"; editor?.setSaveState({ state: saveState, result: error.result }); });
  };
  const ready = editorLoader().then((module) => {
    loader.remove();
    editor = module.mountAreaBoardEditor(host, { world, scene: { elements: [], appState: {}, files: {} }, getDocuments, onBack, onWorldChange: persist, initialSaveState: { state: "saved" } });
    return editor;
  });
  return {
    /** Returns the current composed scene. */
    current: () => editor?.current?.() ?? null,
    /** Waits for editor startup and all queued region saves. */
    async flush() { await ready; await chain; },
    /** Fits the persistent camera to one Area. */
    fitArea(area) { editor?.fitArea?.(area); },
    /** Releases the persistent browser island. */
    destroy() { editor?.destroy?.(); },
  };
}

/** Builds an unsaved blank scope. No vault entity is placed automatically. */
function initialScene(area) {
  const scene = core.createEmptyScene();
  scene.elements.push(core.defaultScopeBoundary(area));
  return scene;
}

/** Mounts the Excalidraw editor island and the existing durable save contract. */
function mount(host, { area, payload: suppliedPayload, world = null, context = { ancestors: [] }, documents, getDocuments = () => documents, api, onOpenDocument, onSelectArea, onEntityVerb = null, onBack = null, backLabel = "Work", locatedArea = area, focus = null, onToggleAreaStar = null, onToggleStarredOnly = null, onToggleActiveOnly = null, brainLive = false, ignoreDraft = false }) {
  if (world) return mountWorld(host, { world, getDocuments, api, onBack });
  host.replaceChildren();
  let payload = suppliedPayload;
  const drafts = draftStore.create(localStorage);
  const pendingDraft = !ignoreDraft ? drafts.load(area) : null;
  const committedScene = payload.scene ?? payload.canvas ?? core.createEmptyScene();
  const draftScene = pendingDraft?.scene ?? pendingDraft?.canvas;
  const draftEqualsCommitted = draftScene && core.authoredFingerprint(draftScene.elements) === core.authoredFingerprint(committedScene.elements);
  if (draftEqualsCommitted) drafts.clear(area);
  const knownHashes = Object.fromEntries([[area, payload.hash ?? null], ...(context.ancestors ?? []).map((ancestor) => [ancestor.area, ancestor.hash ?? null])]);
  const draftHashesMatch = pendingDraft?.baseHashes ? Object.entries(pendingDraft.baseHashes).every(([target, hash]) => knownHashes[target] === hash) : pendingDraft?.baseHash === payload.hash;
  const matchingDraft = !draftEqualsCommitted && draftScene && draftHashesMatch;
  if (matchingDraft) payload = { ...payload, exists: true, scene: draftScene, canvas: draftScene, restoreDraft: true, recoveredDraft: pendingDraft };
  let controller = {
    /** Returns the scene while the editor is starting. */
    current: () => payload.scene ?? payload.canvas,
    /** Has no pending save before the editor starts. */
    flush: async () => null,
    /** Has no mounted editor to destroy before startup. */
    destroy() {},
  };

  if (draftScene && !draftEqualsCommitted && !matchingDraft) {
    const choice = document.createElement("section");
    choice.className = "area-board-draft-choice";
    const time = pendingDraft.savedAt ? new Date(pendingDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "an earlier session";
    choice.innerHTML = `<strong>A draft from ${time} was not saved.</strong><button type="button" data-draft-restore>Restore</button><button type="button" data-draft-discard>Discard</button>`;
    choice.querySelector("[data-draft-restore]").addEventListener("click", () => {
      const scene = pendingDraft.scene ?? pendingDraft.canvas;
      controller = mount(host, { area, context, payload: { ...payload, exists: true, hash: pendingDraft.baseHash, scene, canvas: scene, restoreDraft: true, recoveredDraft: pendingDraft }, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, backLabel, locatedArea, focus, onToggleAreaStar, onToggleStarredOnly, onToggleActiveOnly, brainLive, ignoreDraft: true });
    });
    choice.querySelector("[data-draft-discard]").addEventListener("click", () => { drafts.clear(area); controller = mount(host, { area, context, payload, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, backLabel, locatedArea, focus, onToggleAreaStar, onToggleStarredOnly, onToggleActiveOnly, brainLive, ignoreDraft: true }); });
    host.append(choice);
    return {
      /** Returns the restored or discarded draft controller's scene. */
      current: () => controller.current(),
      /** Flushes the restored or discarded draft controller. */
      flush: () => controller.flush(),
      /** Destroys the restored or discarded draft controller. */
      destroy: () => controller.destroy(),
    };
  }

  const normalized = core.normalizeSceneColors(structuredClone(payload.scene ?? payload.canvas ?? core.createEmptyScene()));
  const conversion = payload.exists ? core.convertToBlankSlate(normalized.scene, area, getDocuments(), context.legacyBaseline) : { scene: initialScene(area), changed: false, inboxed: [] };
  let current = core.scopeScene(conversion.scene, area, context, payload.view);
  current.appState = core.appStateWithView(current.appState, payload.view);
  let baseHash = payload.hash ?? null;
  let editor = null;
  let viewTimer = null;
  let pendingView = null;
  const baseHashes = new Map([[area, payload.hash ?? null], ...(context.ancestors ?? []).map((ancestor) => [ancestor.area, ancestor.hash ?? null])]);
  const dirtyWrites = new Map();
  let lastGesture = null;
  let recoveredGesture = payload.recoveredDraft ? {
    canvas: current,
    writes: payload.recoveredDraft.writes?.length ? payload.recoveredDraft.writes : [{ area, baseHash: payload.recoveredDraft.baseHash ?? payload.hash ?? null, canvas: core.sceneWithoutScopeBoundary(current, Boolean(context.ancestors?.length)), reason: `${area.split("/").at(-1)} content` }],
  } : null;
  const loader = document.createElement("div");
  loader.className = "area-board-loading";
  loader.innerHTML = `<p>Loading drawing tools…</p>`;
  host.append(loader);

  const saver = boardSave.create({
    area,
    drafts,
    /** Persists every authoritative file changed by one editor gesture. */
    post: (gesture, hash) => api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area, baseHash: hash, canvas: gesture.canvas, writes: gesture.writes.map((write) => ({ ...write, baseHash: baseHashes.get(write.area) ?? write.baseHash ?? null })), operationId: crypto.randomUUID() }) }),
    /** Stores the whole failed gesture while keeping its display scene recoverable. */
    draftFor: (gesture) => ({ baseHash: baseHashes.get(area) ?? null, baseHashes: Object.fromEntries(baseHashes), canvas: gesture.canvas, writes: gesture.writes }),
    /** Reflects the save machine state in the mounted editor. */
    onState: ({ state, result }) => {
      if (result?.hash) baseHash = result.hash;
      for (const [target, hash] of Object.entries(result?.hashes ?? {})) {
        baseHashes.set(target, hash);
        const ancestor = context.ancestors?.find((item) => item.area === target);
        if (ancestor) ancestor.hash = hash;
      }
      if (state === "saved") { dirtyWrites.clear(); recoveredGesture = null; }
      const visible = state === "blocked" && result?.status === 409 ? "conflict" : state;
      editor?.setSaveState({ state: visible, result, label: payload.migrated && state === "saved" ? "Converted from canvas" : undefined });
    },
  });
  saver.start(baseHash);

  /** Merges one editor change into the atomic gesture waiting to save. */
  function queueGesture(next, gesture = {}) {
    current = next;
    if (gesture.currentChanged) dirtyWrites.set(area, { area, baseHash: baseHashes.get(area) ?? null, canvas: core.sceneForSave(gesture.currentCanvas.elements, next.appState), reason: `${area.split("/").at(-1)} content` });
    if (gesture.extentWrite) dirtyWrites.set(gesture.extentWrite.area, { ...gesture.extentWrite, baseHash: baseHashes.get(gesture.extentWrite.area) ?? gesture.extentWrite.baseHash ?? null });
    for (const write of recoveredGesture?.writes ?? []) if (!dirtyWrites.has(write.area)) dirtyWrites.set(write.area, write);
    if (!dirtyWrites.size) return;
    lastGesture = { canvas: current, writes: [...dirtyWrites.values()] };
    saver.edit(lastGesture);
  }

  /** Saves a silently restored draft only after an explicit save or departure. */
  function flush() {
    if (recoveredGesture && !lastGesture) { lastGesture = recoveredGesture; saver.edit(lastGesture); }
    return saver.flush();
  }

  /** Replaces a conflicted local scene with the repository version. */
  async function reload() {
    const [latest, latestContext] = await Promise.all([
      api(`/api/areas/canvas?area=${encodeURIComponent(area)}`),
      api(`/api/areas/map-context?area=${encodeURIComponent(area)}`).catch(() => null),
    ]);
    if (latestContext?.ancestors) context.ancestors.splice(0, context.ancestors.length, ...latestContext.ancestors);
    current = core.scopeScene(latest.scene ?? latest.canvas, area, context, pendingView ?? payload.view);
    baseHash = latest.hash;
    baseHashes.set(area, baseHash);
    dirtyWrites.clear(); lastGesture = null; recoveredGesture = null;
    drafts.clear(area);
    saver.start(baseHash);
    editor?.updateScene(current);
    editor?.setSaveState({ state: "saved" });
  }

  /** Resubmits the local scene against a newly acknowledged repository hash. */
  async function keepMine(conflict) {
    const hashes = conflict?.currentHashes ?? (conflict?.currentHash !== undefined ? { [area]: conflict.currentHash } : null);
    if (!hashes) return;
    for (const [target, hash] of Object.entries(hashes)) {
      baseHashes.set(target, hash);
      if (dirtyWrites.has(target)) dirtyWrites.get(target).baseHash = hash;
    }
    baseHash = baseHashes.get(area) ?? baseHash;
    saver.start(baseHash);
    if (lastGesture) saver.edit(lastGesture);
    await saver.flush();
  }

  /** Retries the current scene after a temporary save failure. */
  async function retry() {
    saver.start(baseHash);
    if (lastGesture) saver.edit(lastGesture);
    await saver.flush();
  }

  /** Routes a Tangent block verb through the shell or its basic fallback. */
  function entityVerb(action) {
    if (onEntityVerb) return onEntityVerb(action);
    if (action.kind === "link") { window.open(action.ref, "_blank", "noopener"); return; }
    const source = core.splitReference(action.ref);
    if (action.kind === "area") onSelectArea?.(source.file.replace(/\/[^/]+\.md$/, ""));
    else if (source.file) onOpenDocument?.(source.file);
  }

  /** Writes a new block to the exact spatial target Area, then moves scope. */
  async function placeInto(frame, choice, point) {
    if (!frame || frame.area === area) return false;
    const target = await api(`/api/areas/canvas?area=${encodeURIComponent(frame.area)}`);
    let scene = structuredClone(target.scene ?? target.canvas ?? core.createEmptyScene());
    if (!target.exists) scene = initialScene(frame.area);
    scene = core.addBlock(scene, choice, core.toAreaSpace(point, frame));
    const saved = await api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area: frame.area, baseHash: target.hash ?? null, canvas: scene, operationId: crypto.randomUUID() }) });
    if (saved?.status === 409 || saved?.error) throw new Error(`${frame.label.name} changed elsewhere · try again`);
    onSelectArea?.(frame.area);
    return true;
  }

  /** Removes an inbox proposal only after its placed block is durable. */
  async function proposalPlaced(proposal) {
    const saved = await saver.flush();
    if (!saved?.error && saved?.status !== 409 && saved?.status !== 503) await api("/api/areas/map-proposals/decide", { method: "POST", body: JSON.stringify({ area, id: proposal.id, version: proposal.version, decision: "placed" }) });
  }

  /** Debounces private pan and zoom state outside the shared scene file. */
  function viewChanged(view) {
    pendingView = view;
    if (viewTimer !== null) window.clearTimeout(viewTimer);
    viewTimer = window.setTimeout(() => {
      viewTimer = null;
      const state = pendingView;
      pendingView = null;
      payload = { ...payload, view: state };
      api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state }) }).catch(() => {});
    }, 350);
  }

  const ready = Promise.resolve().then(async () => {
    const children = core.scopedEntities(area, getDocuments()).children;
    const entries = await Promise.all(children.map(async (child) => {
      try { const payload = await api(`/api/areas/canvas?area=${encodeURIComponent(child.area)}`); return [child.area, payload.exists && payload.ok !== false ? payload.scene ?? payload.canvas : null]; }
      catch { return [child.area, null]; }
    }));
    return { module: await editorLoader(), childScenes: new Map(entries.filter(([, scene]) => scene)) };
  }).then(({ module, childScenes }) => {
    loader.remove();
    editor = module.mountAreaBoardEditor(host, {
      area, scene: current, context, frames: core.ancestryFrames(area, context, current), childScenes, view: payload.view, proposals: payload.proposals ?? [], inboxed: conversion.inboxed ?? [], getDocuments, backLabel,
      initialSaveState: { state: "saved" },
      recoveredDraft: payload.recoveredDraft ?? null,
      brainLive, onBack, locatedArea, focus, onSelectArea, onPlaceInto: placeInto, onToggleAreaStar, onToggleStarredOnly, onToggleActiveOnly,
      /** Queues a Julian-authored scene edit for durable save. */
      onSceneChange: queueGesture,
      /** Accepts a fact-only repaint without dirtying the shared scene. */
      onFactScene(next) { current = next; },
      onViewChange: viewChanged,
      /** Flushes the debounced scene save immediately. */
      onSaveNow: flush,
      onDiscardDraft: reload,
      onReload: reload, onKeepMine: keepMine, onRetry: retry,
      onEntityVerb: entityVerb, onProposalPlaced: proposalPlaced,
      /** Promotes plain map text to an Area-brain idea. */
      onPromoteIdea: async (description) => api("/api/idea/new", { method: "POST", body: JSON.stringify({ area, description }) }),
    });
    return editor;
  }).catch((error) => {
    host.innerHTML = `<section class="area-board-empty"><h2>The drawing tools did not load.</h2><p>${String(error?.message ?? error)}</p><button type="button">Retry</button></section>`;
    host.querySelector("button")?.addEventListener("click", () => mount(host, { area, context, payload, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, backLabel, locatedArea, focus, onToggleAreaStar, onToggleStarredOnly, onToggleActiveOnly, brainLive, ignoreDraft: true }));
    throw error;
  });

  return {
    /** Returns the latest authored or fact-refreshed scene. */
    current: () => editor?.current?.() ?? current,
    /** Waits for editor startup and flushes pending scene changes. */
    async flush() { await ready.catch(() => null); return flush(); },
    /** Saves private view state and releases the editor island. */
    destroy() {
      if (viewTimer !== null) window.clearTimeout(viewTimer);
      if (pendingView) api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state: pendingView }) }).catch(() => {});
      editor?.destroy?.();
    },
  };
}

export { initialScene, mount, mountWorld };
export default { initialScene, mount, mountWorld };
