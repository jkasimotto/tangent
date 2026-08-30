import React, { useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import boardCore from "../public/area-board-core.js";
import worldCore from "../public/area-map-world-core.js";
import pickerModel from "../public/area-board-picker.js";
import { createAreaMapWorldController, ownerForNewAreaMapElement, selectedAreaMapRegionChanges } from "../public/area-map-world-controller.js";

const EXCALIDRAW_UI_OPTIONS = Object.freeze({
  tools: { image: false },
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
});

/** Keeps Excalidraw mounted while the outer world controller repaints its overlays. */
const StableWorldCanvas = React.memo(function StableWorldCanvas({ initialData, handlers }) {
  return <Excalidraw
    initialData={initialData}
    excalidrawAPI={(value) => handlers.current.setApi(value)}
    theme="dark"
    name="Area map"
    autoFocus
    handleKeyboardGlobally={false}
    UIOptions={EXCALIDRAW_UI_OPTIONS}
    onPointerDown={(tool, pointerDownState) => handlers.current.onPointerDown(tool, pointerDownState)}
    onPointerUp={() => handlers.current.onPointerUp()}
    onPointerUpdate={(value) => handlers.current.onPointerUpdate(value)}
    onScrollChange={(scrollX, scrollY, zoom) => handlers.current.onScrollChange(scrollX, scrollY, zoom)}
    onPaste={(data) => handlers.current.onPaste(data)}
    onChange={(elements, appState) => handlers.current.onChange(elements, appState)}
  />;
});

/** Stops one browser event before the shell or Excalidraw can reinterpret it. */
const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
/** Makes an immutable command-boundary copy. */
const clone = (value) => structuredClone(value);
/** Returns the selected Excalidraw IDs. */
const selectedIds = (appState) => Object.keys(appState?.selectedElementIds ?? {}).filter((id) => appState.selectedElementIds[id]);
/** Returns the visible leaf name of one Area key. */
const leaf = (area) => String(area ?? "").split("/").at(-1) || "Area";
/** Reports whether an element is a disposable composed-world helper. */
const ephemeral = (element) => element.customData?.tangentWorldEphemeral || element.customData?.tangent?.role === "endpoint-dot";
/** Formats one rectangle for read-only diagnostics. */
const rectWords = (value) => value ? `${value.x},${value.y} ${value.width}×${value.height}` : "—";

/** Rewrites temporary claimed IDs to their current world IDs. */
function remapClaimedIdentities(value, mapping) {
  if (Array.isArray(value)) return value.map((item) => remapClaimedIdentities(item, mapping));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (["id", "elementId", "containerId", "frameId"].includes(key) && typeof item === "string") return [key, resolveClaimedId(mapping, item)];
    return [key, remapClaimedIdentities(item, mapping)];
  }));
}

/** Resolves a temporary-ID chain without following malformed cycles. */
function resolveClaimedId(mapping, id) {
  let current = id;
  const seen = new Set();
  while (mapping.has(current) && !seen.has(current)) {
    seen.add(current); current = mapping.get(current);
  }
  return current;
}

/** Returns a source ID that cannot reuse a copied world identity. */
function freshSourceId(element, used) {
  let candidate = !String(element.id).startsWith("tw-") ? String(element.id) : `area-map-${crypto.randomUUID()}`;
  while (used.has(candidate)) candidate = `area-map-${crypto.randomUUID()}`;
  used.add(candidate);
  return candidate;
}

