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

/** Builds the first scene from Area-scoped authoritative references. */
function initialScene(area, documents) {
  const scene = core.createEmptyScene();
  for (const [index, choice] of core.entityChoices(area, documents).slice(0, 12).entries()) {
    const column = index % 3; const row = Math.floor(index / 3);
    scene.elements.push(...core.createBlockElements({ id: crypto.randomUUID(), ...choice, x: 60 + column * 330, y: 60 + row * 180 }));
  }
  return scene;
}

/** Mounts the Excalidraw editor island and the existing durable save contract. */
function mount(host, { area, payload, documents, getDocuments = () => documents, api, onOpenDocument, onSelectArea, onEntityVerb = null, onBack = null, brainLive = false, ignoreDraft = false }) {
  host.replaceChildren();
  const drafts = draftStore.create(localStorage);
  const pendingDraft = !ignoreDraft ? drafts.load(area) : null;
  let controller = {
    /** Returns the scene while the editor is starting. */
    current: () => payload.scene ?? payload.canvas,
    /** Has no pending save before the editor starts. */
    flush: async () => null,
    /** Has no mounted editor to destroy before startup. */
    destroy() {},
  };

  if (pendingDraft?.canvas || pendingDraft?.scene) {
    const choice = document.createElement("section");
    choice.className = "area-board-draft-choice";
    const time = pendingDraft.savedAt ? new Date(pendingDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "an earlier session";
    choice.innerHTML = `<strong>A draft from ${time} was not saved.</strong><button type="button" data-draft-restore>Restore</button><button type="button" data-draft-discard>Discard</button>`;
    choice.querySelector("[data-draft-restore]").addEventListener("click", () => {
      const scene = pendingDraft.scene ?? pendingDraft.canvas;
      controller = mount(host, { area, payload: { ...payload, exists: true, hash: pendingDraft.baseHash, scene, canvas: scene, restoreDraft: true }, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, brainLive, ignoreDraft: true });
    });
    choice.querySelector("[data-draft-discard]").addEventListener("click", () => { drafts.clear(area); controller = mount(host, { area, payload, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, brainLive, ignoreDraft: true }); });
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
  let current = normalized.scene;
  current.appState = core.appStateWithView(current.appState, payload.view);
  let baseHash = payload.hash ?? null;
  let editor = null;
  let viewTimer = null;
  let pendingView = null;
  const loader = document.createElement("div");
  loader.className = "area-board-loading";
  loader.innerHTML = `<p>Loading drawing tools…</p>`;
  host.append(loader);

  const saver = boardSave.create({
    area,
    drafts,
    /** Persists a scene against the last known repository hash. */
    post: (next, hash) => api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area, baseHash: hash, canvas: next, operationId: crypto.randomUUID() }) }),
    /** Reflects the save machine state in the mounted editor. */
    onState: ({ state, result }) => {
      if (result?.hash) baseHash = result.hash;
      const visible = state === "blocked" && result?.status === 409 ? "conflict" : state;
      editor?.setSaveState({ state: visible, result, label: payload.migrated && state === "saved" ? "Converted from canvas" : undefined });
    },
  });
  saver.start(baseHash);

  /** Creates and saves a first scene when the Area has no map file. */
  async function ensureScene() {
    if (payload.exists) return;
    current = initialScene(area, getDocuments());
    const created = await api("/api/areas/canvas", { method: "POST", body: JSON.stringify({ area, baseHash: null, canvas: current, operationId: crypto.randomUUID() }) });
    baseHash = created.hash;
    saver.start(baseHash);
  }

  /** Replaces a conflicted local scene with the repository version. */
  async function reload() {
    const latest = await api(`/api/areas/canvas?area=${encodeURIComponent(area)}`);
    current = structuredClone(latest.scene ?? latest.canvas);
    baseHash = latest.hash;
    drafts.clear(area);
    saver.start(baseHash);
    editor?.updateScene(current);
    editor?.setSaveState({ state: "saved" });
  }

  /** Resubmits the local scene against a newly acknowledged repository hash. */
  async function keepMine(conflict) {
    const hash = conflict?.currentHash;
    if (hash === undefined) return;
    baseHash = hash;
    saver.start(baseHash);
    saver.edit(current);
    await saver.flush();
  }

  /** Retries the current scene after a temporary save failure. */
  async function retry() {
    saver.start(baseHash);
    saver.edit(current);
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
      api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state }) }).catch(() => {});
    }, 350);
  }

  const ready = ensureScene().then(() => editorLoader()).then((module) => {
    loader.remove();
    editor = module.mountAreaBoardEditor(host, {
      area, scene: current, view: payload.view, proposals: payload.proposals ?? [], getDocuments,
      initialSaveState: { state: "saved", label: payload.migrated ? "Converted from canvas" : undefined },
      brainLive, onBack,
      /** Queues a Julian-authored scene edit for durable save. */
      onSceneChange(next) { current = next; saver.edit(current); },
      /** Accepts a fact-only repaint without dirtying the shared scene. */
      onFactScene(next) { current = next; },
      onViewChange: viewChanged,
      /** Flushes the debounced scene save immediately. */
      onSaveNow: () => saver.flush(),
      onReload: reload, onKeepMine: keepMine, onRetry: retry,
      onEntityVerb: entityVerb, onProposalPlaced: proposalPlaced,
      /** Promotes plain map text to an Area-brain idea. */
      onPromoteIdea: async (description) => api("/api/idea/new", { method: "POST", body: JSON.stringify({ area, description }) }),
    });
    if (payload.restoreDraft || normalized.changed) saver.edit(current);
    return editor;
  }).catch((error) => {
    host.innerHTML = `<section class="area-board-empty"><h2>The drawing tools did not load.</h2><p>${String(error?.message ?? error)}</p><button type="button">Retry</button></section>`;
    host.querySelector("button")?.addEventListener("click", () => mount(host, { area, payload, documents, getDocuments, api, onOpenDocument, onSelectArea, onEntityVerb, onBack, brainLive, ignoreDraft: true }));
    throw error;
  });

  return {
    /** Returns the latest authored or fact-refreshed scene. */
    current: () => editor?.current?.() ?? current,
    /** Waits for editor startup and flushes pending scene changes. */
    async flush() { await ready.catch(() => null); return saver.flush(); },
    /** Saves private view state and releases the editor island. */
    destroy() {
      if (viewTimer !== null) window.clearTimeout(viewTimer);
      if (pendingView) api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state: pendingView }) }).catch(() => {});
      editor?.destroy?.();
    },
  };
}

export { initialScene, mount };
export default { initialScene, mount };