/** Returns the smallest finite hull for one element collection. */
function elementHull(elements) {
  if (!elements.length) return null;
  const x = Math.min(...elements.map((element) => Number(element.x)));
  const y = Math.min(...elements.map((element) => Number(element.y)));
  const right = Math.max(...elements.map((element) => Number(element.x) + Number(element.width)));
  const bottom = Math.max(...elements.map((element) => Number(element.y) + Number(element.height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** Infers Excalidraw's discrete transform handle from its pointer-down point. */
function transformHandle(box, point, zoom = 1) {
  if (!box || !point) return null;
  const tolerance = 18 / Math.max(0.1, zoom); const middleX = box.x + box.width / 2; const middleY = box.y + box.height / 2;
  /** Reports whether the pointer is near one handle point. */
  const near = (x, y) => Math.hypot(point.x - x, point.y - y) <= tolerance;
  if (near(box.x, box.y)) return "nw";
  if (near(box.x + box.width, box.y)) return "ne";
  if (near(box.x, box.y + box.height)) return "sw";
  if (near(box.x + box.width, box.y + box.height)) return "se";
  if (near(middleX, box.y)) return "n";
  if (near(middleX, box.y + box.height)) return "s";
  if (near(box.x, middleY)) return "w";
  if (near(box.x + box.width, middleY)) return "e";
  return null;
}

/** Reports whether one pointer starts on a selected element's hit rectangle. */
function pointerHits(element, point, zoom = 1) {
  if (!element || !point) return false;
  const pad = 10 / Math.max(0.1, zoom);
  return point.x >= Number(element.x) - pad && point.y >= Number(element.y) - pad
    && point.x <= Number(element.x) + Number(element.width) + pad
    && point.y <= Number(element.y) + Number(element.height) + pad;
}

/** Replaces disposable hidden elements with their authoritative composed values. */
function restoreMaskedElements(elements, composition, hiddenIds) {
  const incoming = new Map(elements.map((element) => [element.id, element]));
  for (const element of composition.scene.elements) {
    if (hiddenIds.has(element.id) || element.customData?.tangent?.role === "area-region" && (!incoming.has(element.id) || incoming.get(element.id)?.isDeleted)) incoming.set(element.id, clone(element));
  }
  const order = composition.scene.elements.map((element) => incoming.get(element.id)).filter(Boolean);
  const known = new Set(order.map((element) => element.id));
  return order.concat(elements.filter((element) => !known.has(element.id)));
}

/** Returns the deepest structural Area containing one scene point. */
function areaAtPoint(composition, point, fallback) {
  return [...composition.regionRects]
    .filter(([, box]) => point.x >= box.x && point.y >= box.y && point.x <= box.x + box.width && point.y <= box.y + box.height)
    .sort(([left], [right]) => right.split("/").length - left.split("/").length)[0]?.[0] ?? fallback;
}

/** Builds the solver inputs from one immutable pointer baseline. */
function solverBaseline(world) {
  const regions = new Map(world.areas.map((node) => [node.key, clone(node.region)]));
  const blockHulls = new Map(); const inkHulls = new Map();
  for (const node of world.areas) {
    const hulls = worldCore.shardHulls(node.shard.scene);
    if (hulls.blocks) blockHulls.set(node.key, hulls.blocks);
    if (hulls.ink) inkHulls.set(node.key, hulls.ink);
  }
  return { areas: world.areas.map((node) => node.key), regions, blockHulls, inkHulls };
}

/** Renders the controller-owned world in one Excalidraw instance. */
export function AreaMapWorld({ host, bridge, options }) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = options.controller ?? createAreaMapWorldController({
    world: options.world,
    getDocuments: options.getDocuments,
    focus: options.focus,
    loadShard: options.loadShard,
    reloadWorld: options.reloadWorld,
    persistWorld: options.persistWorld ?? options.onWorldChange,
    persistView: options.persistView,
    onBack: options.onBack,
    onNavigation: options.onNavigation,
    /** Forwards coordinate-free diagnostics to the host and browser listeners. */
    onEvent(event) {
      options.onEvent?.(event);
      try { globalThis.dispatchEvent?.(new CustomEvent("tangent:area-map", { detail: event })); } catch { /* Diagnostics never block the map. */ }
    },
  });
  const controller = controllerRef.current;
  const [state, setState] = useState(controller.snapshot());
  const initialDataRef = useRef({
    ...state.scene,
    appState: { ...(state.scene.appState ?? {}), scrollX: state.camera.scrollX, scrollY: state.camera.scrollY, zoom: { value: state.camera.zoom } },
  });
  const canvasHandlersRef = useRef({});
  const [api, setApi] = useState(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [widePicker, setWidePicker] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState({ id: 0, text: "" });
  const initializingRef = useRef(true);
  const pointerBaselineRef = useRef(null);
  const pointerCompositionRef = useRef(null);
  const pointerStateRef = useRef(null);
  const pointerCurrentRef = useRef(null);
  const lastPointerRef = useRef(null);
  const pointerHandleRef = useRef(null);
  const wallAnnouncedRef = useRef(false);
  const outlineProtectionAnnouncedRef = useRef(false);
  const pointerSelectedRef = useRef(new Set());
  const additiveSelectionRef = useRef(null);
  const stableSelectionRef = useRef(new Set(state.selection));
  const pointerSettlingRef = useRef(false);
  const pointerSettleTokenRef = useRef(0);
  const pointerSettleWaitersRef = useRef([]);
  const pointerDomActiveRef = useRef(false);
  const pastePlacementRef = useRef(null);
  const pasteTimerRef = useRef(null);
  const nonPointerKindRef = useRef(null);
  const nonPointerSettleRef = useRef(0);
  const actionKindRef = useRef(null);
  const programmaticSelectionRef = useRef(null);
  const claimedRuntimeIdsRef = useRef(new Map());
  const claimedOriginsRef = useRef(new Map());
  const textEditRef = useRef(null);
  const fingerprintRef = useRef(boardCore.authoredFingerprint(state.scene.elements));
  const appliedProjectionRef = useRef("");
  const previousSaveStateRef = useRef(state.save.state);
  const announcedReasonRef = useRef(0);
  const deferredCanvasUpdateTokenRef = useRef(0);
  const projectionTokenRef = useRef(0);
  const expectedProjectionsRef = useRef([]);

  /** Returns one stable key for an Excalidraw selection. */
  function selectionKey(ids) {
    return JSON.stringify([...new Set(ids ?? [])].sort());
  }

  /** Applies one exact controller projection and fences its matching callback. */
  function projectCanvas(update, reason = "unknown") {
    if (!api) return null;
    const elements = update.elements ?? api.getSceneElements?.() ?? state.scene.elements;
    const selection = Object.hasOwn(update.appState ?? {}, "selectedElementIds")
      ? selectedIds({ selectedElementIds: update.appState.selectedElementIds })
      : selectedIds(api.getAppState?.());
    const token = {
      id: ++projectionTokenRef.current,
      fingerprint: boardCore.authoredFingerprint(elements),
      selection: selectionKey(selection),
      reason,
      includesElements: Boolean(update.elements),
    };
    expectedProjectionsRef.current.push(token);
    if (expectedProjectionsRef.current.length > 32) expectedProjectionsRef.current.splice(0, expectedProjectionsRef.current.length - 32);
    if (token.includesElements) {
      appliedProjectionRef.current = token.fingerprint;
      fingerprintRef.current = token.fingerprint;
    }
    api.updateScene(update);
    return token;
  }

  /** Consumes one callback produced by an exact controller projection. */
  function consumeExpectedProjection(elements, appState) {
    const fingerprint = boardCore.authoredFingerprint(elements);
    const selection = selectionKey(selectedIds(appState));
    const index = expectedProjectionsRef.current.findIndex((token) => token.fingerprint === fingerprint && token.selection === selection);
    if (index < 0) return false;
    const [token] = expectedProjectionsRef.current.splice(index, 1);
    fingerprintRef.current = fingerprint;
    if (token.includesElements) appliedProjectionRef.current = fingerprint;
    return true;
  }

  /** Applies one Excalidraw correction after its current React lifecycle returns. */
  function deferCanvasUpdate(update, reason = "unknown") {
    const token = ++deferredCanvasUpdateTokenRef.current;
    queueMicrotask(() => {
      if (token !== deferredCanvasUpdateTokenRef.current) return;
      projectCanvas(update, reason);
    });
  }

  /** Lets a new user command supersede a queued projection correction. */
  function cancelDeferredCanvasUpdate() {
    deferredCanvasUpdateTokenRef.current += 1;
  }

  // Excalidraw calls onChange from its componentDidUpdate lifecycle. Keep the
  // controller synchronous, but mirror its newest snapshot after that React
  // lifecycle returns so a preview cannot recursively update the parent tree.
  useEffect(() => {
    let active = true; let queued = false; let latest = controller.snapshot();
    const unsubscribe = controller.subscribe((value) => {
      latest = value;
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) setState(latest);
      });
    });
    return () => { active = false; unsubscribe(); };
  }, [controller]);

  /** Prints one action result and gives assistive technology a fresh live node. */
  function announce(message, { visible = true } = {}) {
    if (!message) return;
    if (visible) setNotice(message);
    setAnnouncement((value) => ({ id: value.id + 1, text: message }));
  }

  /** Announces at most one sibling wall during the current command boundary. */
  function announceWall(area) {
    if (!area || wallAnnouncedRef.current) return;
    wallAnnouncedRef.current = true; announce(`stopped at ${leaf(area)}`);
  }

  /** Changes one fold mask and announces the completed view action. */
  function changeFold(area) {
    const folded = controller.toggleFold(area);
    announce(`${leaf(area)} ${folded ? "folded" : "unfolded"}`);
    return folded;
  }

  /** Announces each save word once when controller state crosses that boundary. */
  useEffect(() => {
    if (state.save.state === previousSaveStateRef.current) return;
    previousSaveStateRef.current = state.save.state;
    const message = {
      saving: "Saving map…", saved: "Map saved.", blocked: "Map not saved. Retry.", conflict: "Map not saved. Reload or keep mine.", dirty: "Map change queued.",
    }[state.save.state];
    if (message) announce(message, { visible: false });
  }, [state.save.state]);

  /** Announces recovery and structural refresh results once per controller action. */
  useEffect(() => {
    if (announcedReasonRef.current === state.revision) return;
    announcedReasonRef.current = state.revision;
    const message = {
      "draft-found": "A saved recovery draft is available.",
      "draft-restored": "Recovery draft restored. Not saved.",
      "draft-discarded": "Recovery draft discarded.",
      "tree-reconciled": "Area hierarchy updated.",
      "tree-refresh-failed": "Area hierarchy update failed. The current map remains open.",
      "rebase-failed": "Recovery could not finish. The map is not saved.",
    }[state.reason];
    if (message) announce(message, { visible: state.reason === "tree-refresh-failed" || state.reason === "rebase-failed" });
  }, [state.revision]);

  /** Applies one controller projection without allowing Excalidraw to own history. */
  useEffect(() => {
    if (!api) return;
    const liveEditingId = api.getAppState?.().editingTextElement?.id;
    if (liveEditingId && textEditRef.current) return;
    // A brand-new Excalidraw element has no baseline selection. Let Excalidraw
    // own that live pointer frame, then project once the release fence closes.
    if (pointerBaselineRef.current && !pointerSelectedRef.current.size) return;
    const elementSelection = Object.fromEntries([...state.selection].map((id) => [id, true]));
    const projectionFingerprint = boardCore.authoredFingerprint(state.scene.elements);
    const currentSelection = selectedIds(api.getAppState?.()).sort().join("\0");
    const desiredSelection = [...state.selection].sort().join("\0");
    const sceneChanged = appliedProjectionRef.current !== projectionFingerprint;
    if (!sceneChanged && currentSelection === desiredSelection) return;
    if (sceneChanged) api.addFiles?.(Object.values(state.scene.files ?? {}));
    deferCanvasUpdate({ ...(sceneChanged ? { elements: state.scene.elements } : {}), appState: { selectedElementIds: elementSelection }, captureUpdate: "NEVER" }, "projection");
    if (sceneChanged) api.history?.clear?.();
    if (initializingRef.current) requestAnimationFrame(() => requestAnimationFrame(() => {
      fingerprintRef.current = boardCore.authoredFingerprint(api.getSceneElements?.() ?? state.scene.elements);
      initializingRef.current = false;
    }));
  }, [api, state.revision]);

  /** Selects a structural region after its HTML label takes browser focus. */
  function selectArea(area) {
    const element = controller.selectArea(area);
    if (!element) return null;
    stableSelectionRef.current = new Set([element.id]);
    programmaticSelectionRef.current = new Set([element.id]);
    requestAnimationFrame(() => projectCanvas({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: "NEVER" }, "area-selection"));
    return element;
  }

  /** Scrolls to one target chosen by camera history. */
  function scrollToArea(area, { push = true, select = true } = {}) {
    const element = controller.fitArea(area, { push, select });
    if (!element || !api) return null;
    if (select) {
      programmaticSelectionRef.current = new Set([element.id]);
      projectCanvas({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: "NEVER" }, "camera-selection");
    }
    api.scrollToContent([element], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    announce(`${leaf(area)} in view`);
    return element;
  }

  /** Returns the last scene point, or the current viewport center. */
  function placementPoint() {
    return boardCore.insertionPoint(api?.getAppState?.() ?? {}, lastPointerRef.current);
  }

  /** Opens the contextual block picker for the deepest Area under the pointer. */
  function openPicker() {
    const point = placementPoint();
    const area = areaAtPoint(state.composition, point, state.locatedArea);
    const center = boardCore.insertionPoint(api?.getAppState?.() ?? {}, null);
    setWidePicker(false); setPickerQuery("");
    setPicker({ area, point, outside: ![...state.composition.regionRects.values()].some((box) => point.x >= box.x && point.y >= box.y && point.x <= box.x + box.width && point.y <= box.y + box.height), dock: point.x < center.x ? "right" : "left" });
  }

  /** Places one new source-owned Tangent block without changing the camera. */
  function placeBlock(choice, keepOpen = false, target = picker) {
    if (!choice) return;
    const area = target?.area ?? state.locatedArea;
    if (choice.kind === "area" && state.world.areas.some((node) => node.key === choice.area)) {
      selectArea(choice.area); setPicker(keepOpen ? target : null); setPickerQuery(""); return;
    }
    const point = target?.point ?? placementPoint();
    const id = crypto.randomUUID();
    const canonical = controller.snapshot().composition.scene;
    const next = boardCore.addBlock(canonical, choice, point, id);
    for (const element of next.elements.slice(canonical.elements.length)) {
      element.customData = { ...(element.customData ?? {}), tangentWorld: { owner: area } };
    }
    publish(next.elements, api?.getAppState?.() ?? {});
    const runtime = worldCore.runtimeId(area, id);
    controller.setSelection([runtime]); programmaticSelectionRef.current = new Set([runtime]);
    requestAnimationFrame(() => projectCanvas({ appState: { selectedElementIds: { [runtime]: true } }, captureUpdate: "NEVER" }, "placed-block-selection"));
    setPicker(keepOpen ? target : null); setPickerQuery("");
  }

  /** Sends one selected semantic block action to the shell. */
  function openBlock(block, verb = "open") {
    const tangent = boardCore.tangentOf(block);
    if (tangent) options.onEntityVerb?.({ verb, ...tangent });
  }

  /** Removes one block and its cached label from its existing owner. */
  function hideBlock(block) {
    if (!block) return;
    const next = clone(controller.snapshot().composition.scene);
    const ids = new Set([block.id, ...(block.boundElements ?? []).filter((binding) => binding.type === "text").map((binding) => binding.id)]);
    for (const element of next.elements) if (ids.has(element.id)) element.isDeleted = true;
    publish(next.elements, api?.getAppState?.() ?? {}); controller.setSelection([]); programmaticSelectionRef.current = null;
  }

  /** Opens one non-pointer command and keeps later callbacks inside it. */
  function beginNonPointer(kind = "edit") {
    if (pointerBaselineRef.current) return;
    if (!nonPointerKindRef.current) { controller.beginGesture(kind); nonPointerKindRef.current = kind; }
  }

  /** Closes the active non-pointer command exactly once. */
  function finishNonPointer() {
    nonPointerSettleRef.current += 1;
    if (!nonPointerKindRef.current) return;
    const kind = nonPointerKindRef.current; nonPointerKindRef.current = null; controller.endGesture(kind);
  }

  /** Closes a stable paste, duplicate, delete, nudge, style, or completed text edit. */
  function settleNonPointer() {
    const token = ++nonPointerSettleRef.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === nonPointerSettleRef.current && !api?.getAppState?.().editingTextElement) finishNonPointer();
    }));
  }

  /** Clears an Excalidraw text editor whose temporary source ID was recomposed. */
  function clearStaleEditingText(appState = api?.getAppState?.(), { force = false } = {}) {
    const editing = appState?.editingTextElement;
    if (!editing?.id) return false;
    const snapshot = controller.snapshot();
    const validRuntimeIds = new Set(snapshot.composition.scene.elements.map((element) => element.id));
    if (validRuntimeIds.has(editing.id)) return false;
    const claimed = resolveClaimedId(claimedRuntimeIdsRef.current, editing.id);
    if (!force && claimed && validRuntimeIds.has(claimed) && appState?.activeTool?.type === "text") return false;
    const selection = new Set(selectedIds(appState).map((id) => resolveClaimedId(claimedRuntimeIdsRef.current, id)).filter((id) => validRuntimeIds.has(id)));
    projectCanvas({ elements: snapshot.scene.elements, appState: { editingTextElement: null, selectedElementIds: Object.fromEntries([...selection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "stale-text-repair");
    return true;
  }

  /** Captures one immutable pointer baseline before Excalidraw changes selection. */
  function beginPointerGesture(origin, pointerDownState = { origin }) {
    if (pointerBaselineRef.current) return;
    if (textEditRef.current && api?.getAppState?.().editingTextElement) return;
    cancelDeferredCanvasUpdate();
    clearStaleEditingText(undefined, { force: true });
    finishNonPointer(); pointerSettlingRef.current = false; programmaticSelectionRef.current = null;
    claimedRuntimeIdsRef.current = new Map();
    claimedOriginsRef.current = new Map();
    wallAnnouncedRef.current = false; outlineProtectionAnnouncedRef.current = false;
    pointerBaselineRef.current = controller.beginGesture("pointer");
    pointerCompositionRef.current = worldCore.composeAreaMapWorld(pointerBaselineRef.current);
    pointerStateRef.current = { ...pointerDownState, origin }; pointerCurrentRef.current = origin;
    const liveSelection = controller.snapshot().selection;
    if (liveSelection.size) stableSelectionRef.current = new Set(liveSelection);
    const zoom = api?.getAppState?.().zoom?.value ?? 1;
    const additive = Boolean(pointerDownState.shiftKey);
    const baselineElements = new Map(pointerCompositionRef.current.scene.elements.map((element) => [element.id, element]));
    const rawHitElement = additive ? [...pointerCompositionRef.current.scene.elements].reverse().find((element) => element.customData?.tangent?.role !== "area-region" && !ephemeral(element) && pointerHits(element, origin, zoom)) : null;
    const boundContainer = rawHitElement?.containerId ? baselineElements.get(rawHitElement.containerId) : null;
    const hitElement = boundContainer && boardCore.tangentOf(boundContainer) ? boundContainer : rawHitElement;
    if (hitElement) {
      const nextSelection = new Set([...stableSelectionRef.current, hitElement.id]);
      stableSelectionRef.current = nextSelection; additiveSelectionRef.current = nextSelection;
      controller.setSelection(nextSelection); programmaticSelectionRef.current = nextSelection;
      projectCanvas({ appState: { selectedElementIds: Object.fromEntries([...nextSelection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "additive-pointer-selection");
    }
    const selectedElements = pointerCompositionRef.current.scene.elements.filter((element) => stableSelectionRef.current.has(element.id));
    const hitBlock = selectedElements.some((element) => element.customData?.tangent?.role !== "area-region" && pointerHits(element, origin, zoom));
    const deepest = areaAtPoint(pointerCompositionRef.current, origin, null);
    const hitRegion = selectedElements.some((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === deepest && pointerHits(element, origin, zoom));
    pointerSelectedRef.current = hitBlock || hitRegion ? new Set(stableSelectionRef.current) : new Set();
    const selectedRegion = pointerCompositionRef.current.scene.elements.find((element) => pointerSelectedRef.current.has(element.id) && element.customData?.tangent?.role === "area-region");
    pointerHandleRef.current = selectedRegion ? transformHandle(selectedRegion, origin, zoom) : null;
    controller.recordEvent("area_map_pointer_down", { selectedCount: pointerSelectedRef.current.size, selectedRegion: selectedRegion?.customData?.tangent?.area ?? null, deepestArea: deepest, handle: pointerHandleRef.current });
  }

  /** Solves one region preview from the pointer-down world, independent of canvas hit mode. */
  function previewPointerGesture(pointer) {
    pointerCurrentRef.current = pointer; lastPointerRef.current = pointer;
    const baselineWorld = pointerBaselineRef.current; const baselineComposition = pointerCompositionRef.current;
    if (!baselineWorld || !baselineComposition || !pointerStateRef.current) return;
    const selected = new Set([...pointerSelectedRef.current].map((id) => baselineComposition.scene.elements.find((element) => element.id === id)?.customData?.tangent?.area).filter(Boolean));
    for (const area of [...selected]) for (const ancestor of selected) if (area !== ancestor && area.startsWith(`${ancestor}/`)) selected.delete(area);
    if (!selected.size) return;
    const solveStarted = performance.now();
    const preview = worldCore.solveAreaMapGesture(solverBaseline(baselineWorld), {
      selectedAreas: [...selected], handle: pointerHandleRef.current,
      desiredWorldDelta: { x: pointer.x - pointerStateRef.current.origin.x, y: pointer.y - pointerStateRef.current.origin.y },
    });
    controller.recordEvent("area_map_gesture_solved", { gestureKind: pointerHandleRef.current ? "region-resize" : "region-move", depth: Math.max(...[...selected].map((value) => value.split("/").length)), previewCount: selected.size, maximumTime: performance.now() - solveStarted, wallArea: preview.wall ?? null });
    if (!preview.valid) controller.recordEvent("area_map_invariant_failed", { gestureId: "pointer", invariantName: "finite-containment", affectedAreas: [...selected].sort() });
    const nextWorld = controller.world();
    for (const area of selected) {
      const node = nextWorld.areas.find((entry) => entry.key === area); const solved = preview.regions.get(area);
      if (node && solved) { node.region = clone(solved); node.region.source = "stored"; }
    }
    controller.preview(nextWorld, { changedAreas: selected });
    announceWall(preview.wall);
  }

  /** Publishes the current Excalidraw pointer state inside the open command. */
  function publishCurrentPointerState() {
    if (!pointerBaselineRef.current) return;
    const finalAppState = api?.getAppState?.() ?? {};
    if (!finalAppState.editingTextElement) {
      const claimedRuntimeIds = new Map(claimedRuntimeIdsRef.current);
      const finalElements = remapClaimedIdentities(api?.getSceneElements?.() ?? [], claimedRuntimeIds);
      const normalizedAppState = {
        ...finalAppState,
        selectedElementIds: Object.fromEntries(selectedIds(finalAppState).map((id) => [resolveClaimedId(claimedRuntimeIds, id), true])),
      };
      const fingerprint = boardCore.authoredFingerprint(finalElements);
      if (fingerprint !== fingerprintRef.current) {
        fingerprintRef.current = fingerprint;
        publish(clone(finalElements), normalizedAppState);
      }
    }
  }

  /** Resolves readers that wait for the release fence before persistence. */
  function resolvePointerSettleWaiters() {
    const waiters = pointerSettleWaitersRef.current.splice(0);
    for (const resolve of waiters) resolve();
  }

  /** Publishes Excalidraw's final release state inside the open pointer word. */
  function settlePointerCommand() {
    if (!pointerBaselineRef.current) { pointerSettlingRef.current = false; resolvePointerSettleWaiters(); return; }
    publishCurrentPointerState();
    controller.endGesture("pointer");
    pointerBaselineRef.current = null; pointerCompositionRef.current = null; pointerStateRef.current = null; pointerCurrentRef.current = null; pointerHandleRef.current = null;
    pointerSelectedRef.current = new Set(); pointerSettlingRef.current = false;
    resolvePointerSettleWaiters();
  }

  /** Waits until a released pointer command has entered controller history. */
  function waitForPointerSettle() {
    if (!pointerBaselineRef.current && !pointerSettlingRef.current) return Promise.resolve();
    return new Promise((resolve) => pointerSettleWaitersRef.current.push(resolve));
  }

  /** Finishes the one pointer command after Excalidraw's release callback settles. */
  function endPointerGesture() {
    if (!pointerBaselineRef.current || pointerSettlingRef.current) return;
    pointerSettlingRef.current = true;
    // Publish the current release snapshot now. The double-RAF pass below
    // still absorbs Excalidraw's final callback into this same history word.
    if (api?.getAppState?.().activeTool?.type !== "text") publishCurrentPointerState();
    const token = ++pointerSettleTokenRef.current;
    const additiveSelection = additiveSelectionRef.current ? new Set(additiveSelectionRef.current) : null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== pointerSettleTokenRef.current) return;
      settlePointerCommand();
      const claimedRuntimeIds = new Map(claimedRuntimeIdsRef.current);
      const validRuntimeIds = new Set(controller.snapshot().composition.scene.elements.map((element) => element.id));
      const settledSelection = new Set([
        ...(additiveSelection ?? []),
        ...(programmaticSelectionRef.current ?? []),
        ...selectedIds(api?.getAppState?.()),
      ].map((id) => resolveClaimedId(claimedRuntimeIds, id)).filter((id) => validRuntimeIds.has(id)));
      if (settledSelection.size) {
        stableSelectionRef.current = settledSelection; programmaticSelectionRef.current = settledSelection;
        controller.setSelection(settledSelection);
        projectCanvas({ appState: { selectedElementIds: Object.fromEntries([...settledSelection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "pointer-release-selection");
      }
      requestAnimationFrame(() => { additiveSelectionRef.current = null; });
    }));
  }

  /** Applies one corrected Excalidraw update to source-owned shards. */
  function publish(elements, appState) {
    if (!pointerBaselineRef.current && !nonPointerKindRef.current) {
      wallAnnouncedRef.current = false; outlineProtectionAnnouncedRef.current = false;
    }
    const baselineWorld = pointerBaselineRef.current ?? controller.world();
    const baselineComposition = pointerCompositionRef.current ?? worldCore.composeAreaMapWorld(baselineWorld);
    const nextWorld = pointerBaselineRef.current ? controller.world() : clone(baselineWorld);
    const changedAreas = new Set(); const changedOwners = new Set();
    const incomingById = new Map(elements.map((element) => [element.id, element]));
    const protectedOutline = baselineComposition.scene.elements.some((element) => element.customData?.tangent?.role === "area-region" && (!incomingById.has(element.id) || incomingById.get(element.id)?.isDeleted));
    if (protectedOutline && !outlineProtectionAnnouncedRef.current) {
      outlineProtectionAnnouncedRef.current = true; announce("Area outlines come from the Area tree");
    }
    const geometryCommand = !pointerBaselineRef.current && [actionKindRef.current, nonPointerKindRef.current].includes("nudge") ? "keyboard-nudge" : null;
    const changedRegions = selectedAreaMapRegionChanges(elements, selectedIds(appState), baselineComposition.regionRects, { geometryCommand });
    if (changedRegions.length) {
      const selected = new Set(changedRegions.map((element) => element.customData.tangent.area));
      for (const area of [...selected]) for (const ancestor of selected) if (area !== ancestor && area.startsWith(`${ancestor}/`)) selected.delete(area);
      const first = changedRegions.find((element) => selected.has(element.customData.tangent.area));
      const area = first.customData.tangent.area;
      const old = baselineComposition.regionRects.get(area);
      const horizontalResize = Math.abs(Number(first.width) - Number(old.width)) >= 0.01;
      const verticalResize = Math.abs(Number(first.height) - Number(old.height)) >= 0.01;
      const inferredHandle = `${horizontalResize ? Math.abs(Number(first.x) - Number(old.x)) >= 0.01 ? "w" : "e" : ""}${verticalResize ? Math.abs(Number(first.y) - Number(old.y)) >= 0.01 ? "n" : "s" : ""}`;
      const handle = String(pointerBaselineRef.current ? pointerHandleRef.current ?? "" : inferredHandle);
      const pointerDelta = pointerCurrentRef.current && pointerStateRef.current ? {
        x: pointerCurrentRef.current.x - pointerStateRef.current.origin.x,
        y: pointerCurrentRef.current.y - pointerStateRef.current.origin.y,
      } : null;
      const desiredWorldDelta = pointerDelta ?? (handle ? {
        x: handle.includes("w") ? first.x - old.x : handle.includes("e") ? first.width - old.width : 0,
        y: handle.includes("n") ? first.y - old.y : handle.includes("s") ? first.height - old.height : 0,
      } : { x: first.x - old.x, y: first.y - old.y });
      const solveStarted = performance.now();
      const preview = worldCore.solveAreaMapGesture(solverBaseline(baselineWorld), { selectedAreas: [...selected], handle: handle || null, desiredWorldDelta });
      controller.recordEvent("area_map_gesture_solved", { gestureKind: handle ? "region-resize" : "region-move", depth: Math.max(...[...selected].map((value) => value.split("/").length)), previewCount: selected.size, maximumTime: performance.now() - solveStarted, wallArea: preview.wall ?? null });
      if (!preview.valid) controller.recordEvent("area_map_invariant_failed", { gestureId: "pointer", invariantName: "finite-containment", affectedAreas: [...selected].sort() });
      for (const selectedArea of selected) {
        const node = nextWorld.areas.find((entry) => entry.key === selectedArea);
        const solved = preview.regions.get(selectedArea);
        if (!node || !solved) continue;
        node.region = clone(solved); node.region.source = "stored"; changedAreas.add(selectedArea);
      }
      announceWall(preview.wall);
    }

    const restored = restoreMaskedElements(elements, baselineComposition, state.hiddenIds);
    const baselineElements = new Map(baselineComposition.scene.elements.map((element) => [element.id, element]));
    const selectedSources = pointerSelectedRef.current.size ? pointerSelectedRef.current : new Set(selectedIds(appState));
    const selectedWithBindings = new Set(selectedSources);
    for (const id of selectedSources) for (const binding of baselineElements.get(id)?.boundElements ?? []) selectedWithBindings.add(binding.id);
    const nextComposition = worldCore.composeAreaMapWorld(nextWorld);
    /** Returns the composed offset change for one source owner. */
    const ownerMotion = (owner) => {
      const before = baselineComposition.offsets.get(owner) ?? { x: 0, y: 0 }; const after = nextComposition.offsets.get(owner) ?? before;
      return { x: after.x - before.x, y: after.y - before.y };
    };
    const restoredIds = new Set(restored.map((element) => element.id));
    const completeRuntime = [...restored];
    for (const element of baselineComposition.scene.elements) {
      if (restoredIds.has(element.id) || element.customData?.tangent?.role === "area-region" || ephemeral(element)) continue;
      if (selectedSources.has(element.id) || selectedSources.has(element.containerId)) continue;
      completeRuntime.push(clone(element));
    }
    let authoredRuntime = completeRuntime.filter((element) => element.customData?.tangent?.role !== "area-region" && !ephemeral(element)).map((element) => {
      if (!pointerBaselineRef.current || selectedWithBindings.has(element.id) || selectedSources.has(element.containerId)) return element;
      const original = baselineElements.get(element.id); const origin = baselineComposition.origins.get(element.id);
      if (!original || !origin) return element;
      const motion = ownerMotion(origin.owner); const carried = clone(original); carried.x += motion.x; carried.y += motion.y; return carried;
    });
    const origins = new Map([...baselineComposition.origins, ...nextComposition.origins]);
    for (const element of authoredRuntime) {
      const claimedOrigin = claimedOriginsRef.current.get(element.id);
      if (!claimedOrigin) continue;
      origins.set(element.id, claimedOrigin);
      element.customData = { ...(element.customData ?? {}), tangentWorld: claimedOrigin };
    }
    const pastePlacement = pastePlacementRef.current;
    const currentElements = new Map(nextComposition.scene.elements.map((element) => [element.id, element]));
    const candidateOwners = new Set([...selectedSources].flatMap((id) => {
      const element = baselineElements.get(id) ?? currentElements.get(id);
      return element && element.customData?.tangent?.role !== "area-region" && !ephemeral(element) ? [origins.get(id)?.owner] : [];
    }).filter(Boolean));
    if (pointerBaselineRef.current) for (const origin of claimedOriginsRef.current.values()) if (origin?.owner) candidateOwners.add(origin.owner);
    const pointer = pastePlacement?.point ?? pointerStateRef.current?.origin;
    const owners = new Set(nextWorld.areas.map((node) => node.key));
    const sourceIds = new Map();
    const claimedRuntimeIds = new Map();
    for (const origin of origins.values()) {
      const values = sourceIds.get(origin.owner) ?? new Set(); values.add(origin.sourceId); sourceIds.set(origin.owner, values);
    }
    /** Claims a new runtime element without trusting copied source identity. */
    const claim = (element, requestedOwner) => {
      const incomingId = element.id;
      const owner = owners.has(requestedOwner) ? requestedOwner : state.locatedArea;
      const used = sourceIds.get(owner) ?? new Set(); sourceIds.set(owner, used);
      const sourceId = freshSourceId(element, used);
      const origin = { owner, sourceId }; origins.set(element.id, origin);
      const runtimeId = worldCore.runtimeId(owner, sourceId);
      for (const mapping of [claimedRuntimeIds, claimedRuntimeIdsRef.current]) {
        const aliases = [...mapping].filter(([alias]) => resolveClaimedId(mapping, alias) === incomingId).map(([alias]) => alias);
        for (const alias of aliases) {
          mapping.set(alias, runtimeId);
          claimedOriginsRef.current.set(alias, origin);
        }
        mapping.set(incomingId, runtimeId);
      }
      claimedOriginsRef.current.set(incomingId, origin);
      claimedOriginsRef.current.set(runtimeId, origin);
      candidateOwners.add(owner);
      element.customData = { ...(element.customData ?? {}), tangentWorld: origin };
      return origin;
    };
    // Claim blocks and free ink first so a new bound arrow can inherit its start block's owner.
    for (const element of authoredRuntime.filter((value) => value.type !== "arrow")) {
      if (origins.has(element.id)) continue;
      const point = pointer ?? { x: Number(element.x ?? 0) + Number(element.width ?? 0) / 2, y: Number(element.y ?? 0) + Number(element.height ?? 0) / 2 };
      const copiedOwner = element.customData?.tangentWorld?.owner;
      claim(element, ownerForNewAreaMapElement({ copiedOwner, pasteOwner: pastePlacement?.area, pointOwner: areaAtPoint(baselineComposition, point, state.locatedArea) }));
    }
    const authoredElementById = new Map(authoredRuntime.map((element) => [element.id, element]));
    /** Resolves one binding through direct, claimed, and source-origin identities. */
    const resolveBindingElement = (id) => {
      if (!id) return null;
      if (authoredElementById.has(id)) return authoredElementById.get(id);
      const claimed = resolveClaimedId(claimedRuntimeIdsRef.current, id);
      if (authoredElementById.has(claimed)) return authoredElementById.get(claimed);
      const matches = [...origins].filter(([, origin]) => worldCore.runtimeId(origin.owner, origin.sourceId) === claimed || origin.sourceId === id);
      return matches.length === 1 ? authoredElementById.get(matches[0][0]) ?? null : null;
    };
    /** Returns the connectable element at an arrow endpoint when Excal omits one side. */
    const endpointTarget = (arrow, side, oppositeId = null) => {
      const direct = resolveBindingElement(arrow[`${side}Binding`]?.elementId);
      if (direct) return direct;
      const points = arrow.points ?? [[0, 0], [Number(arrow.width ?? 0), Number(arrow.height ?? 0)]];
      const offset = side === "start" ? points[0] : points.at(-1);
      const point = { x: Number(arrow.x ?? 0) + Number(offset?.[0] ?? 0), y: Number(arrow.y ?? 0) + Number(offset?.[1] ?? 0) };
      return authoredRuntime.filter((element) => element.id !== arrow.id && !element.isDeleted && origins.has(element.id)
        && element.id !== oppositeId
        && ["rectangle", "diamond", "ellipse"].includes(element.type)
        && point.x >= Number(element.x) - 24 && point.y >= Number(element.y) - 24
        && point.x <= Number(element.x) + Number(element.width) + 24 && point.y <= Number(element.y) + Number(element.height) + 24)
        .sort((left, right) => {
          /** Returns squared distance from the endpoint to one element rectangle. */
          const distance = (element) => {
            const dx = Math.max(Number(element.x) - point.x, 0, point.x - Number(element.x) - Number(element.width));
            const dy = Math.max(Number(element.y) - point.y, 0, point.y - Number(element.y) - Number(element.height));
            return dx * dx + dy * dy;
          };
          const leftReverse = (left.boundElements ?? []).some((binding) => binding.type === "arrow" && binding.id === arrow.id);
          const rightReverse = (right.boundElements ?? []).some((binding) => binding.type === "arrow" && binding.id === arrow.id);
          return Number(rightReverse) - Number(leftReverse) || distance(left) - distance(right)
            || left.width * left.height - right.width * right.height;
        })[0] ?? null;
    };
    for (const element of authoredRuntime.filter((value) => value.type === "arrow")) {
      const startElement = endpointTarget(element, "start");
      const endElement = endpointTarget(element, "end", startElement?.id);
      const start = startElement ? origins.get(startElement.id) ?? startElement.customData?.tangentWorld : null;
      if (!origins.has(element.id)) {
        const copiedOwner = element.customData?.tangentWorld?.owner;
        const point = pointer ?? { x: Number(element.x ?? 0), y: Number(element.y ?? 0) };
        claim(element, ownerForNewAreaMapElement({ copiedOwner, pasteOwner: pastePlacement?.area, startOwner: start?.owner, pointOwner: areaAtPoint(baselineComposition, point, state.locatedArea) }));
      }
      const endpoints = clone(element.customData?.tangentWorldEndpoints ?? {});
      for (const side of ["start", "end"]) {
        const target = side === "start" ? startElement : endElement;
        const endpoint = target ? origins.get(target.id) ?? target.customData?.tangentWorld : null;
        if (!endpoint?.owner || !endpoint?.sourceId) continue;
        endpoints[side] = { owner: endpoint.owner, sourceId: endpoint.sourceId };
        element[`${side}Binding`] = { ...(element[`${side}Binding`] ?? {}), elementId: target.id };
        const boundElements = (target.boundElements ?? []).filter((binding) => binding.id !== element.id);
        target.boundElements = [...boundElements, { id: element.id, type: "arrow" }];
      }
      element.customData = { ...(element.customData ?? {}), ...(Object.keys(endpoints).length ? { tangentWorldEndpoints: endpoints } : {}) };
    }
    const finalClaimTargets = new Set([...claimedRuntimeIds.values()].map((id) => resolveClaimedId(claimedRuntimeIdsRef.current, id)));
    const selectedNewIds = selectedIds(appState).filter((id) => !baselineElements.has(id));
    if (finalClaimTargets.size === 1 && selectedNewIds.length === 1) {
      const target = [...finalClaimTargets][0];
      claimedRuntimeIds.set(selectedNewIds[0], target); claimedRuntimeIdsRef.current.set(selectedNewIds[0], target);
    }
    pastePlacementRef.current = null;
    if (pasteTimerRef.current !== null) { clearTimeout(pasteTimerRef.current); pasteTimerRef.current = null; }
    const authoredById = new Map(authoredRuntime.map((element) => [element.id, element]));
    const selectedBlocks = new Map();
    for (const id of selectedSources) {
      const element = authoredById.get(id); const origin = origins.get(id) ?? element?.customData?.tangentWorld;
      if (!element || !origin || !boardCore.tangentOf(element)) continue;
      const values = selectedBlocks.get(origin.owner) ?? []; values.push(element); selectedBlocks.set(origin.owner, values);
    }
    for (const [owner, blocks] of selectedBlocks) {
      const offset = baselineComposition.offsets.get(owner) ?? { x: 0, y: 0 }; const motion = ownerMotion(owner);
      const originals = blocks.map((block) => baselineElements.get(block.id)).filter(Boolean);
      const group = elementHull(originals.map((element) => ({ ...element, x: element.x - offset.x, y: element.y - offset.y })));
      if (!group) continue;
      const selectedSourceIds = new Set(blocks.map((block) => origins.get(block.id)?.sourceId));
      const sourceNode = baselineWorld.areas.find((node) => node.key === owner);
      const remainingBlockHull = worldCore.shardHulls({ ...(sourceNode?.shard.scene ?? {}), elements: (sourceNode?.shard.scene?.elements ?? []).filter((element) => !selectedSourceIds.has(element.id)) }).blocks;
      const first = blocks[0]; const firstOriginal = baselineElements.get(first.id);
      const solveStarted = performance.now();
      const solved = worldCore.solveOwnedElementGesture(solverBaseline(baselineWorld), {
        owner, kind: "block", rect: group, remainingBlockHull,
        desiredWorldDelta: { x: first.x - firstOriginal.x - motion.x, y: first.y - firstOriginal.y - motion.y },
      });
      controller.recordEvent("area_map_gesture_solved", { gestureKind: "block-move", depth: owner.split("/").length, previewCount: blocks.length, maximumTime: performance.now() - solveStarted, wallArea: solved.wall ?? null });
      if (!solved.valid) controller.recordEvent("area_map_invariant_failed", { gestureId: "pointer", invariantName: "owned-block-containment", affectedAreas: [owner] });
      for (const element of blocks) {
        const original = baselineElements.get(element.id);
        const corrected = { x: original.x + motion.x + solved.appliedDelta.x, y: original.y + motion.y + solved.appliedDelta.y };
        const correction = { x: corrected.x - element.x, y: corrected.y - element.y };
        element.x = corrected.x; element.y = corrected.y;
        for (const binding of element.boundElements ?? []) {
          const bound = authoredById.get(binding.id);
          if (bound) { bound.x += correction.x; bound.y += correction.y; }
        }
      }
      announceWall(solved.wall);
    }
    const byOwner = worldCore.splitComposed(authoredRuntime, origins, nextComposition.offsets);
    for (const [owner, authored] of byOwner) {
      if (pointerBaselineRef.current && !candidateOwners.has(owner)) continue;
      const node = nextWorld.areas.find((entry) => entry.key === owner);
      if (!node?.shard.scene) {
        if (node?.shard.state === "missing") node.shard.scene = boardCore.createEmptyScene();
        else { void controller.materialize(owner); announce(`${leaf(owner)} loading`); continue; }
      }
      const sourceRegions = new Set(node.shard.scene.elements.filter(boardCore.isAreaRegion).map((element) => element.id));
      const structural = node.shard.scene.elements.filter((element) => boardCore.isAreaRegion(element) || boardCore.isAreaBoundary(element) || sourceRegions.has(element.containerId));
      const nextElements = [...structural, ...authored];
      if (boardCore.authoredFingerprint(nextElements) === boardCore.authoredFingerprint(node.shard.scene.elements)) continue;
      node.shard.scene = { ...node.shard.scene, elements: nextElements, appState: { ...(node.shard.scene.appState ?? {}), viewBackgroundColor: "#ffffff" } };
      const authoredElements = nextElements.filter((element) => !element.isDeleted && !boardCore.isAreaRegion(element) && !boardCore.isAreaBoundary(element));
      const hulls = worldCore.shardHulls(node.shard.scene);
      node.shard.elementCount = authoredElements.length;
      node.shard.blockCount = authoredElements.filter((element) => boardCore.tangentOf(element)).length;
      node.shard.ownBlockHull = hulls.blocks; node.shard.ownInkHull = hulls.ink;
      changedOwners.add(owner);
    }
    if (!changedAreas.size && !changedOwners.size) {
      // A new Excalidraw pointer command owns its live frames. Projecting the
      // controller's first claimed frame here truncates later geometry.
      if (pointerBaselineRef.current && !pointerSelectedRef.current.size && claimedOriginsRef.current.size) return;
      const projection = controller.snapshot().scene;
      deferCanvasUpdate({ elements: projection.elements, captureUpdate: "NEVER" }, "no-change");
      return;
    }
    const changes = { changedAreas, changedOwners };
    if (pointerBaselineRef.current) controller.preview(nextWorld, changes);
    else {
      beginNonPointer(appState?.editingTextElement ? "text" : actionKindRef.current ?? "edit");
      controller.preview(nextWorld, changes);
      actionKindRef.current = null;
      if (!appState?.editingTextElement) settleNonPointer();
    }
    if (claimedRuntimeIds.size) {
      const validRuntimeIds = new Set(worldCore.composeAreaMapWorld(nextWorld).scene.elements.map((element) => element.id));
      const incomingSelection = new Set([...controller.snapshot().selection, ...selectedIds(appState)]);
      const remappedSelection = new Set([...incomingSelection]
        .map((id) => resolveClaimedId(claimedRuntimeIds, id))
        .filter((id) => validRuntimeIds.has(id)));
      stableSelectionRef.current = remappedSelection;
      const liveClaimedText = Boolean(appState?.editingTextElement);
      const liveNewPointer = Boolean(pointerBaselineRef.current && !pointerSelectedRef.current.size);
      programmaticSelectionRef.current = !liveClaimedText && remappedSelection.size ? remappedSelection : null;
      controller.setSelection(remappedSelection);
      if (!liveClaimedText && !liveNewPointer) deferCanvasUpdate({ appState: { selectedElementIds: Object.fromEntries([...remappedSelection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "claim");
    }
  }

  /** Runs the map-owned Escape order and applies a returned camera target. */
  function escape() {
    if (picker) { setPicker(null); setPickerQuery(""); return; }
    if (helpOpen) { setHelpOpen(false); return; }
    if (outlineOpen) { setOutlineOpen(false); return; }
    const result = controller.escape();
    if (result.kind === "selection") stableSelectionRef.current = new Set();
    programmaticSelectionRef.current = result.kind === "selection" ? null : programmaticSelectionRef.current;
    if (result.kind === "camera" && result.element && api) {
      api.scrollToContent([result.element], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
      announce(`${leaf(result.area)} in view`);
    }
  }

  /** Handles the map keys before Excalidraw or the shell can reinterpret them. */
  useEffect(() => {
      if (!api) return undefined;
    /** Routes one host key through map-owned command boundaries. */
    const keydown = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && (picker || helpOpen || outlineOpen)) { stop(event); escape(); return; }
      if (event.target.closest?.(".tangent-map-outline")) return;
      const appState = api.getAppState?.();
      if (textEditRef.current && appState?.editingTextElement) return;
      const clearedStaleEditing = clearStaleEditingText(appState);
      const typing = event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable);
      if (typing || appState?.editingTextElement && !clearedStaleEditing) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        cancelDeferredCanvasUpdate();
        if (pointerBaselineRef.current) {
          pointerSettleTokenRef.current += 1;
          settlePointerCommand();
          additiveSelectionRef.current = null;
        }
        const claimedRuntimeIds = new Map(claimedRuntimeIdsRef.current);
        const composition = controller.snapshot().composition;
        const validRuntimeIds = new Set(composition.scene.elements.map((element) => element.id));
        const sourceCandidates = new Map();
        for (const [runtimeId, origin] of composition.origins) {
          const values = sourceCandidates.get(origin.sourceId) ?? [];
          values.push(runtimeId); sourceCandidates.set(origin.sourceId, values);
        }
        const currentIds = selectedIds(api.getAppState?.());
        const resolvedIds = currentIds.map((id) => {
          if (validRuntimeIds.has(id)) return id;
          const claimed = resolveClaimedId(claimedRuntimeIds, id);
          if (claimed && validRuntimeIds.has(claimed)) return claimed;
          const candidates = sourceCandidates.get(id) ?? [];
          return candidates.length === 1 ? candidates[0] : null;
        });
        if (currentIds.some((id, index) => resolvedIds[index] && id !== resolvedIds[index])) {
          stop(event);
          const remappedSelection = new Set(resolvedIds.filter(Boolean));
          stableSelectionRef.current = remappedSelection; programmaticSelectionRef.current = remappedSelection;
          controller.setSelection(remappedSelection);
          pointerSettlingRef.current = false;
          actionKindRef.current = "nudge";
          const distance = event.shiftKey ? 10 : 1;
          const delta = {
            x: event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
            y: event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
          };
          const elements = clone(controller.snapshot().composition.scene.elements);
          const byId = new Map(elements.map((element) => [element.id, element]));
          const moveIds = new Set(remappedSelection);
          for (const id of remappedSelection) for (const binding of byId.get(id)?.boundElements ?? []) moveIds.add(binding.id);
          for (const id of moveIds) {
            const element = byId.get(id);
            if (element) { element.x += delta.x; element.y += delta.y; }
          }
          pointerSelectedRef.current = new Set(remappedSelection);
          publish(elements, { ...api.getAppState?.(), selectedElementIds: Object.fromEntries([...remappedSelection].map((id) => [id, true])) });
          pointerSelectedRef.current = new Set();
          stableSelectionRef.current = remappedSelection; programmaticSelectionRef.current = remappedSelection;
          controller.setSelection(remappedSelection);
          const projection = controller.snapshot().scene;
          pointerSettlingRef.current = true;
          projectCanvas({ elements: projection.elements, appState: { selectedElementIds: Object.fromEntries([...remappedSelection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "claimed-nudge");
          requestAnimationFrame(() => requestAnimationFrame(() => {
            pointerSettlingRef.current = false;
          }));
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        stop(event); if (event.shiftKey) controller.redo(); else controller.undo(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        pointerSettlingRef.current = false;
        actionKindRef.current = "duplicate";
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") { stop(event); setOutlineOpen((value) => !value); return; }
      const ids = selectedIds(api.getAppState?.());
      const selected = state.composition.scene.elements.filter((element) => ids.includes(element.id));
      const region = selected.find((element) => element.customData?.tangent?.role === "area-region");
      const block = selected.find(boardCore.tangentOf);
      if (["Backspace", "Delete"].includes(event.key) && region) { stop(event); announce("Area outlines come from the Area tree"); return; }
      if (["Backspace", "Delete"].includes(event.key)) {
        pointerSettlingRef.current = false;
        actionKindRef.current = "delete";
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && ids.length) {
        // A new keyboard command supersedes the short release-callback fence.
        // Its Excalidraw onChange is the first preview of a separate history word.
        pointerSettlingRef.current = false;
        actionKindRef.current = "nudge";
      }
      if (event.key === "Escape") { stop(event); escape(); return; }
      if (event.key === "?" || event.key === "/" && event.shiftKey) { stop(event); setHelpOpen(true); return; }
      if (event.key === "Enter") {
        if (region) { stop(event); scrollToArea(region.customData.tangent.area); return; }
        if (block) { stop(event); openBlock(block); }
        return;
      }
      if (block && ["a", "b", "c", "o", "x"].includes(event.key.toLowerCase())) {
        stop(event);
        if (event.key.toLowerCase() === "x") hideBlock(block);
        else openBlock(block, { a: "ask", b: "enter", c: "correct", o: "read" }[event.key.toLowerCase()]);
        return;
      }
      if ((event.key === " " || event.code === "Space") && region) {
        stop(event); changeFold(region.customData.tangent.area);
        return;
      }
      if (event.key.toLowerCase() === "b") { stop(event); openPicker(); }
    };
    /** Opens the selected semantic block on a host double click. */
    const doubleClick = (event) => {
      const ids = selectedIds(api.getAppState?.());
      const block = state.composition.scene.elements.find((element) => ids.includes(element.id) && boardCore.tangentOf(element));
      if (block) { stop(event); openBlock(block); }
    };
    host.addEventListener("keydown", keydown, true);
    host.addEventListener("dblclick", doubleClick, true);
    return () => { host.removeEventListener("keydown", keydown, true); host.removeEventListener("dblclick", doubleClick, true); };
  }, [api, picker, helpOpen, outlineOpen, state.revision]);

  useEffect(() => {
    if (!picker && !helpOpen && !outlineOpen) return undefined;
    /** Dismisses map overlays when the pointer starts outside them. */
    const dismiss = (event) => {
      if (event.target.closest?.(".tangent-map-picker, .tangent-map-help, .tangent-map-outline, .tangent-map-top-right")) return;
      setPicker(null); setHelpOpen(false); setOutlineOpen(false);
    };
    host.addEventListener("pointerdown", dismiss, true);
    return () => host.removeEventListener("pointerdown", dismiss, true);
  }, [picker, helpOpen, outlineOpen]);

  useEffect(() => {
    if (!api) return undefined;
    /** Converts one browser pointer into the scene coordinates used by the solver. */
    const scenePoint = (event) => {
      const canvas = host.querySelector("canvas.interactive"); const box = canvas?.getBoundingClientRect(); const appState = api.getAppState?.();
      if (!box || !appState) return null;
      const zoom = Number(appState.zoom?.value ?? 1) || 1;
      return { x: (event.clientX - box.left) / zoom - Number(appState.scrollX ?? 0), y: (event.clientY - box.top) / zoom - Number(appState.scrollY ?? 0) };
    };
    /** Starts one pointer command from the interactive canvas. */
    const down = (event) => {
      if (event.button !== 0 || !(event.target instanceof Element) || !event.target.matches("canvas.interactive")) return;
      const point = scenePoint(event); if (!point) return;
      pointerDomActiveRef.current = true; beginPointerGesture(point, { origin: point, shiftKey: event.shiftKey });
    };
    /** Previews the active pointer command in world coordinates. */
    const move = (event) => {
      if (!pointerDomActiveRef.current || !(event.buttons & 1)) return;
      const point = scenePoint(event); if (point) previewPointerGesture(point);
    };
    /** Ends the active pointer command once. */
    const up = () => {
      if (!pointerDomActiveRef.current) return;
      pointerDomActiveRef.current = false; endPointerGesture();
    };
    host.addEventListener("pointerdown", down, true); window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true);
    return () => { host.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
  }, [api]);

  useEffect(() => {
    bridge.setSaveState = null;
    bridge.current = () => controller.snapshot().composition.scene;
    bridge.appState = () => api?.getAppState?.() ?? null;
    bridge.fitArea = (area, settings) => scrollToArea(area, settings);
    bridge.selectArea = (area) => selectArea(area);
    bridge.escape = escape;
    bridge.flush = async () => { await waitForPointerSettle(); return controller.flush(); };
    bridge.refreshFacts = (documentsOrFocus, maybeFocus) => controller.refreshFacts(maybeFocus ?? (Array.isArray(documentsOrFocus) ? controller.snapshot().focus : documentsOrFocus));
    bridge.setFocus = (focus) => controller.setFocus(focus);
    bridge.reload = () => controller.reload();
    bridge.keepMine = () => controller.keepMine();
    bridge.controller = controller;
    const initial = controller.snapshot();
    if (api && !initial.viewRestored) {
      const element = controller.fitArea(initial.locatedArea, { push: false, select: false });
      if (element) api.scrollToContent([element], { fitToContent: true, animate: false });
    }
    return () => { bridge.controller = null; };
  }, [api]);

  useEffect(() => () => {
    nonPointerSettleRef.current += 1; finishNonPointer();
    resolvePointerSettleWaiters();
    if (pasteTimerRef.current !== null) clearTimeout(pasteTimerRef.current);
    controller.destroy();
  }, [controller]);

  const visibleNodes = state.world.areas.filter((node) => ![...state.folded].some((root) => node.key.startsWith(`${root}/`)));
  const documents = options.getDocuments();
  const areaTitles = new Map(documents.filter((item) => item.kind === "area" && item.area).map((item) => [item.area, item.title]));
  /** Returns the document title or leaf fallback for one Area. */
  const areaName = (area) => areaTitles.get(area) ?? leaf(area);
  /** Returns a full titled ancestry path for one Area. */
  const areaPathName = (area) => {
    let key = "";
    return String(area).split("/").filter(Boolean).map((part) => { key = key ? `${key}/${part}` : part; return areaName(key); }).join(" / ");
  };
  /** Builds the contextual accessible name for one Area row or label. */
  const accessibleAreaName = (node) => {
    const count = Number(node.shard.blockCount ?? 0);
    const parent = node.parent === "@root" ? "map root" : areaPathName(node.parent);
    return `${areaName(node.key)}, child of ${parent}, depth ${node.depth + 1}, ${state.folded.has(node.key) ? "folded" : "unfolded"}, ${node.shard.state}, ${count} ${count === 1 ? "block" : "blocks"}`;
  };
  const targetArea = picker?.area ?? state.locatedArea;
  const contextualChoices = boardCore.entityChoices(targetArea, documents);
  const choiceSource = widePicker ? pickerModel.wideChoices(pickerQuery, documents) : contextualChoices;
  const needle = pickerQuery.trim().toLowerCase();
  const matchingChoices = widePicker || !needle ? choiceSource : choiceSource.filter((choice) => `${choice.kind} ${choice.title} ${choice.ref}`.toLowerCase().includes(needle));
  const typedChoice = boardCore.referenceFromText(pickerQuery, [...contextualChoices, ...pickerModel.wideChoices("", documents)]);
  const pickerChoices = typedChoice && !matchingChoices.some((choice) => choice.ref === typedChoice.ref) ? [typedChoice, ...matchingChoices] : matchingChoices;
  const currentBlock = state.composition.scene.elements.find((element) => state.selection.has(element.id) && boardCore.tangentOf(element));
  const nextEscape = picker ? "Esc closes picker" : helpOpen ? "Esc closes key sheet" : outlineOpen ? "Esc closes outline" : state.nextEscape;
  const debug = typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "area-map";
  const nodeByParent = new Map();
  for (const node of state.world.areas) { const list = nodeByParent.get(node.parent) ?? []; list.push(node); nodeByParent.set(node.parent, list); }
  for (const list of nodeByParent.values()) list.sort((left, right) => left.key.localeCompare(right.key));
  /** Renders a semantically nested accessible Area tree. */
  const outlineTree = (parent = "@root") => <ol role={parent === "@root" ? "tree" : "group"}>{(nodeByParent.get(parent) ?? []).map((node) => {
    const selected = [...state.selection].some((id) => state.composition.scene.elements.find((element) => element.id === id)?.customData?.tangent?.area === node.key);
    const children = nodeByParent.get(node.key) ?? [];
    return <li role="none" key={node.key}><button type="button" role="treeitem" aria-label={accessibleAreaName(node)} aria-level={node.depth + 1} aria-selected={selected} aria-expanded={children.length ? !state.folded.has(node.key) : undefined} onClick={() => selectArea(node.key)} onDoubleClick={() => scrollToArea(node.key)} onKeyDown={(event) => {
      const buttons = [...host.querySelectorAll('.tangent-map-outline [role="treeitem"]')]; const index = buttons.indexOf(event.currentTarget);
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) {
        stop(event); const forward = ["ArrowDown", "ArrowRight"].includes(event.key);
        buttons[Math.max(0, Math.min(buttons.length - 1, index + (forward ? 1 : -1)))]?.focus();
      }
      else if (event.key === "Enter") { stop(event); scrollToArea(node.key); }
      else if (event.key === " ") { stop(event); changeFold(node.key); }
    }}>{areaName(node.key)} · depth {node.depth + 1} · {state.folded.has(node.key) ? "folded" : node.shard.state} · {Number(node.shard.blockCount ?? 0)} blocks</button>{children.length && !state.folded.has(node.key) ? outlineTree(node.key) : null}</li>;
  })}</ol>;

  /** Captures one Excalidraw pointer command through the current world closure. */
  function handleCanvasPointerDown(_tool, pointerDownState) { beginPointerGesture(pointerDownState.origin, pointerDownState); }

  /** Routes Excalidraw pointer previews through the current containment solver. */
  function handleCanvasPointerUpdate({ pointer }) { previewPointerGesture(pointer); }

  /** Stores the current camera without entering authored history. */
  function handleCanvasScroll(scrollX, scrollY, zoom) { controller.setCamera({ scrollX, scrollY, zoom: zoom?.value ?? zoom }); }

  /** Claims ordinary paste placement or consumes a semantic Tangent reference. */
  function handleCanvasPaste(data) {
    if (data.files?.length) return true;
    actionKindRef.current = "paste";
    const point = placementPoint(); const area = areaAtPoint(state.composition, point, state.locatedArea);
    pastePlacementRef.current = { area, point };
    if (pasteTimerRef.current !== null) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => { pastePlacementRef.current = null; pasteTimerRef.current = null; }, 1_000);
    const choice = boardCore.referenceFromText(data.text, pickerModel.wideChoices("", documents));
    if (!choice) return false;
    pastePlacementRef.current = null; clearTimeout(pasteTimerRef.current); pasteTimerRef.current = null; placeBlock(choice, false, { area, point }); return true;
  }

  /** Normalizes one Excalidraw callback into source-owned world authority. */
  function handleCanvasChange(elements, appState) {
    if (consumeExpectedProjection(elements, appState)) return;
    if (appState.editingTextElement) {
      cancelDeferredCanvasUpdate();
      textEditRef.current = { editingId: appState.editingTextElement.id, elements: clone(elements) };
      return;
    }
    if (textEditRef.current) cancelDeferredCanvasUpdate();
    else if (initializingRef.current) return;
    if (pointerSettlingRef.current && !textEditRef.current) return;
    let sourceElements = elements;
    if (textEditRef.current) {
      const buffered = textEditRef.current; textEditRef.current = null;
      const latestText = buffered.elements.find((element) => element.id === buffered.editingId);
      if (latestText) {
        sourceElements = clone(elements);
        const index = sourceElements.findIndex((element) => element.id === buffered.editingId);
        if (index < 0) sourceElements.push(latestText);
        else if (!sourceElements[index].isDeleted) sourceElements[index] = latestText;
      }
      actionKindRef.current = "text";
    }
    const claimedRuntimeIds = new Map(claimedRuntimeIdsRef.current);
    const editingSourceId = appState.editingTextElement?.id;
    const liveClaimedText = Boolean(editingSourceId && resolveClaimedId(claimedRuntimeIds, editingSourceId) !== editingSourceId);
    const normalizedElements = claimedRuntimeIds.size ? remapClaimedIdentities(sourceElements, claimedRuntimeIds) : sourceElements;
    const normalizedAppState = claimedRuntimeIds.size ? {
      ...appState,
      editingTextElement: remapClaimedIdentities(appState.editingTextElement, claimedRuntimeIds),
      selectedElementIds: Object.fromEntries(selectedIds(appState).map((id) => [resolveClaimedId(claimedRuntimeIds, id), true])),
    } : appState;
    if (!normalizedAppState.editingTextElement && nonPointerKindRef.current === "text") settleNonPointer();
    let ids = liveClaimedText ? [...controller.snapshot().selection] : selectedIds(normalizedAppState);
    if (!liveClaimedText) {
      if (additiveSelectionRef.current?.size && ![...additiveSelectionRef.current].every((id) => ids.includes(id))) {
        ids = [...new Set([...ids, ...additiveSelectionRef.current])];
        const additive = Object.fromEntries(ids.map((id) => [id, true]));
        requestAnimationFrame(() => projectCanvas({ appState: { selectedElementIds: additive }, captureUpdate: "NEVER" }, "additive-selection-repair"));
      }
      if (programmaticSelectionRef.current?.size && ![...programmaticSelectionRef.current].every((id) => ids.includes(id))) {
        const selected = Object.fromEntries([...programmaticSelectionRef.current].map((id) => [id, true]));
        requestAnimationFrame(() => projectCanvas({ appState: { selectedElementIds: selected }, captureUpdate: "NEVER" }, "selection-repair"));
        return;
      }
      controller.setSelection(ids);
      if (ids.length) stableSelectionRef.current = new Set(ids);
      for (const element of state.composition.scene.elements) if (ids.includes(element.id) && element.customData?.tangent?.role === "area-region") void controller.prioritizeLoads(element.customData.tangent.area, { includeDescendants: false, requireSelectedDeferred: true });
    }
    const fingerprint = boardCore.authoredFingerprint(normalizedElements);
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    publish(clone(normalizedElements), normalizedAppState);
  }

  canvasHandlersRef.current = {
    setApi,
    onPointerDown: handleCanvasPointerDown,
    onPointerUp: endPointerGesture,
    onPointerUpdate: handleCanvasPointerUpdate,
    onScrollChange: handleCanvasScroll,
    onPaste: handleCanvasPaste,
    onChange: handleCanvasChange,
  };

  return <div className="TangentAreaMap theme--dark" data-tangent-area-map={state.locatedArea} data-tangent-area-map-world={options.world.worldId}>
    <StableWorldCanvas initialData={initialDataRef.current} handlers={canvasHandlersRef} />
    <div className="tangent-map-top-right">
      <div className="tangent-map-toolbar-extra"><button type="button" onClick={openPicker} aria-keyshortcuts="b" title="Place a Tangent block (B)"><span aria-hidden="true">◈</span><span className="tangent-map-label">Block</span><kbd>B</kbd></button></div>
      {currentBlock && <div className="tangent-map-verbs" role="group" aria-label="Tangent block actions"><button type="button" onClick={() => openBlock(currentBlock)}>Open <kbd>Enter</kbd></button><button type="button" onClick={() => openBlock(currentBlock, "ask")}>Ask brain <kbd>A</kbd></button><button type="button" onClick={() => openBlock(currentBlock, "correct")}>Correct <kbd>C</kbd></button><button type="button" onClick={() => hideBlock(currentBlock)}>Hide <kbd>X</kbd></button></div>}
      <button type="button" onClick={() => setOutlineOpen((value) => !value)} aria-expanded={outlineOpen} title="Outline"><span aria-hidden="true" className="tangent-map-glyph">≣</span><span className="tangent-map-label">Outline</span></button>
      <button type="button" onClick={() => setHelpOpen(true)} aria-keyshortcuts="?" title="Map keys (?)"><span aria-hidden="true" className="tangent-map-glyph">?</span><span className="tangent-map-label">Keys</span><kbd>?</kbd></button>
    </div>
    <div className="tangent-map-ancestry" aria-label="Complete Area hierarchy">
      {visibleNodes.map((node) => {
        const box = state.composition.regionRects.get(node.key);
        if (!box) return null;
        const name = areaName(node.key);
        const summary = !state.detailAreas.has(node.key) ? `${Number(node.shard.blockCount ?? 0)} blocks` : "";
        return <button type="button" key={node.key} style={{ left: `${(box.x + state.camera.scrollX) * state.camera.zoom + 12}px`, top: `${(box.y + state.camera.scrollY) * state.camera.zoom + 10}px` }} onClick={() => selectArea(node.key)} onDoubleClick={() => scrollToArea(node.key)} aria-label={accessibleAreaName(node)}><strong>{name}</strong>{state.folded.has(node.key) && <span>folded · Space</span>}{["loading", "deferred", "unreadable", "load-error"].includes(node.shard.state) && <span>{node.shard.state === "unreadable" ? "map file unreadable" : node.shard.state === "load-error" ? "load failed · click to retry" : node.shard.state}</span>}{summary && <span>{summary}</span>}</button>;
      })}
    </div>
    <button type="button" className="tangent-map-escape" onClick={escape}>{nextEscape}</button>
    <div className={`tangent-map-save ${state.save.state}`}>{state.save.state === "saving" ? "Saving…" : state.save.state === "dirty" ? "Saved ·" : state.save.state === "conflict" ? <>Not saved <button type="button" onClick={() => controller.reload().catch((error) => announce(String(error?.message ?? error)))}>Reload</button><button type="button" onClick={() => controller.keepMine()}>Keep mine</button></> : state.save.state === "blocked" ? <>Not saved <button type="button" onClick={() => controller.retry()}>Retry</button></> : "Saved"}</div>
    {notice && <div className="tangent-map-location" aria-hidden="true">{notice}</div>}
    {announcement.text && <div key={announcement.id} className="tangent-map-live" role="status" aria-live="polite" aria-atomic="true">{announcement.text}</div>}
    {outlineOpen && <section className="tangent-map-outline visible" aria-label="Area hierarchy">{outlineTree()}</section>}
    {picker && <div className={`tangent-map-dialog-backdrop dock-${picker.dock}`}><section className="tangent-map-picker" role="dialog" aria-modal="true" aria-label="Place a Tangent block">
      <h2>{widePicker ? "Place from the whole vault" : picker.outside ? "Outside every Area" : `Place in ${leaf(picker.area)}`}</h2>
      <input autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Tab") { stop(event); setWidePicker((value) => !value); }
        else if (event.key === "Escape") { stop(event); setPicker(null); }
        else if (event.key === "Enter" && pickerChoices[0]) { stop(event); placeBlock(pickerChoices[0], event.shiftKey); }
      }} placeholder="Goal, Document, Area, idea, or URL" />
      <ul role="listbox">{pickerChoices.slice(0, 30).map((choice) => <li key={`${choice.kind}:${choice.ref}`}><button type="button" onClick={() => placeBlock(choice)}><small>{choice.kind}</small><span>{choice.title}</span><em>{choice.status}</em></button></li>)}</ul>
      <p><kbd>Tab</kbd> {widePicker ? "return here" : "whole vault"} · <kbd>Enter</kbd> place · <kbd>⇧Enter</kbd> place another · <kbd>Esc</kbd> close</p>
    </section></div>}
    {helpOpen && <div className="tangent-map-dialog-backdrop"><section className="tangent-map-help" role="dialog" aria-modal="true" aria-labelledby="tangent-map-help-title"><h2 id="tangent-map-help-title">Map keys</h2><p><kbd>V</kbd> select · <kbd>R</kbd> rectangle · <kbd>D</kbd> diamond · <kbd>O</kbd> ellipse · <kbd>A</kbd> arrow · <kbd>L</kbd> line · <kbd>P</kbd> draw · <kbd>T</kbd> text · <kbd>F</kbd> frame · <kbd>E</kbd> erase · <kbd>B</kbd> block</p><p>Space-drag pans. Command-wheel zooms. Command-Z undoes. Escape prints and runs its next effect.</p><p>With a block selected: <kbd>Enter</kbd> opens · <kbd>A</kbd> asks the brain · <kbd>C</kbd> corrects · <kbd>X</kbd> hides.</p><button type="button" autoFocus onClick={() => setHelpOpen(false)}>Close</button></section></div>}
    {debug && <aside className="tangent-map-debug" aria-label="Area map diagnostics"><h2>Area map diagnostics</h2><p>dirty owners: {[...state.dirtyOwners].join(", ") || "none"}</p><table><thead><tr><th>owner</th><th>source</th><th>runtime</th><th>stored</th><th>constraint</th><th>load</th></tr></thead><tbody>{state.world.areas.map((node) => <tr key={node.key}><td>{node.parent}</td><td>{node.region.sourceId}</td><td>{worldCore.runtimeId(node.parent, node.region.sourceId)}</td><td>{rectWords(node.region.storedRect)}</td><td>{rectWords(state.composition.geometry.get(node.key)?.constraint)}</td><td>{node.shard.state}</td></tr>)}</tbody></table><details><summary>Authored identities</summary><ul>{[...state.composition.origins].filter(([, origin]) => !origin.regionKey).map(([runtime, origin]) => <li key={runtime}>{origin.owner} · {origin.sourceId} · {runtime}</li>)}</ul></details></aside>}
    {state.draft && !state.draft.restored && <section className="tangent-map-draft-choice"><strong>Draft from {new Date(state.draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><button type="button" onClick={() => controller.restoreDraft()}>Restore</button><button type="button" onClick={() => controller.discardDraft()}>Discard</button></section>}
  </div>;
}

export default AreaMapWorld;
