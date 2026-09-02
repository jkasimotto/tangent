import React, { useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import boardCore from "../public/area-board-core.js";
import worldCore from "../public/area-map-world-core.js";
import pickerModel from "../public/area-board-picker.js";
import { mapFindMatches } from "../public/area-map-find-core.js";
import { resolveMapEntity, resourceLocatorKey, runMapEntityAction, selectedMapEntityElement } from "../public/area-map-entities.js";
import { areaMapPointerCommand, areaMapStructuralHullChanged, createAreaMapWorldController, ownerForNewAreaMapElement, selectedAreaMapRegionChanges } from "../public/area-map-world-controller.js";

const EXCALIDRAW_UI_OPTIONS = Object.freeze({
  tools: { image: false },
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
});
const PROJECTION_KINDS = new Set([
  "additive-pointer-selection", "additive-selection-repair", "area-pointer-preview", "area-selection", "area-transform-rejected",
  "camera-selection", "claim", "claimed-nudge", "no-change", "placed-block-selection", "pointer-down-selection",
  "pointer-release-selection", "projection", "resource-placement-preview", "selection-repair", "stale-text-repair", "view-return",
]);

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
    onPointerUp={(tool, pointerDownState) => handlers.current.onPointerUp(tool, pointerDownState)}
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
/** Normalizes one published runtime count without inventing activity. */
const runtimeCount = (value) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && "count" in value) return runtimeCount(value.count);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};
/** Builds the compact, coordinate-free facts shown beside one Area label. */
export function areaRuntimeAnnotations(record) {
  const runtime = record?.runtime ?? {};
  const working = runtimeCount(runtime.working);
  const forYou = runtimeCount(runtime.forYou);
  const problems = runtimeCount(runtime.problems);
  const facts = [
    ...(working ? [{ verb: "work", label: `${working} working` }] : []),
    ...(forYou ? [{ verb: "for-you", label: `${forYou} for you` }] : []),
    ...(problems ? [{ verb: "problems", label: `${problems} ${problems === 1 ? "problem" : "problems"}` }] : []),
  ];
  return {
    facts,
    ready: Boolean(runtime.ready) && !forYou,
    stale: Boolean(runtime.stale),
  };
}
/** Reports whether an element is a disposable composed-world helper. */
const ephemeral = (element) => element.customData?.tangentWorldEphemeral || element.customData?.tangent?.role === "endpoint-dot";
/** Formats one rectangle for read-only diagnostics. */
const rectWords = (value) => value ? `${value.x},${value.y} ${value.width}×${value.height}` : "—";

/** Returns the canonical resource entity from either the complete joined read model or the compatibility projection. */
function resourceEntityForRow(row) {
  if (row?.entity) return row.entity;
  if (!row?.locator || !row?.target) return null;
  return {
    locator: row.locator,
    label: row.label,
    target: row.target,
    local: row.target.kind === "link" ? null : { state: "not-checked", value: null, checkedAt: null },
    link: row.target.kind === "link" ? { kind: "generic" } : null,
    representation: row.representation ?? { state: "current", value: "never-placed" },
    origin: row.origin ?? null,
    warnings: row.warnings ?? [],
  };
}

/** Adapts one panel row to the resolver's current-or-gone authority union. */
function resourceResolutionForRow(row) {
  const entity = resourceEntityForRow(row);
  if (!entity) return null;
  return entity.reason ? { state: "gone", value: entity } : { state: "current", value: entity };
}

/** Projects the accepted observable Checking state without discarding the last usable fact. */
function checkingResourceResolution(resolution) {
  if (resolution?.state !== "current" || !resolution.value) return resolution;
  const next = clone(resolution);
  if (next.value.target?.kind !== "link" && next.value.local) {
    next.value.local = { state: "checking", value: next.value.local.value ?? null, checkedAt: next.value.local.checkedAt ?? null };
  } else if (next.value.link?.kind && next.value.link.kind !== "generic" && next.value.link.lifecycle) {
    next.value.link.lifecycle = { state: "checking", value: next.value.link.lifecycle.value ?? null, checkedAt: next.value.link.lifecycle.checkedAt ?? null };
  }
  return next;
}

/** Returns a provider lifecycle label only when one has been observed. */
function providerLifecycleLabel(resolution) {
  return String(resolution?.value?.link?.lifecycle?.value?.stateLabel ?? "");
}

/** Builds a disposable preview with the canonical Tangent Block renderer. */
function resourcePlacementPreview(placement) {
  if (!placement?.entity || !placement?.point) return [];
  const placed = worldCore.placeBlockAtNearestFreePoint(boardCore.createEmptyScene(), {
    kind: "resource",
    ref: placement.entity.locator.id,
    title: placement.entity.label,
    status: "Place with click or Enter",
    style: { opacity: 70, strokeStyle: "dashed" },
  }, placement.point, "tangent-resource-placement-preview");
  return placed.scene.elements.map((element) => ({ ...element, locked: true, customData: { ...(element.customData ?? {}), tangentWorldEphemeral: true } }));
}

/** Reads one representation value without treating an unavailable source read as Never placed. */
function savedRepresentationForRow(row) {
  const value = resourceEntityForRow(row)?.representation;
  if (typeof value === "string") return value;
  return value?.state === "current" ? value.value : "unavailable";
}

/** Keeps mutation evidence closed to the exact fields in the accepted route contract. */
function suggestionReference(value) {
  return value ? {
    owner: value.owner,
    target: value.target,
    evidence: value.evidence,
    evidenceHash: value.evidenceHash,
    targetFingerprint: value.targetFingerprint,
  } : null;
}

/** Returns the exact catalog owners guarded by one accepted mutation kind. */
function resourceMutationOwners(mutation) {
  if (["add"].includes(mutation?.kind)) return [mutation.owner];
  if (["edit", "remove"].includes(mutation?.kind)) return [mutation.resource?.owner];
  if (mutation?.kind === "add-suggestion") return [mutation.selection?.suggestion?.owner];
  if (mutation?.kind === "dismiss-suggestion") return [mutation.suggestion?.owner];
  if (mutation?.kind === "import-legacy") return (mutation.selections ?? []).map((selection) => selection?.candidate?.owner);
  return [];
}

/** Gives one legacy review row a stable UI identity without making it resource authority. */
function legacyCandidateKey(candidate) {
  return `${candidate?.owner ?? ""}\u0000${candidate?.field ?? ""}\u0000${candidate?.targetFingerprint ?? candidate?.evidenceHash ?? ""}`;
}

/** Applies the accepted launch, Map representation, and label ordering within inventory groups. */
function sortPanelResourceRows(rows) {
  /** Ranks launch rows first, placed rows second, and the rest last. */
  const priority = (row) => row?.launchMatch?.state === "current" && row.launchMatch.value ? 0 : savedRepresentationForRow(row) === "on-map" ? 1 : 2;
  return [...rows].sort((left, right) => priority(left) - priority(right)
    || String(resourceEntityForRow(left)?.label ?? resourceEntityForRow(left)?.lastKnown?.label ?? "").localeCompare(String(resourceEntityForRow(right)?.label ?? resourceEntityForRow(right)?.lastKnown?.label ?? ""), undefined, { sensitivity: "base" }));
}

/** Formats one closed-union identity warning without inferring filesystem equivalence. */
function resourceWarningText(warning) {
  if (warning?.kind === "path-alias") return `Path may alias resource ${warning.other?.id ?? "unknown"} in ${warning.other?.owner ?? "another Area"}.`;
  if (warning?.kind === "cross-kind-target") return `The exact target is also recorded under another kind in ${warning.other?.owner ?? "this Area"}.`;
  return "";
}

/** Traps Tab inside one named Map modal. */
function trapModalTab(event) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) { stop(event); dialog.focus(); return; }
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { stop(event); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { stop(event); first.focus(); }
}

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

/** Reports whether one pointer starts on a selected element's hit rectangle. */
function pointerHits(element, point, zoom = 1) {
  if (!element || !point) return false;
  const pad = 10 / Math.max(0.1, zoom);
  return point.x >= Number(element.x) - pad && point.y >= Number(element.y) - pad
    && point.x <= Number(element.x) + Number(element.width) + pad
    && point.y <= Number(element.y) + Number(element.height) + pad;
}

/** Converts one canvas mouse event into the scene coordinates used by Tangent Blocks. */
function eventScenePoint(event, appState, canvas) {
  if (!canvas || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
  const rect = canvas.getBoundingClientRect();
  const zoom = Number(appState?.zoom?.value ?? appState?.zoom ?? 1) || 1;
  const offsetLeft = Number(appState?.offsetLeft ?? rect.left);
  const offsetTop = Number(appState?.offsetTop ?? rect.top);
  return {
    x: (event.clientX - offsetLeft) / zoom - Number(appState?.scrollX ?? 0),
    y: (event.clientY - offsetTop) / zoom - Number(appState?.scrollY ?? 0),
  };
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
function areaAtPoint(composition, point, fallback, scopedAreas = null) {
  return [...composition.regionRects]
    .filter(([area, box]) => (!scopedAreas || scopedAreas.has(area)) && point.x >= box.x && point.y >= box.y && point.x <= box.x + box.width && point.y <= box.y + box.height)
    .sort(([left], [right]) => right.split("/").length - left.split("/").length)[0]?.[0] ?? fallback;
}

/** Builds the solver inputs from one immutable pointer baseline. */
function solverBaseline(world) {
  const regions = new Map(world.areas.map((node) => [node.key, clone(node.region)]));
  const blockHulls = new Map(); const inkHulls = new Map();
  for (const node of world.areas) {
    const hulls = node.shard.scene
      ? worldCore.shardHulls(node.shard.scene)
      : { blocks: node.shard.ownBlockHull ?? null, ink: node.shard.ownInkHull ?? null };
    if (hulls.blocks) blockHulls.set(node.key, hulls.blocks);
    if (hulls.ink) inkHulls.set(node.key, hulls.ink);
  }
  return { areas: world.areas.map((node) => node.key), regions, blockHulls, inkHulls };
}

/** Renders the controller-owned world in one Excalidraw instance. */
export function AreaMapWorld({ host, bridge, options }) {
  const ownsControllerRef = useRef(!options.controller);
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
  const selectedElement = state.composition.scene.elements.find((element) => state.selection.has(element.id));
  const selectedTangent = selectedElement ? boardCore.tangentOf(selectedElement) : null;
  const selectedRecord = selectedTangent ? options.getDocuments?.().find((record) => record.file === selectedTangent.ref) : null;
  const selectedArea = selectedElement?.customData?.tangent?.area
    ?? selectedRecord?.area
    ?? selectedElement?.customData?.tangentWorld?.owner
    ?? "";
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
  const [pickerEntities, setPickerEntities] = useState([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findKept, setFindKept] = useState(false);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState({ id: 0, text: "" });
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [resourcesArea, setResourcesArea] = useState("");
  const [resourceProjection, setResourceProjection] = useState(null);
  const [resourceTransport, setResourceTransport] = useState({ state: "idle", error: "" });
  const [resourceBusy, setResourceBusy] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [resourceDiscovery, setResourceDiscovery] = useState(null);
  const [resourceDetails, setResourceDetails] = useState(null);
  const [resourceEditor, setResourceEditor] = useState(null);
  const [resourceUndo, setResourceUndo] = useState(null);
  const [resourceMutationRecovery, setResourceMutationRecovery] = useState(null);
  const [resourceRecovery, setResourceRecovery] = useState(null);
  const [resourceSceneBusy, setResourceSceneBusy] = useState(null);
  const [resourceSceneRecovery, setResourceSceneRecovery] = useState(null);
  const [resourcePlacement, setResourcePlacement] = useState(null);
  const [resourceLocate, setResourceLocate] = useState(null);
  const [resourceResolutions, setResourceResolutions] = useState(new Map());
  const [resourceRefreshing, setResourceRefreshing] = useState(new Set());
  const [legacySelected, setLegacySelected] = useState(new Set());
  const [legacyReviewHidden, setLegacyReviewHidden] = useState(false);
  const [resourceCadence, setResourceCadence] = useState(0);
  const [narrowResources, setNarrowResources] = useState(() => matchMedia("(max-width: 960px)").matches);
  const initializingRef = useRef(true);
  const pointerBaselineRef = useRef(null);
  const pointerSolverBaselineRef = useRef(null);
  const pointerCompositionRef = useRef(null);
  const pointerStateRef = useRef(null);
  const pointerCurrentRef = useRef(null);
  const lastPointerRef = useRef(null);
  const pointerHandleRef = useRef(null);
  const outlineProtectionAnnouncedRef = useRef(false);
  const pointerSelectedRef = useRef(new Set());
  const additiveSelectionRef = useRef(null);
  const stableSelectionRef = useRef(new Set(state.selection));
  const pointerSettlingRef = useRef(false);
  const pointerSettleTokenRef = useRef(0);
  const pointerSettleWaitersRef = useRef([]);
  const pastePlacementRef = useRef(null);
  const pasteTimerRef = useRef(null);
  const textPlacementRef = useRef(null);
  const nonPointerKindRef = useRef(null);
  const nonPointerBaselineRef = useRef(null);
  const nonPointerSettleRef = useRef(0);
  const actionKindRef = useRef(null);
  const programmaticSelectionRef = useRef(null);
  const claimedRuntimeIdsRef = useRef(new Map());
  const claimedOriginsRef = useRef(new Map());
  const textEditRef = useRef(null);
  const placedBlockEditEventRef = useRef(false);
  const fingerprintRef = useRef(boardCore.authoredFingerprint(state.scene.elements));
  const appliedProjectionRef = useRef("");
  const previousSaveStateRef = useRef(state.save.state);
  const announcedReasonRef = useRef(0);
  const deferredCanvasUpdateTokenRef = useRef(0);
  const projectionTokenRef = useRef(0);
  const projectionFenceRef = useRef(0);
  const expectedProjectionsRef = useRef([]);
  const findOriginRef = useRef(null);
  const findInputRef = useRef(null);
  const resourcesOpenerRef = useRef(null);
  const resourcesHeadingRef = useRef(null);
  const resourceDetailsOpenerRef = useRef(null);
  const resourceMutationRecoveryOpenerRef = useRef(null);
  const recoveryOpenerRef = useRef(null);
  const resourceSceneRecoveryOpenerRef = useRef(null);
  const resourceResolveKeyRef = useRef("");
  const resourceResolveRequestRef = useRef(null);
  const resourcePanelRequestRef = useRef(null);
  const resourcePanelGenerationRef = useRef(0);
  const resourceObservationRefreshKeyRef = useRef("");
  const resourceRefreshingRef = useRef(new Set());
  const resourceMapResolutionKeysRef = useRef(new Set());
  const resourcePlacementProjectionRef = useRef("");
  const resourcePlacementPointerRef = useRef(false);
  const pendingResourceControlFocusRef = useRef(null);

  /** Returns one stable key for an Excalidraw selection. */
  function selectionKey(ids) {
    return JSON.stringify([...new Set(ids ?? [])].sort());
  }

  /** Applies one exact controller projection and fences its matching callback. */
  function projectCanvas(update, reason = "unknown") {
    if (!api) return null;
    const startedAt = performance.now();
    const elements = update.elements ?? api.getSceneElements?.() ?? state.scene.elements;
    const selection = Object.hasOwn(update.appState ?? {}, "selectedElementIds")
      ? selectedIds({ selectedElementIds: update.appState.selectedElementIds })
      : selectedIds(api.getAppState?.());
    const token = {
      id: ++projectionTokenRef.current,
      fingerprint: boardCore.authoredFingerprint(elements),
      selection: selectionKey(selection),
      projectionKind: PROJECTION_KINDS.has(reason) ? reason : "unknown",
      includesElements: Boolean(update.elements),
      affectedCount: update.elements?.length ?? 0,
      elementCount: elements.length,
      startedAt,
    };
    expectedProjectionsRef.current.push(token);
    if (expectedProjectionsRef.current.length > 32) expectedProjectionsRef.current.splice(0, expectedProjectionsRef.current.length - 32);
    if (token.includesElements) {
      appliedProjectionRef.current = token.fingerprint;
      fingerprintRef.current = token.fingerprint;
      projectionFenceRef.current = token.id;
    }
    controller.recordEvent("area_map_projection", {
      projectionId: token.id, phase: "request", projectionKind: token.projectionKind,
      affectedCount: token.affectedCount, elementCount: token.elementCount,
    });
    api.updateScene(update);
    if (token.includesElements) setTimeout(() => {
      if (projectionFenceRef.current === token.id) projectionFenceRef.current = 0;
    }, 100);
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
    controller.recordEvent("area_map_projection", {
      projectionId: token.id, phase: "consumed", projectionKind: token.projectionKind,
      affectedCount: token.affectedCount, elementCount: elements.length, duration: performance.now() - token.startedAt,
    });
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
    projectionFenceRef.current = 0;
    expectedProjectionsRef.current = [];
  }

  // Excalidraw calls onChange from its componentDidUpdate lifecycle. Keep the
  // controller synchronous, but mirror its newest snapshot after that React
  // lifecycle returns so a preview cannot recursively update the parent tree.
  bridge.escape = escape;
  bridge.openFind = openFind;
  bridge.toggleRestriction = (area) => toggleRestriction(area);
  bridge.navigateArea = (area, settings) => scrollToArea(area, settings);

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

  /** Tracks the same viewport boundary that turns the Resources panel into a modal sheet. */
  useEffect(() => {
    const query = matchMedia("(max-width: 960px)");
    /** Mirrors the narrow media query into React state. */
    const changed = () => setNarrowResources(query.matches);
    changed(); query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);

  /** Re-reads catalog and cached resolver facts on the server's independent workspace cadence. */
  useEffect(() => {
    const configured = Number(options.resourceCadenceMs);
    const cadenceMs = Number.isFinite(configured) && configured > 0 ? Math.max(25, configured) : 30_000;
    const timer = setInterval(() => setResourceCadence((value) => value + 1), cadenceMs);
    return () => clearInterval(timer);
  }, [options.resourceCadenceMs]);

  /** Resolves loaded resource Blocks in one bounded request; facts never touch scene authority. */
  useEffect(() => {
    if (typeof options.api !== "function") return undefined;
    const resources = [...new Map(state.composition.scene.elements.flatMap((element) => {
      const tangent = boardCore.tangentOf(element); const owner = element.customData?.tangentWorld?.owner;
      if (element.isDeleted || tangent?.kind !== "resource" || !owner) return [];
      const locator = { owner, id: tangent.ref }; const key = resourceLocatorKey(locator);
      return key ? [[key, locator]] : [];
    })).values()];
    const key = JSON.stringify(resources.map(resourceLocatorKey).sort());
    const requestKey = `${resourceCadence}:${key}`;
    if (resourceResolveKeyRef.current === requestKey) return undefined;
    resourceResolveKeyRef.current = requestKey;
    resourceResolveRequestRef.current?.abort();
    const previousMapKeys = resourceMapResolutionKeysRef.current;
    const nextMapKeys = new Set(resources.map(resourceLocatorKey));
    resourceMapResolutionKeysRef.current = nextMapKeys;
    if (!resources.length) {
      controller.setResourceResolutions?.([], { replace: true });
      setResourceResolutions((current) => {
        const next = new Map(current);
        for (const resolvedKey of previousMapKeys) next.delete(resolvedKey);
        return next;
      });
      resourceObservationRefreshKeyRef.current = "";
      return undefined;
    }
    const refreshObservations = resourceObservationRefreshKeyRef.current !== key;
    const request = new AbortController();
    resourceResolveRequestRef.current = request;
    void requestResource("/api/areas/map-resources/resolve", { resources }, { signal: request.signal }).then((result) => {
      if (resourceResolveRequestRef.current !== request) return;
      const values = result.resolutions ?? result.results ?? (Array.isArray(result) ? result : []);
      controller.setResourceResolutions?.(values, { replace: true });
      setResourceResolutions((current) => {
        const next = new Map(current);
        for (const resolvedKey of previousMapKeys) next.delete(resolvedKey);
        for (const resolution of values) {
          const locator = resolution.value?.locator ?? resolution.locator;
          const resolvedKey = resourceLocatorKey(locator); if (resolvedKey) next.set(resolvedKey, resolution);
        }
        return next;
      });
      if (refreshObservations) {
        resourceObservationRefreshKeyRef.current = key;
        void refreshResourceFacts(resources, { quiet: true });
      }
    }, () => { /* An unresolved Block stays inert and compatible. */ });
    return undefined;
  }, [state.revision, options.api, resourceCadence]);

  useEffect(() => () => { resourceResolveRequestRef.current?.abort(); resourcePanelRequestRef.current?.abort(); }, []);

  /** Re-reads an open inventory without turning the catalog cadence into provider polling. */
  useEffect(() => {
    if (!resourceCadence || !resourcesOpen || !resourcesArea) return;
    void loadResources(resourcesArea, { refreshObservations: false });
  }, [resourceCadence]);

  /** Makes every retained shell surface inert while a narrow Resources or recovery modal owns focus. */
  useEffect(() => {
    if (!(resourcesOpen && narrowResources) && !resourceRecovery && !resourceSceneRecovery) return undefined;
    const root = host.querySelector(":scope > .TangentAreaMap");
    const activeClass = resourceSceneRecovery || resourceRecovery ? "tangent-map-resource-recovery" : "tangent-map-resources-backdrop";
    const mapChildren = [...(root?.children ?? [])].filter((child) => !child.classList.contains(activeClass));
    const mapPane = host.closest("[data-split-pane='map']");
    const workspace = mapPane?.closest(".split-workspace");
    const workspaceSiblings = [...(workspace?.children ?? [])].filter((child) => child !== mapPane);
    const screen = host.closest("#screen");
    const app = screen?.parentElement?.id === "app" ? screen.parentElement : host.closest("#app");
    const appSiblings = [...(app?.children ?? [])].filter((child) => child !== screen);
    const muted = [...new Set([...mapChildren, ...workspaceSiblings, ...appSiblings])];
    const prior = new Map(muted.map((element) => [element, element.inert]));
    for (const element of muted) element.inert = true;
    requestAnimationFrame(() => {
      const target = resourceSceneRecovery || resourceRecovery
        ? host.querySelector(".tangent-map-resource-recovery [role='dialog']")
        : resourcesHeadingRef.current;
      target?.focus?.({ preventScroll: true });
    });
    return () => { for (const [element, inert] of prior) element.inert = inert; };
  }, [narrowResources, resourcesOpen, resourceRecovery, resourceSceneRecovery]);

  /** Makes the Map briefly inert while catalog and source authority commit together. */
  useEffect(() => {
    if (!resourceSceneBusy) return undefined;
    const root = host.querySelector(":scope > .TangentAreaMap");
    const muted = [...(root?.children ?? [])].filter((child) => !child.classList.contains("tangent-map-resource-transaction"));
    const prior = new Map(muted.map((element) => [element, element.inert]));
    for (const element of muted) element.inert = true;
    return () => { for (const [element, inert] of prior) element.inert = inert; };
  }, [resourceSceneBusy]);

  /** Keeps the shell header aligned without moving map state into the shell. */
  useEffect(() => {
    options.onViewState?.({ locatedArea: state.locatedArea, selectedArea, restrictionArea: state.restrictionArea, findOpen, nextEscape: resourceLocate ? "Esc returns from Show on Map" : state.nextEscape });
  }, [findOpen, resourceLocate, selectedArea, state.locatedArea, state.nextEscape, state.restrictionArea]);

  /** Prints one action result and gives assistive technology a fresh live node. */
  function announce(message, { visible = true } = {}) {
    if (!message) return;
    if (visible) setNotice(message);
    setAnnouncement((value) => ({ id: value.id + 1, text: message }));
  }

  /** Sends one private resource request through the same loopback client as Map authority. */
  function requestResource(path, body = null, { signal } = {}) {
    if (typeof options.api !== "function") return Promise.reject(new Error("Map resources are unavailable"));
    return options.api(path, body === null ? (signal ? { signal } : undefined) : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  /** Replaces only validated resource-read facts, leaving scene and view authority untouched. */
  function installResourceProjection(projection, area = resourcesArea) {
    if (!projection || !["current", "partial", "unavailable"].includes(projection.state)) return false;
    if (area) setResourcesArea(area);
    if (projection.state === "unavailable") {
      const retained = area === resourcesArea && Boolean(resourceProjection?.rows?.length);
      if (!retained) setResourceProjection(projection);
      setResourceTransport({ state: retained ? "last-known" : "unavailable", error: projection.error?.message || "Map resources did not load." });
      return true;
    }
    setResourceProjection(projection);
    setResourceTransport({ state: projection.state, error: "" });
    const legacyKeys = new Set((projection.legacyReview ?? []).map(legacyCandidateKey));
    setLegacySelected((current) => new Set([...current].filter((key) => legacyKeys.has(key))));
    const values = (projection.rows ?? []).map(resourceResolutionForRow).filter(Boolean);
    controller.setResourceResolutions?.(values);
    setResourceResolutions((current) => {
      const next = new Map(current);
      for (const row of projection.rows ?? []) {
        const resolution = resourceResolutionForRow(row);
        const key = resourceLocatorKey(resourceEntityForRow(row)?.locator);
        if (key && resolution) next.set(key, resolution);
      }
      return next;
    });
    return true;
  }

  /** Loads confirmed inventory without starting discovery. Cached rows remain visible on failure. */
  async function loadResources(area = resourcesArea || selectedArea || state.locatedArea, { refreshObservations = true, rebaseDraft = false } = {}) {
    if (!area) return null;
    const generation = ++resourcePanelGenerationRef.current;
    resourcePanelRequestRef.current?.abort();
    const request = new AbortController();
    resourcePanelRequestRef.current = request;
    setResourceTransport((current) => ({ state: current.state === "idle" ? "loading" : "refreshing", error: "" }));
    try {
      const result = await requestResource(`/api/areas/map-resources?area=${encodeURIComponent(area)}`, null, { signal: request.signal });
      if (resourcePanelGenerationRef.current !== generation || resourcePanelRequestRef.current !== request) return null;
      installResourceProjection(result, area);
      setResourceEditor((current) => {
        if (!current) return current;
        let remapped = current;
        if (current.mode === "edit") {
          const id = resourceEntityForRow(current.row)?.locator?.id;
          const matches = id ? (result.rows ?? []).filter((row) => resourceEntityForRow(row)?.locator?.id === id) : [];
          if (matches.length === 1) remapped = { ...current, row: matches[0] };
        } else if (current.mode === "add" && current.owner !== area) remapped = { ...current, owner: area };
        const nextExpectations = draftCatalogExpectations(remapped, result);
        if (rebaseDraft) return { ...remapped, expectedCatalogs: nextExpectations, stale: false, error: "" };
        const locatorChanged = resourceLocatorKey(resourceEntityForRow(current.row)?.locator) !== resourceLocatorKey(resourceEntityForRow(remapped.row)?.locator);
        if (!locatorChanged && JSON.stringify(current.expectedCatalogs ?? []) === JSON.stringify(nextExpectations)) return current;
        queueMicrotask(() => setResourceMutationRecovery({ code: "catalog-revision-changed", recovery: { code: "catalog-revision-changed", projection: result }, mutation: null, operationId: current.operationId, success: "Map resources updated.", opener: document.activeElement, message: "Resources changed. Reload before you save." }));
        return { ...remapped, stale: true, error: "Resources changed. Reload before you save." };
      });
      setResourceMutationRecovery((current) => current && ["catalog-revision-changed", "suggestion-changed"].includes(current.code) ? null : current);
      const locators = (result.rows ?? []).map((row) => resourceEntityForRow(row)?.locator).filter(Boolean);
      if (refreshObservations && locators.length) void refreshResourceFacts(locators, { quiet: true });
      return result;
    } catch (error) {
      if (resourcePanelGenerationRef.current !== generation || resourcePanelRequestRef.current !== request || error?.name === "AbortError") return null;
      const message = String(error?.payload?.error ?? error?.message ?? error);
      setResourceTransport((current) => ({ state: resourceProjection ? "last-known" : "unavailable", error: message }));
      return null;
    } finally { if (resourcePanelRequestRef.current === request) resourcePanelRequestRef.current = null; }
  }

  /** Invalidates any older inventory GET before installing newer transaction evidence. */
  function cancelResourcePanelLoad() {
    resourcePanelGenerationRef.current += 1;
    resourcePanelRequestRef.current?.abort();
    resourcePanelRequestRef.current = null;
  }

  /** Opens the retained Map-owned resource sheet for one unambiguous Area. */
  function openResources(area = selectedArea || state.locatedArea, opener = document.activeElement) {
    if (resourcePlacement) { announce("Place or cancel the current resource Block first."); return false; }
    const selectedOwners = new Set(state.composition.scene.elements
      .filter((element) => state.selection.has(element.id))
      .map((element) => element.customData?.tangent?.area ?? element.customData?.tangentWorld?.owner)
      .filter(Boolean));
    if (!area || selectedOwners.size > 1) { announce("Select one Area before changing Map resources."); return false; }
    resourcesOpenerRef.current = opener;
    if (resourcesArea !== area) { setResourceEditor(null); setResourceProjection(null); setResourceDiscovery(null); setResourceMutationRecovery(null); setLegacySelected(new Set()); setLegacyReviewHidden(false); }
    setResourcesArea(area); setResourcesOpen(true); setResourceDetails(null); setResourceFilter("");
    setPicker(null); setHelpOpen(false); setOutlineOpen(false);
    if (findOpen) cancelFind();
    void loadResources(area);
    requestAnimationFrame(() => resourcesHeadingRef.current?.focus({ preventScroll: true }));
    return true;
  }

  /** Closes the sheet and restores its exact connected opener. */
  function closeResources() {
    const opener = resourcesOpenerRef.current;
    setResourcesOpen(false); setResourceDetails(null);
    requestAnimationFrame(() => (opener?.isConnected ? opener : host.querySelector(".excalidraw"))?.focus?.({ preventScroll: true }));
  }

  /** Restores a row opener after React replacement and any short current-read gate. */
  function focusResourceControl(selector) {
    const request = { selector, attempts: 0 };
    pendingResourceControlFocusRef.current = request;
    /** Focuses the requested control once it exists, retrying across frames. */
    const attempt = () => {
      if (pendingResourceControlFocusRef.current !== request) return;
      const target = host.querySelector(selector);
      if (target?.isConnected && !target.disabled && !target.closest("[inert]")) {
        target.focus({ preventScroll: true });
        pendingResourceControlFocusRef.current = null;
        return;
      }
      request.attempts += 1;
      if (request.attempts < 120) requestAnimationFrame(attempt);
      else { pendingResourceControlFocusRef.current = null; resourcesHeadingRef.current?.focus?.({ preventScroll: true }); }
    };
    requestAnimationFrame(() => requestAnimationFrame(attempt));
  }

  /** Returns current resource authority for one composed source-owned Block. */
  function resolutionForBlock(block) {
    const tangent = boardCore.tangentOf(block);
    const owner = block?.customData?.tangentWorld?.owner;
    if (tangent?.kind !== "resource" || !owner) return null;
    return resourceResolutions.get(resourceLocatorKey({ owner, id: tangent.ref })) ?? null;
  }

  /** Resolves one Map Block into the common accessible/display/action contract. */
  function resolvedBlock(block) {
    return resolveMapEntity({ element: block, documents, resource: resolutionForBlock(block) });
  }

  /** Preserves the existing shell navigation adapter for non-browser actions. */
  function dispatchShellEntityAction(action, entity) {
    if (typeof options.onEntityAction === "function") { options.onEntityAction(action, entity); return true; }
    if (action?.kind === "open-goal") options.onEntityVerb?.({ kind: "goal", ref: action.file, verb: "enter" });
    else if (action?.kind === "open-document") options.onEntityVerb?.({ kind: "document", ref: `${action.file}${action.subpath ?? ""}`, verb: action.mode === "read" ? "read" : "open" });
    else if (action?.kind === "open-area-brain") options.onEntityVerb?.({ kind: "area", area: action.area, ref: `${action.area}/${leaf(action.area)}.md`, verb: "enter" });
    else return false;
    return true;
  }

  /** Runs the typed primary/read action and exposes truthful recoverable browser outcomes. */
  async function dispatchMapEntity(entity, action = entity?.primaryAction, opener = document.activeElement) {
    if (!entity || !action) return { kind: "unavailable" };
    if (!["copy-path", "copy-url", "open-url"].includes(action.kind)) {
      return dispatchShellEntityAction(action, entity) ? { kind: "done" } : { kind: "unavailable" };
    }
    const result = await runMapEntityAction(action);
    if (result.kind === "done") {
      if (action.kind === "copy-path") announce(`Copied ${entity.display.label} path.`);
      else if (action.kind === "copy-url") announce("Copied link.");
      return result;
    }
    recoveryOpenerRef.current = opener;
    setResourceRecovery({ result, entity, action, message: action.kind === "open-url" ? `Could not open ${action.targetLabel}.` : action.kind === "copy-url" ? "Could not copy link." : `Could not copy ${entity.display.label} path.` });
    announce(action.kind === "open-url" ? `Could not open ${action.targetLabel}.` : action.kind === "copy-url" ? "Could not copy link." : `Could not copy ${entity.display.label} path.`);
    return result;
  }

  /** Closes action recovery without changing Map state. */
  function closeResourceRecovery() {
    const opener = recoveryOpenerRef.current;
    setResourceRecovery(null);
    requestAnimationFrame(() => (opener?.isConnected ? opener : host.querySelector(".excalidraw"))?.focus?.({ preventScroll: true }));
  }

  /** Retries one action from inside its retained recovery dialog. */
  async function retryResourceAction(action = resourceRecovery?.action) {
    const result = await runMapEntityAction(action);
    if (result.kind === "done") {
      const message = action.kind === "copy-path" ? `Copied ${resourceRecovery.entity.display.label} path.` : action.kind === "copy-url" ? "Copied link." : "";
      closeResourceRecovery(); if (message) announce(message); return result;
    }
    setResourceRecovery((current) => ({ ...current, result }));
    return result;
  }

  /** Copies the blocked URL through the same exact selectable recovery surface. */
  function copyBlockedLink() {
    const url = resourceRecovery?.result?.url ?? resourceRecovery?.action?.url;
    if (!url) return;
    const action = { kind: "copy-url", url };
    setResourceRecovery((current) => ({ ...current, action, message: "Could not copy link." }));
    void retryResourceAction(action);
  }

  /** Refreshes system-owned observations without entering Map history or save state. */
  async function refreshResourceFacts(locators, { quiet = false } = {}) {
    if (!resourceControlsAvailable()) return null;
    if (!locators?.length) return null;
    const requested = locators.filter((locator) => {
      const key = resourceLocatorKey(locator);
      return key && !resourceRefreshingRef.current.has(key);
    });
    if (!requested.length) return null;
    const keys = new Set(requested.map(resourceLocatorKey));
    const previous = new Map();
    const checking = [];
    for (const locator of requested) {
      const key = resourceLocatorKey(locator);
      const row = resourceProjection?.rows?.find((candidate) => resourceLocatorKey(resourceEntityForRow(candidate)?.locator) === key);
      const value = resourceResolutions.get(key) ?? (row ? resourceResolutionForRow(row) : null);
      if (!value) continue;
      previous.set(key, value);
      checking.push(checkingResourceResolution(value));
    }
    resourceRefreshingRef.current = new Set([...resourceRefreshingRef.current, ...keys]);
    setResourceRefreshing(new Set(resourceRefreshingRef.current));
    if (checking.length) {
      controller.setResourceResolutions?.(checking);
      setResourceResolutions((current) => {
        const next = new Map(current);
        for (const resolution of checking) {
          const key = resourceLocatorKey(resolution.value?.locator ?? resolution.locator);
          if (key) next.set(key, resolution);
        }
        return next;
      });
      const focused = selectedMapEntityElement(state.composition.scene.elements, state.selection);
      const tangent = focused ? boardCore.tangentOf(focused) : null;
      const focusedKey = tangent?.kind === "resource" ? resourceLocatorKey({ owner: focused.customData?.tangentWorld?.owner, id: tangent.ref }) : "";
      if (focusedKey && keys.has(focusedKey)) announce(`${checking.find((value) => resourceLocatorKey(value.value?.locator) === focusedKey)?.value?.label ?? "Resource"} status is Checking.`, { visible: false });
    }
    try {
      const result = await requestResource("/api/areas/map-resources/refresh", { resources: requested });
      const values = result.resolutions ?? result.results ?? (Array.isArray(result) ? result : []);
      if (result.projection) installResourceProjection(result.projection);
      controller.setResourceResolutions?.(values);
      if (values.length) {
        setResourceResolutions((current) => {
          const next = new Map(current);
          for (const resolution of values) {
            const locator = resolution.value?.locator ?? resolution.locator;
            const key = resourceLocatorKey(locator); if (key) next.set(key, resolution);
          }
          return next;
        });
      }
      const focused = selectedMapEntityElement(state.composition.scene.elements, state.selection);
      const tangent = focused ? boardCore.tangentOf(focused) : null;
      const focusedKey = tangent?.kind === "resource" ? resourceLocatorKey({ owner: focused.customData?.tangentWorld?.owner, id: tangent.ref }) : "";
      const current = values.find((value) => resourceLocatorKey(value.value?.locator ?? value.locator) === focusedKey);
      const before = previous.get(focusedKey);
      const priorLabel = providerLifecycleLabel(before);
      const nextLabel = providerLifecycleLabel(current);
      if (focusedKey && priorLabel && nextLabel && priorLabel !== nextLabel) announce(`${current.value.label} is now ${nextLabel}.`);
      else if (!quiet) announce("Resource status refreshed.");
      return result;
    } catch (error) {
      if (previous.size) {
        const values = [...previous.values()];
        controller.setResourceResolutions?.(values);
        setResourceResolutions((current) => new Map([...current, ...previous]));
      }
      if (!quiet) announce(`Could not refresh resource status. ${String(error?.payload?.error ?? error?.message ?? error)}`);
      return null;
    } finally {
      for (const key of keys) resourceRefreshingRef.current.delete(key);
      setResourceRefreshing(new Set(resourceRefreshingRef.current));
    }
  }

  /** Applies one revision-fenced catalog command with one stable operation ID. */
  async function applyResourceMutation(mutation, { operationId = crypto.randomUUID(), success = "Map resources updated.", opener = document.activeElement, expectedCatalogs = null, request: retainedRequest = null } = {}) {
    if (resourceProjection?.state !== "current" || resourceTransport.state !== "current") {
      announce("Map resources are read-only until the current catalog loads."); return null;
    }
    resourceMutationRecoveryOpenerRef.current = opener;
    setResourceMutationRecovery(null);
    setResourceBusy(mutation.kind);
    const owners = new Set(resourceMutationOwners(mutation).filter(Boolean));
    const request = retainedRequest ? clone(retainedRequest) : {
      schema: "area-map-resource-mutation.v1",
      operationId,
      viewedFrom: resourcesArea,
      mutation,
      ...(mutation.kind === "undo" ? {} : { expectedCatalogs: expectedCatalogs ? clone(expectedCatalogs) : (resourceProjection.catalogs ?? []).filter((catalog) => owners.has(catalog.owner)) }),
    };
    try {
      const result = await requestResource("/api/areas/map-resources/apply", request);
      cancelResourcePanelLoad();
      if (result.projection) installResourceProjection(result.projection, resourcesArea);
      setResourceUndo(result.undo?.state === "available" ? {
        ...result.undo,
        owner: resourcesArea,
        sourceCoupled: Boolean(result.sourceUpdates?.length),
        operationId: crypto.randomUUID(),
      } : null);
      setResourceMutationRecovery(null);
      const locator = result.resource?.locator;
      if (locator && ["add", "edit", "add-suggestion", "import-legacy"].includes(mutation.kind)) void refreshResourceFacts([locator], { quiet: true });
      announce(success);
      return result;
    } catch (error) {
      const payload = error?.payload ?? {};
      const projection = payload.recovery?.projection ?? payload.projection;
      if (projection) { cancelResourcePanelLoad(); installResourceProjection(projection, resourcesArea); }
      const message = payload.error ?? error?.message ?? "Map resources were not saved.";
      if (payload.code === "missing-target-confirmation-required" && payload.recovery?.inspection) {
        setResourceEditor((current) => current ? { ...current, inspection: payload.recovery.inspection, confirmMissing: false, error: String(message), operationId } : current);
      } else setResourceEditor((current) => current ? { ...current, error: String(message), operationId } : current);
      setResourceMutationRecovery({ code: payload.code ?? "resource-mutation-failed", recovery: payload.recovery ?? {}, mutation, operationId, success, opener, request, message: String(message) });
      announce(`Map resources were not saved. ${String(message)}`);
      return null;
    } finally { setResourceBusy(""); }
  }

  /** Reports whether current panel and transport authority permit a write or placement. */
  function resourceWritesAvailable() {
    return resourceControlsAvailable() && resourceProjection?.state === "current" && resourceTransport.state === "current" && !resourceBusy;
  }

  /** Keeps the independent resource-write rollout closed without hiding useful reads. */
  function resourceControlsAvailable() {
    return globalThis.TANGENT_FEATURES?.areaMapResourceWrites !== false;
  }

  /** Keeps one draft fenced to the catalog revisions visible when it opened. */
  function draftCatalogExpectations(draft, projection = resourceProjection) {
    const owner = draft?.mode === "edit" ? resourceEntityForRow(draft.row)?.locator?.owner
      : draft?.mode === "suggestion" ? draft.suggestion?.owner
        : draft?.owner;
    return (projection?.catalogs ?? []).filter((catalog) => catalog.owner === owner).map(clone);
  }

  /** Closes one typed catalog recovery without discarding its retained draft. */
  function closeResourceMutationRecovery() {
    const opener = resourceMutationRecoveryOpenerRef.current;
    setResourceMutationRecovery(null);
    requestAnimationFrame(() => (opener?.isConnected ? opener : resourcesHeadingRef.current)?.focus?.({ preventScroll: true }));
  }

  /** Opens the duplicate resource named by server-owned recovery evidence. */
  function openRecoveryResource() {
    const locator = resourceMutationRecovery?.recovery?.existing;
    if (!locator) return false;
    setResourceDetails(locator);
    setResourceMutationRecovery(null);
    return true;
  }

  /** Locates, restores, or places the exact duplicate row from the installed recovery projection. */
  function showRecoveryResource() {
    const locator = resourceMutationRecovery?.recovery?.existing;
    const row = resourceProjection?.rows?.find((candidate) => resourceLocatorKey(resourceEntityForRow(candidate)?.locator) === resourceLocatorKey(locator));
    if (!row) return false;
    setResourceMutationRecovery(null);
    return placeResourceOnMap(row, resourceMutationRecoveryOpenerRef.current);
  }

  /** Applies one explicit legacy Branch owner choice as a new reviewed intent. */
  function chooseLegacyBranch(choice) {
    const retained = resourceMutationRecovery;
    if (retained?.mutation?.kind !== "import-legacy") return false;
    const selections = retained.mutation.selections.map((selection) => ({
      ...selection,
      attachDeclaredBranch: selection.candidate?.owner === choice.owner && selection.candidate?.targetFingerprint === choice.targetFingerprint,
    }));
    setResourceMutationRecovery(null);
    void applyResourceMutation({ ...retained.mutation, selections }, { success: retained.success, opener: retained.opener });
    return true;
  }

  /** Retries one unchanged catalog envelope after an interruption with unknown commit outcome. */
  function retryResourceMutationRecovery() {
    const retained = resourceMutationRecovery;
    if (!retained?.mutation || !retained.request) return null;
    return applyResourceMutation(retained.mutation, retained);
  }

  /** Imports every explicitly selected legacy row as one atomic multi-owner mutation. */
  function importSelectedLegacy(opener = document.activeElement) {
    const candidates = (resourceProjection?.legacyReview ?? []).filter((candidate) => candidate?.state === "candidate" && legacySelected.has(legacyCandidateKey(candidate)));
    if (!candidates.length || !resourceWritesAvailable()) return null;
    const mutation = { kind: "import-legacy", selections: candidates.map((candidate) => ({ candidate: suggestionReference(candidate), attachDeclaredBranch: Boolean(candidate.declaredBranch) })) };
    return applyResourceMutation(mutation, { opener, success: `${candidates.length} legacy ${candidates.length === 1 ? "resource" : "resources"} imported.` }).then((result) => {
      if (result) { setLegacySelected(new Set()); setLegacyReviewHidden(false); }
      return result;
    });
  }

  /** Changes the inventory scope to the exact owner of an inherited association. */
  function openResourceSourceArea(row) {
    const owner = resourceEntityForRow(row)?.locator?.owner;
    if (!owner) return false;
    setResourcesArea(owner); setResourceProjection(null); setResourceDetails(null); setResourceDiscovery(null); setResourceMutationRecovery(null); setLegacySelected(new Set()); setLegacyReviewHidden(false);
    void loadResources(owner);
    requestAnimationFrame(() => resourcesHeadingRef.current?.focus?.({ preventScroll: true }));
    return true;
  }

  /** Returns the one loaded source shard that can participate in an exact scene mutation. */
  function resourceSourceShard(owner) {
    if (!owner || owner === "@root") return null;
    const node = controller.world().areas.find((entry) => entry.key === owner);
    return node?.shard?.scene && typeof node.shard.hash === "string" && node.shard.hash ? node.shard : null;
  }

  /** Applies a catalog-plus-scene mutation only after canonical Map writes are fully saved. */
  async function applySceneResourceMutation(mutation, {
    operationId = crypto.randomUUID(),
    opener = document.activeElement,
    success = "Map resource updated.",
    request: retainedRequest = null,
    owner: retainedOwner = null,
  } = {}) {
    const owner = retainedOwner ?? (mutation?.kind === "associate-generic-link" ? mutation.owner : mutation?.oldResource?.owner);
    let request = retainedRequest ? clone(retainedRequest) : null;
    resourceSceneRecoveryOpenerRef.current = opener;
    setResourceSceneRecovery(null);
    setResourceBusy(mutation?.kind ?? "scene-resource");
    setResourceSceneBusy({ label: mutation?.kind === "undo" ? "Undoing Map resource change…" : mutation?.kind === "add-back-gone" ? "Adding resource back to Area…" : "Adding Link to Area…" });
    try {
      await controller.flush();
      if (controller.snapshot().save.state !== "saved") {
        throw Object.assign(new Error("Save or recover the current Map change before changing this resource."), { code: "resource-representation-conflict" });
      }
      if (!request) {
        const projection = await requestResource(`/api/areas/map-resources?area=${encodeURIComponent(owner)}`);
        if (projection?.state !== "current") {
          throw Object.assign(new Error("Map resources are read-only until the current catalog loads."), { code: "resource-catalog-unavailable" });
        }
        cancelResourcePanelLoad();
        installResourceProjection(projection, owner);
        const shard = resourceSourceShard(owner);
        if (!shard || controller.snapshot().save.state !== "saved") {
          throw Object.assign(new Error("The owning Area Map source is not ready for this resource change."), { code: "resource-source-load-failed" });
        }
        request = {
          schema: "area-map-resource-mutation.v1",
          operationId,
          viewedFrom: owner,
          mutation,
          expectedCatalogs: (projection.catalogs ?? []).filter((catalog) => catalog.owner === owner),
          expectedScenes: [{ owner, hash: shard.hash }],
        };
      }
      const result = await requestResource("/api/areas/map-resources/apply", request);
      if (!Array.isArray(result.sourceUpdates) || !result.sourceUpdates.length) {
        throw Object.assign(new Error("The resource transaction returned no Map source update."), { code: "resource-source-invalid" });
      }
      if (controller.snapshot().save.state !== "saved") {
        throw Object.assign(new Error("A Map change started before the resource source could be installed."), { code: "resource-representation-conflict" });
      }
      controller.installResourceSourceUpdates(result.sourceUpdates);
      cancelResourcePanelLoad();
      if (result.projection) installResourceProjection(result.projection, owner);
      else await loadResources(owner, { refreshObservations: false });
      setResourceUndo(result.undo?.state === "available" ? {
        ...result.undo,
        owner,
        sourceCoupled: true,
        operationId: crypto.randomUUID(),
      } : null);
      const locator = result.resource?.locator;
      if (locator) void refreshResourceFacts([locator], { quiet: true });
      announce(success);
      return result;
    } catch (error) {
      const payload = error?.payload ?? {};
      const projection = payload.recovery?.projection ?? payload.projection;
      if (projection) { cancelResourcePanelLoad(); installResourceProjection(projection, owner); }
      const message = String(payload.error ?? error?.message ?? "The Area resource and Map source were not saved together.");
      setResourceSceneRecovery({ phase: "error", mutation, operationId, opener, success, request, owner, code: payload.code ?? error?.code ?? "resource-transaction-failed", message });
      announce(`Map resource was not saved. ${message}`);
      return null;
    } finally {
      setResourceBusy("");
      setResourceSceneBusy(null);
    }
  }

  /** Associates one selected generic Link with the Area that owns its source element. */
  function associateGenericLink(entity, opener = document.activeElement) {
    if (!resourceWritesAvailable()) { announce("Map resource changes are not enabled in this workspace."); return false; }
    if (entity?.reference?.kind !== "link" || !entity.source?.owner || !entity.source?.sourceId) return false;
    void applySceneResourceMutation({
      kind: "associate-generic-link",
      owner: entity.source.owner,
      sourceElementId: entity.source.sourceId,
      labelForNewRecord: null,
    }, { opener, success: "Link added to Area resources." });
    return true;
  }

  /** Opens explicit confirmation for the only gone records that still have a safe exact target. */
  function requestAddBack(row, opener = document.activeElement) {
    if (!resourceWritesAvailable()) { announce("Reload current Map resources before adding this Block back."); return false; }
    const entity = resourceEntityForRow(row);
    const direct = row?.relation?.kind !== "inherited" && row?.viewedFrom === entity?.locator?.owner;
    const target = entity?.lastKnown?.target;
    if (!direct || representationForRow(row) !== "on-map" || !["removed", "missing-record"].includes(entity?.reason) || !target) return false;
    const retained = {
      phase: "confirm-add-back",
      operationId: crypto.randomUUID(),
      opener,
      row: clone(row),
      label: entity.lastKnown?.label || `Resource ${entity.locator.id}`,
      target: target.url ?? target.path,
    };
    resourceSceneRecoveryOpenerRef.current = opener;
    setResourceSceneRecovery(retained);
    return true;
  }

  /** Confirms Last-known authority, then replaces the visible gone ID in one exact transaction. */
  async function confirmAddBack(retained = resourceSceneRecovery) {
    const row = retained?.row;
    const entity = resourceEntityForRow(row);
    if (!entity?.locator || !entity.lastKnown?.target) return null;
    let source = { kind: "tombstone" };
    if (entity.reason === "missing-record") {
      setResourceSceneRecovery(null);
      setResourceBusy("add-back-gone");
      setResourceSceneBusy({ label: "Confirming Last-known resource target…" });
      try {
        const target = entity.lastKnown.target;
        const inspected = await requestResource("/api/areas/map-resources/inspect-target", target.kind === "link"
          ? { kind: "link", url: target.url }
          : { kind: target.kind, path: target.path });
        const input = inspected.kind === "link"
          ? { target: inspected.normalized }
          : { target: inspected.normalized, missingConfirmation: inspected.state === "missing" ? { targetFingerprint: inspected.targetFingerprint } : null };
        source = { kind: "confirmed-last-known", input, label: String(entity.lastKnown.label ?? "") };
      } catch (error) {
        const message = String(error?.payload?.error ?? error?.message ?? error);
        setResourceSceneRecovery({ ...retained, phase: "error-add-back", message });
        announce(`Map resource was not saved. ${message}`);
        return null;
      } finally {
        setResourceBusy("");
        setResourceSceneBusy(null);
      }
    }
    return applySceneResourceMutation({ kind: "add-back-gone", oldResource: entity.locator, source }, {
      operationId: retained.operationId,
      opener: retained.opener,
      success: `${retained.label} added back to Area resources.`,
    });
  }

  /** Retries one retained scene action with the operation ID from its first attempt. */
  function retrySceneResourceMutation() {
    const retained = resourceSceneRecovery;
    if (!retained) return null;
    if (retained.phase === "error-add-back") return confirmAddBack(retained);
    return applySceneResourceMutation(retained.mutation, retained);
  }

  /** Undoes scene-coupled receipts through the same saved-source install boundary. */
  function undoResourceChange(opener = document.activeElement) {
    if (!resourceUndo?.token) return null;
    const mutation = { kind: "undo", token: resourceUndo.token };
    if (!resourceUndo.sourceCoupled) return applyResourceMutation(mutation, { operationId: resourceUndo.operationId, opener, success: "Resource change undone." });
    const owner = resourceUndo.owner || resourcesArea;
    const request = {
      schema: "area-map-resource-mutation.v1",
      operationId: resourceUndo.operationId,
      viewedFrom: owner,
      mutation,
    };
    return applySceneResourceMutation(mutation, { operationId: resourceUndo.operationId, opener, owner, request, success: "Resource change undone." });
  }

  /** Closes scene confirmation or recovery and returns to its exact connected opener. */
  function closeResourceSceneRecovery() {
    const opener = resourceSceneRecoveryOpenerRef.current;
    setResourceSceneRecovery(null);
    requestAnimationFrame(() => (opener?.isConnected ? opener : resourcesOpen ? resourcesHeadingRef.current : host.querySelector(".excalidraw"))?.focus?.({ preventScroll: true }));
  }

  /** Opens an Add, Edit, or Suggestion draft without changing current facts. */
  function editResource({ mode = "add", kind = null, row = null, suggestion = null } = {}) {
    if (!resourceWritesAvailable()) { announce("Map resources are read-only until the current catalog loads."); return false; }
    const entity = row ? resourceEntityForRow(row) : null;
    const existing = entity?.target ?? suggestion?.target ?? null;
    const requestedKind = kind ?? (existing?.kind === "local-path" ? "worktree" : existing?.kind) ?? "worktree";
    const target = existing && requestedKind === (existing.kind === "local-path" ? "worktree" : existing.kind)
      ? existing
      : requestedKind === "link" ? { kind: "link", url: existing?.url ?? "" } : { kind: requestedKind, path: existing?.path ?? "" };
    setResourceDetails(null);
    const draft = { mode, owner: mode === "add" ? resourcesArea : null, kind: requestedKind, label: entity?.label ?? suggestion?.proposedLabel ?? "", target: target.url ?? target.path ?? "", row, suggestion, inspection: null, confirmMissing: false, error: "", operationId: crypto.randomUUID() };
    setResourceEditor({ ...draft, expectedCatalogs: draftCatalogExpectations(draft) });
    return true;
  }

  /** Inspects, confirms, and saves one retained resource draft. */
  async function saveResourceDraft() {
    const draft = resourceEditor; if (!draft) return null;
    if (draft.stale) { announce("Resources changed. Reload before you save."); return null; }
    setResourceBusy("inspect");
    try {
      const inspected = await requestResource("/api/areas/map-resources/inspect-target", draft.kind === "link" ? { kind: "link", url: draft.target } : { kind: draft.kind, path: draft.target });
      if (inspected.kind === "local" && inspected.state === "missing" && !draft.confirmMissing) {
        setResourceEditor({ ...draft, inspection: inspected, error: "The path is missing. Confirm that you want to record this future target." });
        return null;
      }
      const input = inspected.kind === "link"
        ? { target: inspected.normalized }
        : { target: inspected.normalized, missingConfirmation: inspected.state === "missing" ? { targetFingerprint: inspected.targetFingerprint } : null };
      let mutation;
      if (draft.mode === "edit") mutation = { kind: "edit", resource: resourceEntityForRow(draft.row).locator, input, label: draft.label.trim() || null };
      else if (draft.mode === "suggestion") mutation = { kind: "add-suggestion", selection: { suggestion: suggestionReference(draft.suggestion), input }, labelForNewRecord: draft.label.trim() || null };
      else mutation = { kind: "add", owner: resourcesArea, input, label: draft.label.trim() || null };
      const result = await applyResourceMutation(mutation, { operationId: draft.operationId, expectedCatalogs: draft.expectedCatalogs, success: draft.mode === "edit" ? "Resource updated." : "Resource added to Area." });
      if (result) setResourceEditor(null);
      return result;
    } catch (error) {
      const message = String(error?.payload?.error ?? error?.message ?? error);
      setResourceEditor((current) => current ? { ...current, error: message } : current);
      announce(`Resource target was not accepted. ${message}`);
      return null;
    } finally { setResourceBusy(""); }
  }

  /** Runs bounded discovery while keeping confirmed inventory authoritative. */
  async function discoverResources() {
    if (!resourceControlsAvailable()) return null;
    setResourceBusy("discover");
    setResourceDiscovery({ state: "checking", sources: [], problems: [] });
    try {
      const result = await requestResource("/api/areas/map-resources/discover", { area: resourcesArea });
      if (result.projection) installResourceProjection(result.projection, resourcesArea);
      else if (Array.isArray(result.suggestions)) setResourceProjection((current) => current ? { ...current, suggestions: result.suggestions } : current);
      setResourceDiscovery(result);
      announce(result.problems?.length ? "Worktree discovery finished with some unavailable sources." : "Worktree discovery finished.");
      return result;
    } catch (error) {
      const message = String(error?.payload?.error ?? error?.message ?? error);
      setResourceDiscovery({ state: "unavailable", sources: [], problems: [{ code: error?.payload?.code ?? error?.code ?? "discovery-unavailable", message, retryable: true }] });
      announce(`Could not discover worktrees. ${message}`); return null;
    } finally { setResourceBusy(""); }
  }

  /** Returns the loaded source record for one resource locator, including hidden records. */
  function sourceResourceBlock(row) {
    const locator = resourceEntityForRow(row)?.locator; if (!locator) return null;
    const node = controller.world().areas.find((entry) => entry.key === locator.owner);
    return node?.shard?.scene?.elements?.find((element) => {
      const tangent = boardCore.tangentOf(element);
      return tangent?.kind === "resource" && tangent.ref === locator.id;
    }) ?? null;
  }

  /** Gives retained live source bytes precedence over a cadence representation fact. */
  function representationForRow(row) {
    const source = sourceResourceBlock(row);
    if (source) return source.isDeleted ? "hidden" : "on-map";
    return savedRepresentationForRow(row);
  }

  /** Hides only the live representation through the shared Map command path. */
  function hideResourceOnMap(row) {
    if (!resourceWritesAvailable()) { announce("Reload current Map resources before changing their Map representation."); return false; }
    const locator = resourceEntityForRow(row)?.locator;
    const block = state.composition.scene.elements.find((element) => {
      const tangent = boardCore.tangentOf(element);
      return !element.isDeleted && tangent?.kind === "resource" && tangent.ref === locator?.id && element.customData?.tangentWorld?.owner === locator?.owner;
    });
    if (!block) { announce("That resource is not currently visible on the Map."); return false; }
    setResourceLocate(null);
    actionKindRef.current = "hide-resource";
    hideBlock(block);
    announce(`Hid ${resourceEntityForRow(row)?.label ?? "resource"} Block. The Area resource remains available.`);
    return true;
  }

  /** Captures every Map-local view property changed by a temporary resource layer. */
  function captureResourceViewLayer(extra = {}) {
    return {
      view: captureLiveView(),
      focus: clone(state.focus),
      manualFolded: new Set(state.manualFolded),
      ...extra,
    };
  }

  /** Restores exact Focus, Only, folds, camera, and selection for a temporary layer. */
  function restoreResourceViewLayer(layer) {
    controller.setRestriction(null);
    const folded = controller.snapshot().manualFolded;
    const desired = layer.manualFolded;
    for (const area of new Set([...folded, ...desired])) if (folded.has(area) !== desired.has(area)) controller.toggleFold(area);
    controller.setFocus(layer.focus);
    const restored = controller.restoreView(layer.view);
    projectCanvas({ appState: {
      scrollX: restored.camera.scrollX,
      scrollY: restored.camera.scrollY,
      zoom: { value: restored.camera.zoom },
      selectedElementIds: Object.fromEntries([...restored.selection].map((id) => [id, true])),
    }, captureUpdate: "NEVER" }, "view-return");
    return restored;
  }

  /** Restores one atomic Show-on-Map locate layer and its exact opener. */
  function restoreResourceLocate() {
    const locate = resourceLocate;
    if (!locate) return false;
    setResourceLocate(null);
    restoreResourceViewLayer(locate);
    if (locate.sheetWasOpen) {
      setResourcesArea(locate.resourcesArea); setResourceDetails(locate.details); setResourcesOpen(true);
      focusResourceControl(`[data-resource-show="${CSS.escape(locate.key)}"]`);
    } else if (locate.picker) {
      setPicker(locate.picker);
      requestAnimationFrame(() => host.querySelector(".tangent-map-picker input")?.focus?.({ preventScroll: true }));
    } else requestAnimationFrame(() => (locate.opener?.isConnected ? locate.opener : host.querySelector(".excalidraw"))?.focus?.({ preventScroll: true }));
    announce(`Returned from ${locate.entity.label} on the Map.`);
    return true;
  }

  /** Locates a live Block as one reversible Focus, fold, Only, camera, and selection layer. */
  function showResourceOnMap(row, opener = document.activeElement) {
    const entity = resourceEntityForRow(row); const locator = entity?.locator;
    const block = state.composition.scene.elements.find((element) => {
      const tangent = boardCore.tangentOf(element);
      return !element.isDeleted && tangent?.kind === "resource" && tangent.ref === locator?.id && element.customData?.tangentWorld?.owner === locator?.owner;
    });
    if (!block) { announce("That resource is not currently visible on the Map."); return false; }
    const locate = captureResourceViewLayer({
      entity,
      blockId: block.id,
      key: encodeURIComponent(`${locator.owner}/${locator.id}`),
      opener,
      sheetWasOpen: resourcesOpen,
      resourcesArea,
      details: resourceDetails,
      picker,
    });
    if (!state.scopedAreas.has(locator.owner)) controller.setRestriction(null);
    controller.setFocus({ only: false, activeOnly: false, areas: [] });
    for (const area of [...state.manualFolded]) if (locator.owner === area || locator.owner.startsWith(`${area}/`)) controller.toggleFold(area);
    controller.fitArea(locator.owner, { push: true, select: false });
    controller.setSelection([block.id]); programmaticSelectionRef.current = new Set([block.id]);
    projectCanvas({ appState: { selectedElementIds: { [block.id]: true } }, captureUpdate: "NEVER" }, "placed-block-selection");
    scrollCanvasTo([block], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    setResourceLocate(locate); setResourcesOpen(false); setPicker(null);
    requestAnimationFrame(() => host.querySelector(".excalidraw")?.focus?.({ preventScroll: true }));
    announce(`${entity.label} shown on the Map. Escape returns to the prior view.`);
    return true;
  }

  /** Restores the retained source Block and label as one undoable Map command. */
  function restoreResourceOnMap(row) {
    if (!resourceWritesAvailable()) { announce("Reload current Map resources before changing their Map representation."); return false; }
    const entity = resourceEntityForRow(row); const locator = entity?.locator;
    if (!locator) return false;
    if (representationForRow(row) === "on-map") return showResourceOnMap(row);
    const nextWorld = controller.world();
    const node = nextWorld.areas.find((entry) => entry.key === locator.owner);
    const source = node?.shard?.scene?.elements?.find((element) => boardCore.tangentOf(element)?.kind === "resource" && boardCore.tangentOf(element)?.ref === locator.id);
    if (!node?.shard?.scene || !source?.isDeleted) { announce("The hidden resource Block could not be restored."); return false; }
    node.shard.scene = boardCore.setBlockHidden(node.shard.scene, source.id, false);
    const authored = node.shard.scene.elements.filter((element) => !element.isDeleted && !boardCore.isAreaRegion(element) && !boardCore.isAreaBoundary(element));
    const hulls = worldCore.shardHulls(node.shard.scene);
    node.shard.elementCount = authored.length;
    node.shard.blockCount = authored.filter((element) => boardCore.tangentOf(element)).length;
    node.shard.ownBlockHull = hulls.blocks;
    node.shard.ownInkHull = hulls.ink;
    controller.commitWorld(nextWorld, { changedOwners: new Set([locator.owner]) }, "restore-resource");
    const runtime = worldCore.runtimeId(locator.owner, source.id);
    controller.setSelection([runtime]); programmaticSelectionRef.current = new Set([runtime]);
    const restored = controller.snapshot().composition.scene.elements.find((element) => element.id === runtime);
    projectCanvas({ elements: controller.snapshot().scene.elements, appState: { selectedElementIds: { [runtime]: true } }, captureUpdate: "NEVER" }, "placed-block-selection");
    if (restored) scrollCanvasTo([restored], { fitToContent: true, animate: false });
    if (resourcesOpen) closeResources(); else setPicker(null);
    requestAnimationFrame(() => host.querySelector(".excalidraw")?.focus?.({ preventScroll: true }));
    announce(`Restored ${entity.label} on the Map.`);
    return true;
  }

  /** Keeps a placement point inside the owning Area's current visible bounds. */
  function boundedResourcePlacementPoint(placement, point) {
    const box = state.composition.regionRects.get(placement.entity.locator.owner);
    if (!box) return point;
    const generated = worldCore.placeBlockAtNearestFreePoint(boardCore.createEmptyScene(), {
      kind: "resource", ref: placement.entity.locator.id, title: placement.entity.label, status: "",
    }, { x: 0, y: 0 }, "tangent-resource-placement-size");
    const halfWidth = Number(generated.root?.width ?? 0) / 2;
    const halfHeight = Number(generated.root?.height ?? 0) / 2;
    const x = box.width <= halfWidth * 2 ? box.x + box.width / 2 : Math.max(box.x + halfWidth, Math.min(box.x + box.width - halfWidth, point.x));
    const y = box.height <= halfHeight * 2 ? box.y + box.height / 2 : Math.max(box.y + halfHeight, Math.min(box.y + box.height - halfHeight, point.y));
    return { x, y };
  }

  /** Cancels the preview without creating scene or Map history. */
  function cancelResourcePlacement() {
    const placement = resourcePlacement;
    if (!placement) return false;
    setResourcePlacement(null);
    restoreResourceViewLayer(placement);
    if (placement.sheetWasOpen) {
      setResourcesOpen(true);
      focusResourceControl(`[data-resource-place="${CSS.escape(placement.key)}"]`);
    } else if (placement.picker) {
      setPicker(placement.picker);
      requestAnimationFrame(() => host.querySelector(".tangent-map-picker input")?.focus?.({ preventScroll: true }));
    } else requestAnimationFrame(() => (placement.opener?.isConnected ? placement.opener : host.querySelector(".excalidraw"))?.focus?.({ preventScroll: true }));
    announce("Resource placement cancelled.");
    return true;
  }

  /** Commits the preview point through the canonical Block/split/save pipeline. */
  function commitResourcePlacement(point = resourcePlacement?.point) {
    const placement = resourcePlacement;
    if (!placement || !point) return false;
    const exactPoint = boundedResourcePlacementPoint(placement, point);
    setResourcePlacement(null);
    actionKindRef.current = "place-resource";
    placeBlock({ kind: "resource", ref: placement.entity.locator.id, owner: placement.entity.locator.owner, title: placement.entity.label, status: "" }, false, { area: placement.entity.locator.owner, point: exactPoint });
    requestAnimationFrame(() => host.querySelector(".excalidraw")?.focus?.({ preventScroll: true }));
    announce(`Placed ${placement.entity.label} on the Map.`);
    return true;
  }

  /** Starts explicit placement at the nearest shared-layout point in the owner. */
  function placeResourceOnMap(row, opener = document.activeElement) {
    const entity = resourceEntityForRow(row); if (!entity) return false;
    const representation = representationForRow(row);
    if (representation === "on-map") return showResourceOnMap(row, opener);
    if (!resourceWritesAvailable()) { announce("Reload current Map resources before changing their Map representation."); return false; }
    if (representation === "hidden") return restoreResourceOnMap(row);
    if (representation === "unavailable") { announce("Placement is unavailable until the source Map loads."); return false; }
    const ownerNode = controller.world().areas.find((node) => node.key === entity.locator.owner);
    if (!ownerNode?.shard?.scene) { announce("Placement is unavailable until the source Map loads."); return false; }
    const box = state.composition.regionRects.get(entity.locator.owner);
    const center = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : placementPoint();
    const occupied = state.composition.scene.elements.filter((element) => !element.isDeleted && !ephemeral(element) && element.customData?.tangentWorld?.owner === entity.locator.owner);
    const generated = worldCore.placeBlockAtNearestFreePoint(boardCore.createEmptyScene(), {
      kind: "resource", ref: entity.locator.id, title: entity.label, status: "",
    }, center, "tangent-resource-placement-point", { occupied });
    const free = generated.root;
    if (!free) { announce("The resource Block could not be generated for placement."); return false; }
    const placement = captureResourceViewLayer({
      row,
      entity,
      key: encodeURIComponent(`${entity.locator.owner}/${entity.locator.id}`),
      point: { x: free.x + free.width / 2, y: free.y + free.height / 2 },
      opener,
      sheetWasOpen: resourcesOpen,
      picker,
    });
    if (!state.scopedAreas.has(entity.locator.owner)) controller.setRestriction(null);
    controller.setFocus({ only: false, activeOnly: false, areas: [] });
    for (const area of [...state.manualFolded]) if (entity.locator.owner === area || entity.locator.owner.startsWith(`${area}/`)) controller.toggleFold(area);
    const target = controller.fitArea(entity.locator.owner, { push: true, select: false });
    if (target) scrollCanvasTo([target], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    if (narrowResources) setResourcesOpen(false);
    setPicker(null); setResourcePlacement(placement);
    requestAnimationFrame(() => host.querySelector(".excalidraw")?.focus?.({ preventScroll: true }));
    announce(`Place ${entity.label}: click or press Enter. Arrow keys move the preview. Escape cancels.`);
    return true;
  }

  /** Changes one fold mask and announces the completed view action. */
  function changeFold(area) {
    const folded = controller.toggleFold(area);
    if (folded === null) { announce(`${leaf(area)} must stay open to show ${leaf(state.restrictionArea)}`); return null; }
    announce(`${leaf(area)} ${folded ? "folded" : "unfolded"}`);
    return folded;
  }

  /** Announces each save word once when controller state crosses that boundary. */
  useEffect(() => {
    if (state.save.state === previousSaveStateRef.current) return;
    previousSaveStateRef.current = state.save.state;
    const message = {
      saving: "Saving map…", saved: "Map saved.", blocked: "Map not saved. Retry.", conflict: "Map not saved. Reload saved or keep mine.", dirty: "Map change queued.",
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
    const placementElements = resourcePlacementPreview(resourcePlacement);
    const placementProjection = resourcePlacement ? `${resourceLocatorKey(resourcePlacement.entity.locator)}:${resourcePlacement.point.x}:${resourcePlacement.point.y}` : "";
    const currentSelection = selectedIds(api.getAppState?.()).sort().join("\0");
    const desiredSelection = [...state.selection].sort().join("\0");
    const sceneChanged = appliedProjectionRef.current !== projectionFingerprint;
    const placementChanged = resourcePlacementProjectionRef.current !== placementProjection;
    if (!sceneChanged && !placementChanged && currentSelection === desiredSelection) return;
    if (sceneChanged) api.addFiles?.(Object.values(state.scene.files ?? {}));
    resourcePlacementProjectionRef.current = placementProjection;
    deferCanvasUpdate({ ...((sceneChanged || placementChanged) ? { elements: [...state.scene.elements, ...placementElements] } : {}), appState: { selectedElementIds: elementSelection }, captureUpdate: "NEVER" }, placementChanged ? "resource-placement-preview" : "projection");
    if (sceneChanged) api.history?.clear?.();
    if (initializingRef.current) requestAnimationFrame(() => requestAnimationFrame(() => {
      fingerprintRef.current = boardCore.authoredFingerprint(api.getSceneElements?.() ?? state.scene.elements);
      initializingRef.current = false;
    }));
  }, [api, resourcePlacement, state.revision]);

  /** Selects a structural region after its HTML label takes browser focus. */
  function selectArea(area) {
    if (resourceLocate) setResourceLocate(null);
    const element = controller.selectArea(area);
    if (!element) return null;
    stableSelectionRef.current = new Set([element.id]);
    programmaticSelectionRef.current = new Set([element.id]);
    requestAnimationFrame(() => projectCanvas({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: "NEVER" }, "area-selection"));
    return element;
  }

  /** Reconciles controller-owned camera state after an Excalidraw API fit. */
  function syncCameraFromCanvas() {
    const appState = api?.getAppState?.();
    if (!appState) return;
    controller.setCamera({ scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom?.value ?? appState.zoom });
  }

  /** Scrolls Excalidraw and keeps semantic overlays on the same live camera. */
  function scrollCanvasTo(elements, settings) {
    if (!api || !elements?.length) return false;
    api.scrollToContent(elements, settings);
    syncCameraFromCanvas();
    requestAnimationFrame(syncCameraFromCanvas);
    return true;
  }

  /** Scrolls to one target chosen by camera history. */
  function scrollToArea(area, { push = true, select = true } = {}) {
    const element = controller.navigateArea(area, { push, select });
    if (!element || !api) return null;
    if (select) {
      programmaticSelectionRef.current = new Set([element.id]);
      projectCanvas({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: "NEVER" }, "camera-selection");
    }
    scrollCanvasTo([element], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    announce(`${leaf(area)} in view`);
    return element;
  }

  /** Returns the selected Area region, or the current located Area. */
  function restrictionTarget() {
    const ids = selectedIds(api?.getAppState?.());
    return state.composition.scene.elements.find((element) => ids.includes(element.id) && element.customData?.tangent?.role === "area-region")?.customData?.tangent?.area ?? state.locatedArea;
  }

  /** Toggles the temporary ancestor-and-descendant restriction. */
  function toggleRestriction(area = restrictionTarget()) {
    const result = controller.toggleRestriction(area);
    if (result.active && result.element && api) scrollCanvasTo([result.element], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    announce(result.active ? `Only ${areaName(result.area)}, ${result.excludedCount} Areas hidden` : "Whole map");
    return result;
  }

  /** Captures controller-owned view state with Excalidraw's latest live camera. */
  function captureLiveView() {
    const view = controller.captureView();
    const appState = api?.getAppState?.() ?? {};
    return {
      ...view,
      camera: {
        scrollX: Number(appState.scrollX ?? view.camera.scrollX),
        scrollY: Number(appState.scrollY ?? view.camera.scrollY),
        zoom: Number(appState.zoom?.value ?? appState.zoom ?? view.camera.zoom) || 1,
      },
    };
  }

  /** Opens map find and records the camera and selection restored by Cancel. */
  function openFind() {
    if (!findOpen) findOriginRef.current = captureLiveView();
    setFindOpen(true); setFindKept(true);
    requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select(); });
    return true;
  }

  /** Returns fresh Area and loaded-block matches for one query. */
  function matchesFor(query) {
    const visibleAreas = new Set(state.scene.elements
      .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
      .map((element) => element.customData.tangent.area));
    return mapFindMatches({
      areas: state.world.areas.filter((node) => visibleAreas.has(node.key)).map((node) => ({ path: node.key, name: areaName(node.key), depth: node.depth })),
      blocks: state.scene.elements.flatMap((element) => {
        if (element.isDeleted) return [];
        const tangent = boardCore.tangentOf(element);
        if (!tangent || tangent.role === "area-region" || tangent.role === "boundary") return [];
        const entity = resolvedBlock(element);
        if (!entity) return [];
        const area = element.customData?.tangentWorld?.owner || boardCore.areaForBlock(element, documents);
        return visibleAreas.has(area) ? [{ kind: tangent.kind, elementId: element.id, name: entity.searchText, displayName: entity.display.label, area, hidden: false }] : [];
      }),
    }, query).map((row) => row.displayName ? { ...row, name: row.displayName } : row);
  }

  /** Previews one find row without adding a camera-history step. */
  function previewFind(row, { say = true } = {}) {
    if (!row || !api) return false;
    const element = row.kind === "area"
      ? controller.selectArea(row.area)
      : state.composition.scene.elements.find((candidate) => candidate.id === row.elementId);
    if (!element) return false;
    if (row.kind !== "area") { controller.setFindReveal(element.id); controller.setSelection([element.id]); }
    scrollCanvasTo([element], { fitToContent: true, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    if (say) announce(`${matchesFor(findQuery).length} matches, ${row.name} in view`, { visible: false });
    return true;
  }

  /** Applies a typed pattern and previews its first result. */
  function applyFindQuery(query) {
    setFindQuery(query); setFindIndex(0);
    const rows = matchesFor(query);
    if (!rows.length) { setFindKept(false); controller.setFindReveal(null); if (query.trim()) announce("No match", { visible: false }); return; }
    setFindKept(true);
    previewFind(rows[0], { say: false });
    announce(`${rows.length} ${rows.length === 1 ? "match" : "matches"}, ${rows[0].name} in view`, { visible: false });
  }

  /** Steps through the current find rows with wrap. */
  function stepFind(direction) {
    const rows = matchesFor(findQuery);
    if (!rows.length) { if (findQuery.trim()) announce("No match", { visible: false }); return false; }
    const index = (findIndex + direction + rows.length) % rows.length;
    setFindIndex(index); setFindKept(true); previewFind(rows[index], { say: false });
    announce(`${index + 1} of ${rows.length}, ${rows[index].name} in view`, { visible: false });
    return true;
  }

  /** Keeps the current match and adds one normal camera return step. */
  function confirmFind() {
    const rows = matchesFor(findQuery); const row = rows[findIndex];
    if (!row) return false;
    if (resourceLocate) setResourceLocate(null);
    const element = controller.fitArea(row.area, { push: true, select: row.kind === "area" });
    if (row.kind === "area") controller.setFindReveal(null);
    else { controller.setFindReveal(row.elementId); controller.setSelection([row.elementId]); }
    const target = row.kind === "area" ? element : state.composition.scene.elements.find((candidate) => candidate.id === row.elementId);
    if (target && api) scrollCanvasTo([target], { fitToContent: true, animate: false });
    setFindOpen(false); setFindKept(true); findOriginRef.current = null;
    return true;
  }

  /** Cancels find and restores its exact opening camera target and selection. */
  function cancelFind() {
    const origin = findOriginRef.current;
    setFindOpen(false); setFindKept(false); findOriginRef.current = null;
    if (!origin) return;
    const restored = controller.restoreView(origin);
    projectCanvas({
      appState: {
        scrollX: restored.camera.scrollX,
        scrollY: restored.camera.scrollY,
        zoom: { value: restored.camera.zoom },
        selectedElementIds: Object.fromEntries([...restored.selection].map((id) => [id, true])),
      },
      captureUpdate: "NEVER",
    }, "find-cancel");
  }

  /** Returns the last scene point, or the current viewport center. */
  function placementPoint() {
    return boardCore.insertionPoint(api?.getAppState?.() ?? {}, lastPointerRef.current);
  }

  /** Opens the contextual block picker for the deepest Area under the pointer. */
  function openPicker() {
    const point = placementPoint();
    const area = areaAtPoint(state.composition, point, state.locatedArea, state.scopedAreas);
    const center = boardCore.insertionPoint(api?.getAppState?.() ?? {}, null);
    setWidePicker(false); setPickerQuery("");
    setPicker({ area, point, outside: ![...state.composition.regionRects.values()].some((box) => point.x >= box.x && point.y >= box.y && point.x <= box.x + box.width && point.y <= box.y + box.height), dock: point.x < center.x ? "right" : "left" });
    void loadResources(area);
  }

  /** Places one new source-owned Tangent block without changing the camera. */
  function placeBlock(choice, keepOpen = false, target = picker) {
    if (!choice) return;
    if (choice.resourceRow) { placeResourceOnMap(choice.resourceRow); return; }
    const area = choice.owner ?? target?.area ?? state.locatedArea;
    if (choice.kind === "area" && state.world.areas.some((node) => node.key === choice.area)) {
      selectArea(choice.area); setPicker(keepOpen ? target : null); setPickerQuery(""); return;
    }
    const point = target?.point ?? placementPoint();
    const id = crypto.randomUUID();
    const canonical = controller.snapshot().composition.scene;
    const occupied = canonical.elements.filter((element) => !element.isDeleted
      && !ephemeral(element)
      && element.customData?.tangentWorld?.owner === area);
    const { scene: next, root: block } = worldCore.placeBlockAtNearestFreePoint(canonical, choice, point, id, { occupied });
    const added = next.elements.slice(canonical.elements.length);
    for (const element of added) {
      element.customData = { ...(element.customData ?? {}), tangentWorld: { owner: area } };
    }
    publish(next.elements, api?.getAppState?.() ?? {});
    const runtime = worldCore.runtimeId(area, id);
    controller.setSelection([runtime]); programmaticSelectionRef.current = new Set([runtime]);
    const runtimeLabel = worldCore.runtimeId(area, `${id}-tangent-label`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const snapshot = controller.snapshot();
      const label = snapshot.composition.scene.elements.find((element) => element.id === runtimeLabel && element.type === "text");
      if (!label || keepOpen || choice.kind === "resource") {
        projectCanvas({ appState: { selectedElementIds: { [runtime]: true } }, captureUpdate: "NEVER" }, "placed-block-selection");
        return;
      }
      projectCanvas({
        elements: snapshot.scene.elements,
        appState: { selectedElementIds: { [runtime]: true } },
        captureUpdate: "NEVER",
      }, "placed-block-selection");
      requestAnimationFrame(() => {
        const appState = api?.getAppState?.() ?? {};
        const zoom = Number(appState.zoom?.value ?? 1) || 1;
        const canvas = host.querySelector(".excalidraw canvas.interactive");
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const clientX = Number(appState.offsetLeft ?? rect.left) + (label.x + label.width / 2 + Number(appState.scrollX ?? 0)) * zoom;
        const clientY = Number(appState.offsetTop ?? rect.top) + (label.y + label.height / 2 + Number(appState.scrollY ?? 0)) * zoom;
        placedBlockEditEventRef.current = true;
        canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, button: 0, detail: 2, view: window }));
        placedBlockEditEventRef.current = false;
        requestAnimationFrame(() => host.querySelector('textarea[data-type="wysiwyg"]')?.focus({ preventScroll: true }));
      });
    }));
    setPicker(keepOpen ? target : null); setPickerQuery("");
  }

  /** Runs one visible Map recovery choice and announces its truthful outcome. */
  async function recoverMap(action) {
    const origin = document.activeElement;
    try {
      const result = await controller[action]();
      const next = controller.snapshot().save.state;
      if (action === "keepMine" && !result) announce("Keep mine is unavailable. Retry or reload saved.");
      else if (action === "keepMine" && next === "blocked") announce("Local draft kept. Retry or reload saved.");
      else if (action === "keepMine" && next === "conflict") announce("Map not saved. Keep mine found another conflict.");
      else if (action === "keepMine" && next === "saved") announce("Map saved with local changes.");
      else if (action === "reload") announce("Saved map reloaded.");
      return result;
    } catch (error) {
      announce(`Map not saved. ${String(error?.message ?? error)}`);
      return null;
    } finally {
      requestAnimationFrame(() => {
        if (!origin?.isConnected) host.querySelector(".excalidraw")?.focus?.({ preventScroll: true });
      });
    }
  }

  /** Closes Map help and returns keyboard ownership to the retained canvas. */
  function closeHelp() {
    setHelpOpen(false);
    requestAnimationFrame(() => host.querySelector(".excalidraw")?.focus?.({ preventScroll: true }));
  }

  /** Runs one selected semantic Block through the shared typed dispatcher. */
  function openBlock(block, verb = "open", opener = document.activeElement) {
    const entity = resolvedBlock(block);
    const action = verb === "read" ? entity?.readAction : entity?.primaryAction;
    if (entity && action) void dispatchMapEntity(entity, action, opener);
  }

  /** Removes one block and its cached label from its existing owner. */
  function hideBlock(block) {
    if (!block) return;
    if (resourceLocate) setResourceLocate(null);
    const next = clone(controller.snapshot().composition.scene);
    const ids = new Set([block.id, ...(block.boundElements ?? []).filter((binding) => binding.type === "text").map((binding) => binding.id)]);
    for (const element of next.elements) if (ids.has(element.id)) element.isDeleted = true;
    publish(next.elements, api?.getAppState?.() ?? {}); controller.setSelection([]); programmaticSelectionRef.current = null;
  }

  /** Opens one non-pointer command and keeps later callbacks inside it. */
  function beginNonPointer(kind = "edit") {
    if (pointerBaselineRef.current) return;
    if (!nonPointerKindRef.current) {
      nonPointerBaselineRef.current = controller.beginGesture(kind);
      nonPointerKindRef.current = kind;
    }
  }

  /** Closes the active non-pointer command exactly once. */
  function finishNonPointer() {
    nonPointerSettleRef.current += 1;
    if (!nonPointerKindRef.current) return;
    const kind = nonPointerKindRef.current; nonPointerKindRef.current = null;
    controller.endGesture(kind); nonPointerBaselineRef.current = null;
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

  /** Publishes Excalidraw's buffered text after its editor consumes a finish key. */
  function finishBufferedTextEdit() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!textEditRef.current) return;
      const appState = api?.getAppState?.() ?? {};
      handleCanvasChange(api?.getSceneElements?.() ?? textEditRef.current.elements, { ...appState, editingTextElement: null });
    }));
  }

  /** Captures one immutable pointer baseline before Excalidraw changes selection. */
  function beginPointerGesture(origin, pointerDownState = { origin }, tool = null) {
    if (pointerBaselineRef.current) return;
    if (resourceLocate) setResourceLocate(null);
    if (textEditRef.current && api?.getAppState?.().editingTextElement) return;
    cancelDeferredCanvasUpdate();
    clearStaleEditingText(undefined, { force: true });
    finishNonPointer(); pointerSettlingRef.current = false; programmaticSelectionRef.current = null;
    claimedRuntimeIdsRef.current = new Map();
    claimedOriginsRef.current = new Map();
    outlineProtectionAnnouncedRef.current = false;
    pointerBaselineRef.current = controller.beginGesture("pointer");
    pointerSolverBaselineRef.current = solverBaseline(pointerBaselineRef.current);
    pointerCompositionRef.current = worldCore.composeAreaMapWorld(pointerBaselineRef.current);
    const pointerCommand = areaMapPointerCommand(pointerDownState);
    const structuralTool = tool?.type === "selection";
    pointerStateRef.current = { ...pointerDownState, origin, command: pointerCommand }; pointerCurrentRef.current = origin;
    const liveSelection = controller.snapshot().selection;
    stableSelectionRef.current = new Set(liveSelection);
    const zoom = api?.getAppState?.().zoom?.value ?? 1;
    const additive = Boolean(pointerDownState.shiftKey || pointerDownState.withCmdOrCtrl);
    const baselineElements = new Map(pointerCompositionRef.current.scene.elements.map((element) => [element.id, element]));
    const spatialAuthoredHit = [...pointerCompositionRef.current.scene.elements].reverse().find((element) => element.customData?.tangent?.role !== "area-region" && !ephemeral(element) && pointerHits(element, origin, zoom));
    const rawHitElement = additive ? spatialAuthoredHit : null;
    const boundContainer = rawHitElement?.containerId ? baselineElements.get(rawHitElement.containerId) : null;
    const hitElement = boundContainer && boardCore.tangentOf(boundContainer) ? boundContainer : rawHitElement;
    if (hitElement) {
      const nextSelection = new Set([...stableSelectionRef.current, hitElement.id]);
      stableSelectionRef.current = nextSelection; additiveSelectionRef.current = nextSelection;
      controller.setSelection(nextSelection); programmaticSelectionRef.current = nextSelection;
      projectCanvas({ appState: { selectedElementIds: Object.fromEntries([...nextSelection].map((id) => [id, true])) }, captureUpdate: "NEVER" }, "additive-pointer-selection");
    }
    const deepest = areaAtPoint(pointerCompositionRef.current, origin, null, state.scopedAreas);
    const hitRegionElement = structuralTool && !additive && !spatialAuthoredHit && deepest
      ? pointerCompositionRef.current.scene.elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === deepest)
      : null;
    if (hitRegionElement && !stableSelectionRef.current.has(hitRegionElement.id)) {
      const nextSelection = new Set([hitRegionElement.id]);
      stableSelectionRef.current = nextSelection; additiveSelectionRef.current = null;
      controller.setSelection(nextSelection); programmaticSelectionRef.current = nextSelection;
      projectCanvas({ appState: { selectedElementIds: { [hitRegionElement.id]: true } }, captureUpdate: "NEVER" }, "pointer-down-selection");
    }
    const selectedElements = structuralTool
      ? pointerCompositionRef.current.scene.elements.filter((element) => stableSelectionRef.current.has(element.id))
      : [];
    const hitBlock = selectedElements.some((element) => element.customData?.tangent?.role !== "area-region" && pointerHits(element, origin, zoom));
    const selectedRegion = selectedElements.find((element) => element.customData?.tangent?.role === "area-region");
    const hitRegion = Boolean(selectedRegion) && (pointerCommand.kind === "resize"
      || selectedRegion.customData.tangent.area === deepest && pointerHits(selectedRegion, origin, zoom));
    const rejectedAreaTransform = structuralTool && Boolean(selectedRegion) && pointerCommand.kind === "ignore";
    pointerStateRef.current = { ...pointerStateRef.current, rejectedAreaTransform };
    pointerSelectedRef.current = !rejectedAreaTransform && (hitBlock || hitRegion) ? new Set(stableSelectionRef.current) : new Set();
    pointerHandleRef.current = selectedRegion && pointerCommand.kind === "resize" ? pointerCommand.handle : null;
    if (rejectedAreaTransform) {
      announce("Area outlines cannot rotate");
      projectCanvas({ elements: controller.snapshot().scene.elements, captureUpdate: "NEVER" }, "area-transform-rejected");
    }
    controller.recordEvent("area_map_pointer_down", {
      gestureKind: pointerCommand.kind === "resize" ? "region-resize" : pointerCommand.kind === "move" ? "region-move" : "selection",
      selectedCount: pointerSelectedRef.current.size,
      depth: deepest ? deepest.split("/").length : 0,
    });
  }

  /** Solves one region preview from the pointer-down world, independent of canvas hit mode. */
  function previewPointerGesture(pointer) {
    pointerCurrentRef.current = pointer; lastPointerRef.current = pointer;
    const baselineWorld = pointerBaselineRef.current; const baselineComposition = pointerCompositionRef.current;
    const solver = pointerSolverBaselineRef.current;
    if (!baselineWorld || !baselineComposition || !solver || !pointerStateRef.current) return;
    const selected = new Set([...pointerSelectedRef.current].map((id) => baselineComposition.scene.elements.find((element) => element.id === id)?.customData?.tangent?.area).filter(Boolean));
    for (const area of [...selected]) for (const ancestor of selected) if (area !== ancestor && area.startsWith(`${ancestor}/`)) selected.delete(area);
    if (!selected.size) return;
    const solveStarted = performance.now();
    const preview = worldCore.solveAreaMapGesture(solver, {
      selectedAreas: [...selected], handle: pointerHandleRef.current,
      desiredWorldDelta: { x: pointer.x - pointerStateRef.current.origin.x, y: pointer.y - pointerStateRef.current.origin.y },
    });
    const depth = Math.max(...[...selected].map((value) => value.split("/").length));
    const gestureKind = pointerHandleRef.current ? "region-resize" : "region-move";
    controller.recordEvent("area_map_gesture_solved", { gestureKind, depth, previewCount: selected.size, maximumTime: performance.now() - solveStarted });
    if (!preview.valid) controller.recordEvent("area_map_invariant_failed", { gestureKind, invariantName: "finite-containment", affectedCount: selected.size, depth });
    const changedAreas = new Set([...selected, ...(preview.changedAreas ?? [])]);
    const nextWorld = controller.world();
    for (const area of changedAreas) {
      const node = nextWorld.areas.find((entry) => entry.key === area); const solved = preview.regions.get(area);
      if (node && solved) { node.region = clone(solved); node.region.source = "stored"; }
    }
    controller.preview(nextWorld, { changedAreas });
    const snapshot = controller.snapshot();
    projectCanvas({ elements: snapshot.scene.elements, captureUpdate: "NEVER" }, "area-pointer-preview");
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
    pointerBaselineRef.current = null; pointerSolverBaselineRef.current = null; pointerCompositionRef.current = null; pointerStateRef.current = null; pointerCurrentRef.current = null; pointerHandleRef.current = null;
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
      outlineProtectionAnnouncedRef.current = false;
    }
    const baselineWorld = pointerBaselineRef.current ?? nonPointerBaselineRef.current ?? controller.world();
    const baselineComposition = pointerCompositionRef.current ?? worldCore.composeAreaMapWorld(baselineWorld);
    let preparedSolverBaseline = pointerSolverBaselineRef.current;
    /** Returns one pointer-stable or command-local solver baseline. */
    const getSolverBaseline = () => preparedSolverBaseline ??= solverBaseline(baselineWorld);
    const nextWorld = pointerBaselineRef.current ? controller.world() : clone(baselineWorld);
    const changedAreas = new Set(); const changedOwners = new Set(); const directlyChangedAreas = new Set();
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
      for (const area of selected) directlyChangedAreas.add(area);
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
      const preview = worldCore.solveAreaMapGesture(getSolverBaseline(), { selectedAreas: [...selected], handle: handle || null, desiredWorldDelta });
      const depth = Math.max(...[...selected].map((value) => value.split("/").length));
      const gestureKind = handle ? "region-resize" : "region-move";
      controller.recordEvent("area_map_gesture_solved", { gestureKind, depth, previewCount: selected.size, maximumTime: performance.now() - solveStarted });
      if (!preview.valid) controller.recordEvent("area_map_invariant_failed", { gestureKind, invariantName: "finite-containment", affectedCount: selected.size, depth });
      for (const changedArea of new Set([...selected, ...(preview.changedAreas ?? [])])) {
        const node = nextWorld.areas.find((entry) => entry.key === changedArea);
        const solved = preview.regions.get(changedArea);
        if (!node || !solved) continue;
        node.region = clone(solved); node.region.source = "stored"; changedAreas.add(changedArea);
      }
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
    const pointer = pastePlacement?.point ?? textPlacementRef.current ?? pointerStateRef.current?.origin;
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
      claim(element, ownerForNewAreaMapElement({ copiedOwner, pasteOwner: pastePlacement?.area, pointOwner: areaAtPoint(baselineComposition, point, state.locatedArea, state.scopedAreas) }));
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
        claim(element, ownerForNewAreaMapElement({ copiedOwner, pasteOwner: pastePlacement?.area, startOwner: start?.owner, pointOwner: areaAtPoint(baselineComposition, point, state.locatedArea, state.scopedAreas) }));
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
    textPlacementRef.current = null;
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
      const solved = worldCore.solveOwnedElementGesture(getSolverBaseline(), {
        owner, kind: "block", rect: group, remainingBlockHull,
        desiredWorldDelta: { x: first.x - firstOriginal.x - motion.x, y: first.y - firstOriginal.y - motion.y },
      });
      const depth = owner.split("/").length;
      controller.recordEvent("area_map_gesture_solved", { gestureKind: "block-move", depth, previewCount: blocks.length, maximumTime: performance.now() - solveStarted });
      if (!solved.valid) controller.recordEvent("area_map_invariant_failed", { gestureKind: "block-move", invariantName: "owned-block-containment", affectedCount: 1, depth });
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
    }
    worldCore.detachCrossOwnerTextBindings(completeRuntime, origins);
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
    const baselinePlacementPriority = baselineWorld.areas.reduce((maximum, entry) => {
      const value = entry.region.layout?.priority;
      return Number.isSafeInteger(value) && value >= 0 ? Math.max(maximum, value) : maximum;
    }, 0);
    const nextPlacementPriority = Math.min(Number.MAX_SAFE_INTEGER, baselinePlacementPriority + 1);
    for (const owner of changedOwners) {
      const node = nextWorld.areas.find((entry) => entry.key === owner);
      const baselineNode = baselineWorld.areas.find((entry) => entry.key === owner);
      if (!node || !baselineNode) continue;
      const baselineHull = baselineNode.shard.scene
        ? worldCore.shardHulls(baselineNode.shard.scene).blocks
        : baselineNode.shard.ownBlockHull ?? null;
      if (!areaMapStructuralHullChanged(baselineHull, node.shard.ownBlockHull)) continue;
      // A lower-priority branch can be drawn away from its old authored
      // rectangle. Absorb that resolved anchor before its content raises the
      // branch priority, or the Area and edited block jump back to the old one.
      const resolvedAnchor = directlyChangedAreas.has(owner)
        ? node.region.storedRect
        : baselineComposition.geometry.get(owner)?.resolvedStored;
      node.region = worldCore.reprioritizeAreaPlacement(node.region, resolvedAnchor, nextPlacementPriority);
      changedAreas.add(owner);
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

  /** Closes one Map-local layer before asking the shell for the retained opener. */
  function escape() {
    if (resourceSceneRecovery) { closeResourceSceneRecovery(); return { kind: "resource-scene-recovery" }; }
    if (resourceRecovery) { closeResourceRecovery(); return { kind: "resource-recovery" }; }
    if (resourcesOpen) { closeResources(); return { kind: "resources" }; }
    if (findOpen) { cancelFind(); return { kind: "find" }; }
    if (picker) { setPicker(null); setPickerQuery(""); return { kind: "picker" }; }
    if (helpOpen) { closeHelp(); return { kind: "help" }; }
    if (outlineOpen) { setOutlineOpen(false); return { kind: "outline" }; }
    if (resourceLocate) { restoreResourceLocate(); return { kind: "resource-locate" }; }
    options.onBack?.();
    return { kind: "back" };
  }

  /** Handles the map keys before Excalidraw or the shell can reinterpret them. */
  useEffect(() => {
    if (!api) return undefined;
    /** Routes one host key through map-owned command boundaries. */
    const keydown = (event) => {
      if (event.isComposing) return;
      if (resourcePlacement) {
        if (event.key === "Escape") { stop(event); cancelResourcePlacement(); return; }
        if (event.key === "Enter") { stop(event); commitResourcePlacement(); return; }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          stop(event);
          const distance = event.shiftKey ? 1 : 16;
          setResourcePlacement((current) => current ? { ...current, point: boundedResourcePlacementPoint(current, {
            x: current.point.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0),
            y: current.point.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0),
          }) } : current);
        }
        return;
      }
      if (event.key === "Escape" && (resourceSceneRecovery || resourceRecovery || resourcesOpen)) { stop(event); escape(); return; }
      if (resourceSceneRecovery || resourceRecovery || resourceSceneBusy || resourcesOpen) return;
      const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
      if (findKey || !findOpen && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "/") { stop(event); openFind(); return; }
      if (event.key === "Escape" && (findOpen || picker || helpOpen || outlineOpen)) { stop(event); escape(); return; }
      if (findOpen) return;
      if (event.target.closest?.(".tangent-map-outline")) return;
      const appState = api.getAppState?.();
      if (textEditRef.current && appState?.editingTextElement) {
        if (event.key === "Escape" || (event.metaKey || event.ctrlKey) && event.key === "Enter") finishBufferedTextEdit();
        return;
      }
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
        stop(event); if (resourceLocate) setResourceLocate(null); if (event.shiftKey) controller.redo(); else controller.undo(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        pointerSettlingRef.current = false;
        actionKindRef.current = "duplicate";
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") { stop(event); setOutlineOpen((value) => !value); return; }
      const ids = selectedIds(api.getAppState?.());
      const selected = state.composition.scene.elements.filter((element) => ids.includes(element.id));
      const region = selected.find((element) => element.customData?.tangent?.role === "area-region");
      const block = selectedMapEntityElement(state.composition.scene.elements, ids);
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
      if (block && ["o", "x"].includes(event.key.toLowerCase())) {
        stop(event);
        if (event.key.toLowerCase() === "x") hideBlock(block);
        else openBlock(block, "read");
        return;
      }
      if ((event.key === " " || event.code === "Space") && region) {
        stop(event); changeFold(region.customData.tangent.area);
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === "o" && !block) {
        stop(event); toggleRestriction(region?.customData?.tangent?.area ?? state.locatedArea); return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && findQuery && ["n", "N"].includes(event.key)) {
        stop(event); stepFind(event.key === "n" ? 1 : -1); return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "b") { stop(event); openPicker(); }
    };
    /** Opens only when the canvas double click lands on the one selected semantic Block. */
    const doubleClick = (event) => {
      if (placedBlockEditEventRef.current) return;
      const ids = selectedIds(api.getAppState?.());
      const block = selectedMapEntityElement(state.composition.scene.elements, ids);
      const canvas = event.target instanceof Element ? event.target.closest(".excalidraw canvas.interactive") : null;
      const appState = api.getAppState?.();
      const point = eventScenePoint(event, appState, canvas);
      if (block && canvas && pointerHits(block, point, appState?.zoom?.value ?? appState?.zoom ?? 1)) { stop(event); openBlock(block, "open", canvas); }
    };
    host.addEventListener("keydown", keydown, true);
    host.addEventListener("dblclick", doubleClick, true);
    return () => { host.removeEventListener("keydown", keydown, true); host.removeEventListener("dblclick", doubleClick, true); };
  }, [api, findOpen, findQuery, findIndex, picker, helpOpen, outlineOpen, resourcesOpen, resourceLocate, resourcePlacement, resourceRecovery, resourceResolutions, state.revision]);

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
    bridge.setSaveState = null;
    bridge.current = () => controller.snapshot().composition.scene;
    bridge.rendered = () => api?.getSceneElements?.() ?? null;
    bridge.appState = () => api?.getAppState?.() ?? null;
    bridge.fitArea = (area, settings) => scrollToArea(area, settings);
    bridge.selectArea = (area) => selectArea(area);
    bridge.captureView = captureLiveView;
    bridge.restoreView = (value) => {
      const restored = controller.restoreView(value);
      projectCanvas({
        appState: {
          scrollX: restored.camera.scrollX,
          scrollY: restored.camera.scrollY,
          zoom: { value: restored.camera.zoom },
          selectedElementIds: Object.fromEntries([...restored.selection].map((id) => [id, true])),
        },
        captureUpdate: "NEVER",
      }, "view-return");
      return restored;
    };
    bridge.focus = () => {
      const target = host.querySelector(".excalidraw [tabindex='0'], .excalidraw canvas, .excalidraw");
      target?.focus?.({ preventScroll: true });
      return Boolean(target);
    };
    bridge.flush = async () => {
      if (pointerBaselineRef.current && pointerSettlingRef.current) {
        pointerSettleTokenRef.current += 1;
        settlePointerCommand();
      }
      await waitForPointerSettle();
      return controller.flush();
    };
    bridge.refreshFacts = (documentsOrFocus, maybeFocus) => controller.refreshFacts(maybeFocus ?? (Array.isArray(documentsOrFocus) ? controller.snapshot().focus : documentsOrFocus));
    bridge.setFocus = (focus) => controller.setFocus(focus);
    bridge.reload = () => controller.reload();
    bridge.keepMine = () => controller.keepMine();
    bridge.controller = controller;
    const initial = controller.snapshot();
    if (api && !initial.viewRestored) {
      const element = controller.fitArea(initial.locatedArea, { push: false, select: false });
      if (element) requestAnimationFrame(() => requestAnimationFrame(() => scrollCanvasTo([element], { fitToContent: true, animate: false })));
    }
    return () => { bridge.controller = null; bridge.rendered = () => null; bridge.captureView = () => null; bridge.restoreView = () => null; bridge.focus = () => false; };
  }, [api]);

  useEffect(() => () => {
    nonPointerSettleRef.current += 1; finishNonPointer();
    pointerSettleTokenRef.current += 1;
    if (pointerBaselineRef.current) settlePointerCommand();
    else resolvePointerSettleWaiters();
    if (pasteTimerRef.current !== null) clearTimeout(pasteTimerRef.current);
    if (ownsControllerRef.current) {
      void Promise.resolve(controller.flush()).catch(() => null).finally(() => controller.destroy());
    }
  }, [controller]);

  useEffect(() => {
    if (!picker || !widePicker || !options.searchDocuments) return undefined;
    const request = new AbortController();
    let current = true;
    void options.searchDocuments(pickerQuery, { signal: request.signal }).then((rows) => {
      if (current) setPickerEntities(rows ?? []);
    }, (error) => {
      if (current && error?.name !== "AbortError") announce("Vault search is unavailable; showing known Map entities", { visible: false });
    });
    return () => { current = false; request.abort(); };
  }, [picker, widePicker, pickerQuery, options.searchDocuments]);

  const visibleNodes = state.world.areas.filter((node) => state.scopedAreas.has(node.key) && ![...state.folded].some((root) => node.key.startsWith(`${root}/`)));
  const documents = [...new Map([...pickerEntities, ...options.getDocuments()].filter((item) => item?.file).map((item) => [item.file, item])).values()];
  const areaRecords = new Map(documents.filter((item) => item.kind === "area" && item.area).map((item) => [item.area, item]));
  const areaTitles = new Map([...areaRecords].map(([area, item]) => [area, item.title]));
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
    const foldState = state.folded.has(node.key) ? "folded" : "unfolded";
    const runtime = areaRuntimeAnnotations(areaRecords.get(node.key));
    const runtimeWords = [...runtime.facts.map((fact) => fact.label), ...(runtime.ready ? ["Ready"] : []), ...(runtime.stale ? ["last known facts"] : [])];
    return `${areaName(node.key)}, child of ${parent}, depth ${node.depth + 1}, ${foldState}, ${node.shard.state}, ${count} ${count === 1 ? "block" : "blocks"}${runtimeWords.length ? `, ${runtimeWords.join(", ")}` : ""}`;
  };
  const targetArea = picker?.area ?? state.locatedArea;
  const resourceRows = resourceProjection?.rows ?? [];
  const resourceChoices = resourceRows.flatMap((row) => {
    const entity = resourceEntityForRow(row); if (!entity || entity.reason) return [];
    const resolution = resourceResolutions.get(resourceLocatorKey(entity.locator)) ?? resourceResolutionForRow(row);
    const facts = resolveMapEntity({ source: { owner: entity.locator.owner, sourceId: entity.locator.id }, tangent: { kind: "resource", ref: entity.locator.id }, resource: resolution });
    if (!facts) return [];
    const representation = representationForRow(row);
    return [{
      kind: "resource", ref: entity.locator.id, owner: entity.locator.owner,
      title: facts.display.label, status: [...facts.display.stateText, representation === "on-map" ? "On Map" : representation === "hidden" ? "Hidden" : representation === "never-placed" ? "Never placed" : "Map unavailable"].join(" · "),
      accessibleName: `${facts.accessibleName}. ${representation === "on-map" ? "On Map" : representation === "hidden" ? "Hidden" : representation === "never-placed" ? "Never placed" : "Map unavailable"}.`,
      resourceRow: row,
    }];
  });
  const contextualChoices = [...resourceChoices, ...boardCore.entityChoices(targetArea, documents)];
  const choiceSource = widePicker ? pickerModel.wideChoices(pickerQuery, documents) : contextualChoices;
  const needle = pickerQuery.trim().toLowerCase();
  const matchingChoices = widePicker || !needle ? choiceSource : choiceSource.filter((choice) => `${choice.kind} ${choice.title} ${choice.ref}`.toLowerCase().includes(needle));
  const typedChoice = boardCore.referenceFromText(pickerQuery, [...contextualChoices, ...pickerModel.wideChoices("", documents)]);
  const pickerChoices = typedChoice && !matchingChoices.some((choice) => choice.ref === typedChoice.ref) ? [typedChoice, ...matchingChoices] : matchingChoices;
  const findRows = matchesFor(findQuery);
  const activeFindIndex = Math.min(findIndex, Math.max(0, findRows.length - 1));
  const activeFindRow = findOpen || findKept ? findRows[activeFindIndex] ?? null : null;
  const findWindowStart = Math.min(Math.max(0, activeFindIndex - 7), Math.max(0, findRows.length - 8));
  const visibleFindRows = findRows.slice(findWindowStart, findWindowStart + 8);
  const currentBlock = selectedMapEntityElement(state.composition.scene.elements, state.selection);
  const currentEntity = currentBlock ? resolvedBlock(currentBlock) : null;
  const currentBlockTarget = currentEntity?.display.label || "Tangent block";
  const currentBlockAccessible = currentEntity?.reference.kind === "resource" ? currentEntity.accessibleName : currentBlockTarget;
  const filteredResourceRows = resourceRows.filter((row) => {
    const entity = resourceEntityForRow(row); const needle = resourceFilter.trim().toLowerCase();
    if (!needle || !entity) return true;
    const resolution = resourceResolutions.get(resourceLocatorKey(entity.locator)) ?? resourceResolutionForRow(row);
    const facts = resolveMapEntity({ source: { owner: entity.locator.owner, sourceId: entity.locator.id }, tangent: { kind: "resource", ref: entity.locator.id }, resource: resolution });
    return facts?.searchText.toLowerCase().includes(needle);
  });
  const resourceGroups = [
    { key: "local", label: "Worktrees and repositories", rows: filteredResourceRows.filter((row) => row.relation?.kind !== "inherited" && !resourceEntityForRow(row)?.reason && resourceEntityForRow(row)?.target?.kind !== "link") },
    { key: "links", label: "Links", rows: filteredResourceRows.filter((row) => row.relation?.kind !== "inherited" && !resourceEntityForRow(row)?.reason && resourceEntityForRow(row)?.target?.kind === "link") },
    { key: "removed", label: "Removed from Area", rows: filteredResourceRows.filter((row) => row.relation?.kind !== "inherited" && resourceEntityForRow(row)?.reason) },
    { key: "inherited", label: "From ancestor Areas", rows: filteredResourceRows.filter((row) => row.relation?.kind === "inherited") },
  ].map((group) => ({ ...group, rows: sortPanelResourceRows(group.rows) })).filter((group) => group.rows.length);
  const resourceDetailsRow = resourceDetails
    ? resourceRows.find((row) => resourceLocatorKey(resourceEntityForRow(row)?.locator) === resourceLocatorKey(resourceDetails)) ?? null
    : null;
  const resourceDetailsEntity = resourceDetailsRow ? resourceEntityForRow(resourceDetailsRow) : null;
  const resourceDetailsResolution = resourceDetailsEntity ? resourceResolutions.get(resourceLocatorKey(resourceDetailsEntity.locator)) ?? resourceResolutionForRow(resourceDetailsRow) : null;
  const resourceDetailsObservedEntity = resourceDetailsResolution?.value ?? resourceDetailsEntity;
  const resourceDetailsFacts = resourceDetailsEntity ? resolveMapEntity({
    source: { owner: resourceDetailsEntity.locator.owner, sourceId: resourceDetailsEntity.locator.id },
    tangent: { kind: "resource", ref: resourceDetailsEntity.locator.id },
    resource: resourceDetailsResolution,
  }) : null;
  const resourceDetailsCheckout = resourceDetailsObservedEntity?.local?.value?.checkout ?? null;
  const resourceDetailsBranch = resourceDetailsCheckout?.kind === "branch" ? String(resourceDetailsCheckout.branchRef ?? "").replace(/^refs\/heads\//, "") : "";
  const resourceDetailsRepository = resourceDetailsObservedEntity?.local?.value?.repositoryPath ?? "";
  const resourceDetailsCheckedAt = resourceDetailsObservedEntity?.local?.checkedAt ?? resourceDetailsObservedEntity?.link?.lifecycle?.checkedAt ?? "";
  const resourceDetailsProviderUpdatedAt = resourceDetailsObservedEntity?.link?.lifecycle?.value?.providerUpdatedAt ?? "";
  const resourceDetailsObservationError = resourceDetailsObservedEntity?.link?.lifecycle?.error ?? resourceDetailsObservedEntity?.local?.error ?? null;
  const resourceDetailsOrigin = resourceDetailsEntity?.origin?.kind === "legacy-area-binding" ? resourceDetailsEntity.origin : null;
  const resourceDetailsWarnings = (resourceDetailsObservedEntity?.warnings ?? []).map(resourceWarningText).filter(Boolean);
  const resourceEditorPreviousTarget = resourceEditor?.mode === "edit" ? resourceEntityForRow(resourceEditor.row)?.target?.url ?? resourceEntityForRow(resourceEditor.row)?.target?.path ?? "" : "";
  const resourceEditorTargetChanged = Boolean(resourceEditorPreviousTarget && resourceEditor?.target !== resourceEditorPreviousTarget);
  const debug = typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "area-map";
  const nodeByParent = new Map();
  for (const node of visibleNodes) { const list = nodeByParent.get(node.parent) ?? []; list.push(node); nodeByParent.set(node.parent, list); }
  for (const list of nodeByParent.values()) list.sort((left, right) => left.key.localeCompare(right.key));
  const outlineBlocksByOwner = new Map();
  for (const element of state.composition.scene.elements) {
    if (element.isDeleted || !boardCore.tangentOf(element) || element.customData?.tangent?.role === "area-region") continue;
    const owner = element.customData?.tangentWorld?.owner; if (!owner) continue;
    const rows = outlineBlocksByOwner.get(owner) ?? []; rows.push(element); outlineBlocksByOwner.set(owner, rows);
  }
  for (const rows of outlineBlocksByOwner.values()) rows.sort((left, right) => (resolvedBlock(left)?.display.label ?? "").localeCompare(resolvedBlock(right)?.display.label ?? ""));
  /** Selects and fits one Outline Block without running its primary action. */
  const selectOutlineBlock = (block) => {
    if (resourceLocate) setResourceLocate(null);
    controller.setSelection([block.id]); programmaticSelectionRef.current = new Set([block.id]);
    projectCanvas({ appState: { selectedElementIds: { [block.id]: true } }, captureUpdate: "NEVER" }, "selection-repair");
    scrollCanvasTo([block], { fitToContent: true, animate: false });
  };
  /** Renders a semantically nested accessible Area tree. */
  const outlineTree = (parent = "@root") => <ol role={parent === "@root" ? "tree" : "group"}>{(nodeByParent.get(parent) ?? []).map((node) => {
    const selected = [...state.selection].some((id) => state.composition.scene.elements.find((element) => element.id === id)?.customData?.tangent?.area === node.key);
    const children = nodeByParent.get(node.key) ?? [];
    const blocks = outlineBlocksByOwner.get(node.key) ?? [];
    return <li role="none" key={node.key}><button type="button" role="treeitem" data-outline-area={node.key} aria-label={accessibleAreaName(node)} aria-level={node.depth + 1} aria-selected={selected} aria-expanded={children.length ? !state.folded.has(node.key) : undefined} onClick={() => selectArea(node.key)} onDoubleClick={() => scrollToArea(node.key)} onKeyDown={(event) => {
      const buttons = [...host.querySelectorAll('.tangent-map-outline [role="treeitem"]')]; const index = buttons.indexOf(event.currentTarget);
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) {
        stop(event); const forward = ["ArrowDown", "ArrowRight"].includes(event.key);
        buttons[Math.max(0, Math.min(buttons.length - 1, index + (forward ? 1 : -1)))]?.focus();
      }
      else if (event.key === "Enter") { stop(event); scrollToArea(node.key); }
      else if (event.key === " ") { stop(event); changeFold(node.key); }
    }}>{areaName(node.key)} · depth {node.depth + 1} · {state.folded.has(node.key) ? "folded" : node.shard.state} · {Number(node.shard.blockCount ?? 0)} blocks</button>
      {blocks.length ? <ol role="group">{blocks.map((block) => { const entity = resolvedBlock(block); if (!entity) return null; return <li role="none" key={block.id}><button type="button" role="treeitem" data-outline-block={block.id} aria-level={node.depth + 2} aria-selected={state.selection.size === 1 && state.selection.has(block.id)} aria-label={`${entity.accessibleName}. ${entity.display.actionLabel ? `${entity.display.actionLabel} with Enter.` : "No primary action."}`} onClick={() => selectOutlineBlock(block)} onDoubleClick={(event) => { stop(event); void dispatchMapEntity(entity, entity.primaryAction, event.currentTarget); }} onKeyDown={(event) => {
        const buttons = [...host.querySelectorAll('.tangent-map-outline [role="treeitem"]')]; const index = buttons.indexOf(event.currentTarget);
        if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) { stop(event); const forward = ["ArrowDown", "ArrowRight"].includes(event.key); buttons[Math.max(0, Math.min(buttons.length - 1, index + (forward ? 1 : -1)))]?.focus(); }
        else if (event.key === " ") { stop(event); selectOutlineBlock(block); }
        else if (event.key === "Enter" && entity.primaryAction) { stop(event); void dispatchMapEntity(entity, entity.primaryAction, event.currentTarget); }
      }}><small>{entity.display.kindLabel}</small> · {entity.display.label}{entity.display.stateText.length ? ` · ${entity.display.stateText.join(" · ")}` : ""}{entity.display.actionLabel ? ` · ${entity.display.actionLabel}` : ""}</button></li>; })}</ol> : null}
      {children.length && !state.folded.has(node.key) ? outlineTree(node.key) : null}</li>;
  })}</ol>;

  /** Renders one resource inventory row from the same facts as its Map Block. */
  const resourceRowView = (row) => {
    const entity = resourceEntityForRow(row); if (!entity) return null;
    const key = resourceLocatorKey(entity.locator);
    const resolution = resourceResolutions.get(key) ?? resourceResolutionForRow(row);
    const observedEntity = resolution?.value ?? entity;
    const facts = resolveMapEntity({ source: { owner: entity.locator.owner, sourceId: entity.locator.id }, tangent: { kind: "resource", ref: entity.locator.id }, resource: resolution });
    if (!facts) return null;
    const representation = representationForRow(row);
    const representationLabel = representation === "on-map" ? "On Map" : representation === "hidden" ? "Not on Map · Hidden" : representation === "never-placed" ? "Not on Map · Never placed" : "Map state unavailable";
    const direct = row.relation?.kind !== "inherited";
    const provenance = direct ? "Direct" : `From ${row.relation.sourceArea}`;
    const target = observedEntity.target?.url ?? observedEntity.target?.path ?? observedEntity.lastKnown?.target?.url ?? observedEntity.lastKnown?.target?.path ?? "Target unavailable";
    const placementLabel = representation === "on-map" ? (direct ? "Show on Map" : `Show in ${leaf(entity.locator.owner)}`)
      : representation === "hidden" ? "Restore on Map"
        : direct ? "Place on Map" : `Place in ${leaf(entity.locator.owner)}`;
    const launch = row.launchMatch?.state === "current" && row.launchMatch.value;
    const warnings = (observedEntity.warnings ?? []).map(resourceWarningText).filter(Boolean);
    const rowName = `${facts.accessibleName}. ${provenance}. ${representationLabel}.${launch ? ` Workers start here by default from ${entity.locator.owner}.` : ""}${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
    /** Prefixes an action label to the full row name for accessible buttons. */
    const actionName = (label) => `${label}. ${rowName}`;
    const writable = resourceWritesAvailable();
    const refreshing = resourceRefreshing.has(key);
    const refreshLabel = observedEntity.local?.state === "not-checked" ? "Check path" : observedEntity.target?.kind === "link" ? "Refresh status" : "Refresh path";
    return <li role="listitem" aria-label={rowName} key={key} className={`tangent-map-resource-row ${facts.display.externalTreatment ?? ""}`}>
      <div className="tangent-map-resource-summary"><span className="tangent-map-resource-kind">{facts.display.kindLabel}</span><strong>{facts.display.label}</strong><span>{facts.display.targetClue}</span></div>
      <div className="tangent-map-resource-facts"><span>{provenance}</span>{row.alsoFrom?.map((area) => <span key={area}>Also from {area}</span>)}<span>{representationLabel}</span>{launch && <span>Workers start here by default</span>}{facts.display.stateText.map((value) => <span key={value}>{value}</span>)}</div>
      {launch && <p className="tangent-map-resource-warning">Workers still start here by default from the Area launch binding ({entity.locator.owner}).</p>}
      {warnings.map((warning) => <p className="tangent-map-resource-warning" key={warning}>{warning}</p>)}
      <code title={target}>{target}</code>
      <div className="tangent-map-resource-actions">
        {facts.primaryAction && <button type="button" aria-label={actionName(facts.display.actionLabel)} onClick={(event) => void dispatchMapEntity(facts, facts.primaryAction, event.currentTarget)}>{facts.display.actionLabel}</button>}
        <button type="button" aria-label={actionName("Details")} onClick={(event) => { resourceDetailsOpenerRef.current = event.currentTarget; setResourceDetails(entity.locator); }}>Details</button>
        {representation !== "unavailable" && <button type="button" aria-label={actionName(placementLabel)} disabled={representation !== "on-map" && !writable} data-resource-show={representation === "on-map" ? encodeURIComponent(`${entity.locator.owner}/${entity.locator.id}`) : undefined} data-resource-place={representation !== "on-map" ? encodeURIComponent(`${entity.locator.owner}/${entity.locator.id}`) : undefined} onClick={(event) => placeResourceOnMap(row, event.currentTarget)}>{placementLabel}</button>}
        {representation === "on-map" && <button type="button" aria-label={actionName("Hide Block")} disabled={!writable} onClick={() => hideResourceOnMap(row)}>Hide Block</button>}
        {direct && representation === "on-map" && entity.reason && entity.lastKnown?.target && ["removed", "missing-record"].includes(entity.reason) && <button type="button" aria-label={actionName("Add back to Area")} disabled={!writable} onClick={(event) => requestAddBack(row, event.currentTarget)}>Add back to Area</button>}
        {!entity.reason && <button type="button" aria-label={actionName(refreshing ? "Checking" : refreshLabel)} disabled={refreshing || !resourceControlsAvailable()} onClick={() => void refreshResourceFacts([entity.locator])}>{refreshing ? "Checking…" : refreshLabel}</button>}
        {direct && !entity.reason && entity.target?.kind === "worktree" && entity.local?.value?.state === "not-a-worktree" && <button type="button" aria-label={actionName("Change to Repository")} disabled={!writable} onClick={() => editResource({ mode: "edit", kind: "repository", row })}>Change to Repository</button>}
        {direct && !entity.reason && <button type="button" aria-label={actionName("Edit")} disabled={!writable} onClick={() => editResource({ mode: "edit", row })}>Edit</button>}
        {direct && !entity.reason && <button type="button" aria-label={actionName("Remove from Area")} disabled={!writable} onClick={(event) => void applyResourceMutation({ kind: "remove", resource: entity.locator }, { success: "Resource removed from Area.", opener: event.currentTarget })}>Remove from Area</button>}
        {!direct && <button type="button" aria-label={actionName(`Open source Area ${entity.locator.owner}`)} onClick={() => openResourceSourceArea(row)}>Open source Area</button>}
        {!direct && !entity.reason && <button type="button" aria-label={actionName("Add to this Area")} disabled={!writable} onClick={() => editResource({ mode: "add", row })}>Add to this Area</button>}
      </div>
    </li>;
  };

  /** Captures one Excalidraw pointer command through the current world closure. */
  function handleCanvasPointerDown(tool, pointerDownState) {
    if (resourcePlacement) {
      resourcePlacementPointerRef.current = true;
      commitResourcePlacement(pointerDownState.origin);
      return;
    }
    if (tool?.type === "text") { textPlacementRef.current = pointerDownState.origin; return; }
    textPlacementRef.current = null;
    beginPointerGesture(pointerDownState.origin, pointerDownState, tool);
  }

  /** Closes the same command with Excalidraw's original pointer-down state. */
  function handleCanvasPointerUp(tool, _pointerDownState) {
    if (resourcePlacementPointerRef.current) { resourcePlacementPointerRef.current = false; return; }
    if (tool?.type === "text") return;
    endPointerGesture();
  }

  /** Routes Excalidraw pointer previews through the current containment solver. */
  function handleCanvasPointerUpdate({ pointer }) {
    if (resourcePlacement) {
      setResourcePlacement((current) => current ? { ...current, point: boundedResourcePlacementPoint(current, pointer) } : current);
      return;
    }
    previewPointerGesture(pointer);
  }

  /** Stores the current camera without entering authored history. */
  function handleCanvasScroll(scrollX, scrollY, zoom) { controller.setCamera({ scrollX, scrollY, zoom: zoom?.value ?? zoom }); }

  /** Claims ordinary paste placement or consumes a semantic Tangent reference. */
  function handleCanvasPaste(data) {
    if (data.files?.length) return true;
    actionKindRef.current = "paste";
    const point = placementPoint(); const area = areaAtPoint(state.composition, point, state.locatedArea, state.scopedAreas);
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
    if (pointerStateRef.current?.rejectedAreaTransform) {
      const snapshot = controller.snapshot();
      projectCanvas({
        elements: snapshot.scene.elements,
        appState: { selectedElementIds: Object.fromEntries([...stableSelectionRef.current].map((id) => [id, true])) },
        captureUpdate: "NEVER",
      }, "area-transform-rejected");
      return;
    }
    const pendingProjection = expectedProjectionsRef.current.find((token) => token.includesElements);
    const userCommand = pointerBaselineRef.current || nonPointerKindRef.current || textEditRef.current || actionKindRef.current;
    if (!userCommand && (pendingProjection || projectionFenceRef.current)) {
      const fingerprint = boardCore.authoredFingerprint(elements);
      appliedProjectionRef.current = fingerprint;
      fingerprintRef.current = fingerprint;
      const fence = pendingProjection?.id ?? projectionFenceRef.current;
      expectedProjectionsRef.current = expectedProjectionsRef.current.filter((token) => token.id > fence);
      return;
    }
    if (appState.editingTextElement) {
      cancelDeferredCanvasUpdate();
      textEditRef.current = { editingId: appState.editingTextElement.id, elements: clone(elements) };
      return;
    }
    if (textEditRef.current) cancelDeferredCanvasUpdate();
    else if (initializingRef.current && !userCommand) return;
    if (pointerSettlingRef.current && !textEditRef.current) return;
    let sourceElements = elements;
    if (textEditRef.current) {
      const buffered = textEditRef.current; textEditRef.current = null;
      // The text command supersedes the selection that existed when its
      // pointer started. Do not project that stale selection over the final
      // Excalidraw text callback.
      programmaticSelectionRef.current = null;
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
      if (resourceLocate && selectionKey(ids) !== selectionKey([resourceLocate.blockId])) setResourceLocate(null);
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
    onPointerUp: handleCanvasPointerUp,
    onPointerUpdate: handleCanvasPointerUpdate,
    onScrollChange: handleCanvasScroll,
    onPaste: handleCanvasPaste,
    onChange: handleCanvasChange,
  };

  return <div className="TangentAreaMap theme--dark" data-tangent-area-map={state.locatedArea} data-tangent-area-map-world={options.world.worldId} aria-busy={resourceSceneBusy ? "true" : undefined}>
    <StableWorldCanvas initialData={initialDataRef.current} handlers={canvasHandlersRef} />
    <div className="tangent-map-top-right">
      <div className="tangent-map-toolbar-extra"><button type="button" onClick={openPicker} aria-keyshortcuts="b Shift+B" title="Place a Tangent block (B)"><span aria-hidden="true">◈</span><span className="tangent-map-label">Block</span><kbd>B</kbd></button></div>
      <button type="button" className="tangent-map-resources-button" onClick={(event) => openResources(selectedArea || state.locatedArea, event.currentTarget)} aria-expanded={resourcesOpen} title="Manage Map resources"><span aria-hidden="true" className="tangent-map-glyph">⌘</span><span className="tangent-map-label">Resources</span></button>
      {currentBlock && <div className="tangent-map-verbs" role="group" aria-label={`Actions for ${currentBlockAccessible}`}>
        {currentEntity?.primaryAction && <button type="button" aria-label={`${currentEntity.display.actionLabel}. ${currentBlockAccessible}`} onClick={(event) => void dispatchMapEntity(currentEntity, currentEntity.primaryAction, event.currentTarget)}>{currentEntity.display.actionLabel} <kbd>Enter</kbd></button>}
        {currentEntity?.reference.kind === "link" && currentEntity.source?.owner && currentEntity.source.owner !== "@root" && <button type="button" disabled={!resourceWritesAvailable()} aria-label={`Add to Area. ${currentEntity.accessibleName}`} onClick={(event) => associateGenericLink(currentEntity, event.currentTarget)}>Add to Area</button>}
        {currentEntity?.reference.kind === "resource" && <button type="button" aria-label={`Details. ${currentBlockAccessible}`} onClick={(event) => { resourceDetailsOpenerRef.current = event.currentTarget; openResources(currentEntity.source.owner, event.currentTarget); setResourceDetails(currentEntity.reference.resource); }}>Details</button>}
        <button type="button" aria-label={`Hide. ${currentBlockAccessible}`} onClick={() => hideBlock(currentBlock)}>Hide <kbd>X</kbd></button>
      </div>}
      <button type="button" onClick={() => setOutlineOpen((value) => !value)} aria-expanded={outlineOpen} title="Outline"><span aria-hidden="true" className="tangent-map-glyph">≣</span><span className="tangent-map-label">Outline</span></button>
      <button type="button" onClick={() => setHelpOpen(true)} aria-keyshortcuts="?" title="Map keys (?)"><span aria-hidden="true" className="tangent-map-glyph">?</span><span className="tangent-map-label">Keys</span><kbd>?</kbd></button>
    </div>
    <div className="tangent-map-ancestry" aria-label="Complete Area hierarchy">
      {visibleNodes.map((node) => {
        const box = state.composition.regionRects.get(node.key);
        if (!box) return null;
        const name = areaName(node.key);
        const areaRecord = areaRecords.get(node.key);
        const runtime = areaRuntimeAnnotations(areaRecord);
        const hasRuntime = Boolean(runtime.facts.length || runtime.ready || runtime.stale);
        const left = (box.x + state.camera.scrollX) * state.camera.zoom + 12;
        const top = (box.y + state.camera.scrollY) * state.camera.zoom + 10;
        const summary = !state.detailAreas.has(node.key) ? `${Number(node.shard.blockCount ?? 0)} blocks` : "";
        const findCurrent = activeFindRow?.kind === "area" && activeFindRow.area === node.key;
        const ref = areaRecord?.file ?? `${node.key}/${leaf(node.key)}.md`;
        return <React.Fragment key={node.key}>
          <button type="button" data-area-map-label={node.key} className={findCurrent ? "find-match-current" : ""} style={{ left: `${left}px`, top: `${top}px` }} onClick={() => selectArea(node.key)} onDoubleClick={() => scrollToArea(node.key)} aria-label={accessibleAreaName(node)}><strong>{name}</strong>{state.folded.has(node.key) && <span>folded · Space</span>}{["loading", "deferred", "unreadable", "load-error"].includes(node.shard.state) && <span>{node.shard.state === "unreadable" ? "map file unreadable" : node.shard.state === "load-error" ? "load failed · click to retry" : node.shard.state}</span>}{summary && <span>{summary}</span>}</button>
          {hasRuntime && <div data-area-runtime-facts={node.key} role="group" aria-label={`${name} runtime`} style={{ position: "absolute", left: `${left}px`, top: `${top + 30}px`, display: "flex", alignItems: "center", gap: "4px", pointerEvents: "auto", whiteSpace: "nowrap" }}>
            {runtime.facts.map((fact) => <button key={fact.verb} type="button" data-area-runtime-action={fact.verb} style={{ position: "static", padding: "2px 7px", border: "1px solid color-mix(in srgb, var(--tangent-muted) 65%, transparent)", borderRadius: "999px", background: "color-mix(in srgb, var(--tangent-island) 92%, transparent)", fontSize: "11px" }} aria-label={`Open ${fact.verb === "work" ? "Work" : fact.verb === "for-you" ? "For you" : "Problems"} for ${name}: ${fact.label}`} onClick={(event) => { event.stopPropagation(); options.onEntityVerb?.({ kind: "area", area: node.key, ref, verb: fact.verb }); }}>{fact.label}</button>)}
            {runtime.ready && <span style={{ padding: "2px 7px", border: "1px solid color-mix(in srgb, var(--tangent-muted) 65%, transparent)", borderRadius: "999px", background: "color-mix(in srgb, var(--tangent-island) 92%, transparent)", color: "var(--tangent-text)", fontSize: "11px" }}>Ready</span>}
            {runtime.stale && <span style={{ padding: "2px 7px", border: "1px dashed var(--tangent-muted)", borderRadius: "999px", background: "var(--tangent-island)", color: "var(--tangent-muted)", fontSize: "11px" }}>Last known</span>}
          </div>}
        </React.Fragment>;
      })}
    </div>
    <div className={`tangent-map-save ${state.save.state}`} role="status" aria-live="polite" aria-label="Map save status">{state.save.state === "saving" ? "Saving…" : state.save.state === "dirty" ? "Pending save…" : state.save.state === "conflict" ? <>Not saved <button type="button" onClick={() => recoverMap("reload")}>Reload saved</button><button type="button" onClick={() => recoverMap("keepMine")}>Keep mine</button></> : state.save.state === "blocked" ? <>Not saved <button type="button" onClick={() => recoverMap("retry")}>Retry</button><button type="button" onClick={() => recoverMap("reload")}>Reload saved</button><button type="button" onClick={() => recoverMap("keepMine")}>Keep mine</button></> : state.draft && !state.draft.restored ? "Saved · Recovery available" : "Saved"}</div>
    {notice && <div className="tangent-map-location" aria-hidden="true">{notice}</div>}
    {announcement.text && <div key={announcement.id} className="tangent-map-live" role="status" aria-live="polite" aria-atomic="true">{announcement.text}</div>}
    {resourcePlacement && <section className="tangent-map-resource-placement" role="status" aria-label={`Place ${resourcePlacement.entity.label} on the Map`}><strong>Place {resourcePlacement.entity.label} in {areaName(resourcePlacement.entity.locator.owner)}</strong><span>Move the pointer or use <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd></span><span>Click or <kbd>Enter</kbd> to place · <kbd>Esc</kbd> to cancel</span><button type="button" onClick={cancelResourcePlacement}>Cancel</button></section>}
    {findOpen && <section className="tangent-map-find" role="search" aria-label="Find on the map">
      <div className="tangent-map-find-line"><input ref={findInputRef} aria-label="Find on the map" value={findQuery} onChange={(event) => applyFindQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { stop(event); escape(); }
        else if (event.key === "Enter") { stop(event); confirmFind(); }
        else if (["ArrowDown", "ArrowUp"].includes(event.key)) { stop(event); stepFind(event.key === "ArrowDown" ? 1 : -1); }
      }} placeholder="Area name or path" aria-controls="tangent-map-find-results" aria-activedescendant={activeFindRow ? `tangent-map-find-${activeFindIndex}` : undefined} />
      <strong className={findQuery.trim() && !findRows.length ? "miss" : ""}>{!findQuery.trim() ? "" : !findRows.length ? "No match" : `${activeFindIndex + 1} of ${findRows.length}`}</strong>
      <button type="button" onClick={() => stepFind(-1)} aria-label="Previous match">↑</button><button type="button" onClick={() => stepFind(1)} aria-label="Next match">↓</button><button type="button" onClick={cancelFind}>Cancel</button></div>
      <ul id="tangent-map-find-results" role="listbox">{visibleFindRows.map((row, offset) => { const index = findWindowStart + offset; return <li key={row.key}><button id={`tangent-map-find-${index}`} type="button" role="option" aria-selected={index === activeFindIndex} onClick={() => { setFindIndex(index); previewFind(row); }}><small>{row.kind}</small><span><strong>{row.name}</strong><em>{areaPathName(row.area)}</em></span>{row.hidden && <i>hidden</i>}</button></li>; })}</ul>
      <p><kbd>↓</kbd> next · <kbd>↑</kbd> previous · <kbd>↵</kbd> keep · <kbd>Esc</kbd> cancel</p>
    </section>}
    {outlineOpen && <section className="tangent-map-outline visible" aria-label="Area hierarchy"><header><strong>Map Outline</strong><button type="button" className="tangent-map-outline-close" onClick={() => setOutlineOpen(false)}>Close</button></header>{outlineTree()}{![...outlineBlocksByOwner.values()].some((rows) => rows.length) && <div className="tangent-map-outline-empty"><p>Nothing on the Map yet.</p><button type="button" onClick={openPicker}>Block</button><button type="button" onClick={(event) => openResources(selectedArea || state.locatedArea, event.currentTarget)}>Resources</button></div>}</section>}
    {picker && <div className={`tangent-map-dialog-backdrop dock-${picker.dock}`}><section className="tangent-map-picker" role="dialog" aria-modal="true" aria-label="Place a Tangent block">
      <h2>{widePicker ? "Place from the whole vault" : picker.outside ? "Outside every Area" : `Place in ${leaf(picker.area)}`}</h2>
      <input autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Tab") { stop(event); setWidePicker((value) => !value); }
        else if (event.key === "Escape") { stop(event); escape(); }
        else if (event.key === "Enter" && pickerChoices[0]) { stop(event); placeBlock(pickerChoices[0], event.shiftKey); }
      }} placeholder="Resource, Goal, Document, Area, or URL" />
      <ul role="listbox">{pickerChoices.slice(0, 30).map((choice, index, values) => <React.Fragment key={`${choice.kind}:${choice.owner ?? ""}:${choice.ref}`}>
        {choice.resourceRow && !values[index - 1]?.resourceRow && <li role="presentation" className="tangent-map-picker-group">Resources in {areaName(targetArea)}</li>}
        {!choice.resourceRow && values[index - 1]?.resourceRow && <li role="presentation" className="tangent-map-picker-group">Other Blocks</li>}
        <li><button type="button" aria-label={choice.accessibleName} onClick={() => placeBlock(choice)}><small>{choice.kind}</small><span>{choice.title}</span><em>{choice.status}</em></button></li>
      </React.Fragment>)}</ul>
      <p><kbd>Tab</kbd> {widePicker ? "return here" : "whole vault"} · <kbd>Enter</kbd> place · <kbd>⇧Enter</kbd> place another · <kbd>Esc</kbd> close</p>
    </section></div>}
    {resourcesOpen && <div className={`tangent-map-resources-backdrop ${narrowResources ? "is-modal" : "is-panel"}${resourcePlacement ? " placement-active" : ""}`}><section className="tangent-map-resources" role={narrowResources ? "dialog" : "region"} aria-modal={narrowResources ? "true" : undefined} aria-labelledby="tangent-map-resources-title" onKeyDown={(event) => {
      if (event.key === "Escape") {
        stop(event);
        if (resourceDetails) { setResourceDetails(null); requestAnimationFrame(() => resourceDetailsOpenerRef.current?.focus?.()); }
        else if (resourceEditor && !resourceEditor.hidden) setResourceEditor((current) => ({ ...current, hidden: true }));
        else closeResources();
      } else if (narrowResources) trapModalTab(event);
    }}>
      <header><div><p>Area resource inventory</p><h2 id="tangent-map-resources-title" ref={resourcesHeadingRef} tabIndex="-1">Map resources · {areaName(resourcesArea)}</h2></div><button type="button" onClick={closeResources}>Close</button></header>
      <nav aria-label="Resource Area breadcrumb">{String(resourcesArea).split("/").filter(Boolean).map((_part, index, parts) => { const area = parts.slice(0, index + 1).join("/"); return <button type="button" key={area} aria-current={area === resourcesArea ? "page" : undefined} onClick={() => { setResourcesArea(area); setResourceProjection(null); setResourceDetails(null); setResourceEditor(null); setResourceDiscovery(null); setResourceMutationRecovery(null); void loadResources(area); }}>{areaName(area)}</button>; })}</nav>
      {resourceTransport.error && <div className="tangent-map-resource-problem" role="alert"><strong>{resourceTransport.state === "last-known" ? "Could not refresh Map resources · Last known." : "Map resources did not load."}</strong><span>{resourceTransport.error}</span><button type="button" onClick={() => void loadResources(resourcesArea)}>Retry</button></div>}
      {resourceProjection?.state === "partial" && <div className="tangent-map-resource-problem" role="status">Some source facts are unavailable. Counts are lower bounds; Copy and Open remain available.</div>}
      {resourceMutationRecovery && <div className="tangent-map-resource-problem" role="alert"><strong>{resourceMutationRecovery.message}</strong><span>{resourceMutationRecovery.code === "duplicate-resource-target" ? "That exact target already belongs to this Area." : ["catalog-revision-changed", "suggestion-changed"].includes(resourceMutationRecovery.code) ? "Reload current resources without discarding this draft." : resourceMutationRecovery.code === "missing-target-confirmation-required" ? "Review and confirm the exact missing path before saving again." : resourceMutationRecovery.code === "legacy-branch-choice-required" ? "Choose the one imported target that owns the legacy Branch." : "The current draft and server recovery evidence are retained."}</span><div className="tangent-map-resource-actions">
        {resourceMutationRecovery.code === "duplicate-resource-target" && <><button type="button" onClick={openRecoveryResource}>Open resource</button><button type="button" onClick={showRecoveryResource}>Show on Map</button></>}
        {["catalog-revision-changed", "suggestion-changed"].includes(resourceMutationRecovery.code) && <button type="button" onClick={() => void loadResources(resourcesArea, { refreshObservations: false, rebaseDraft: true })}>Reload resources</button>}
        {resourceMutationRecovery.code === "missing-target-confirmation-required" && <button type="button" onClick={() => host.querySelector(".tangent-map-resource-confirm input")?.focus?.()}>Review missing path</button>}
        {resourceMutationRecovery.code === "legacy-branch-choice-required" && resourceMutationRecovery.recovery.choices?.map((choice) => <button type="button" key={`${choice.owner}:${choice.targetFingerprint}`} onClick={() => chooseLegacyBranch(choice)}>Use {choice.field}: {choice.label}</button>)}
        <button type="button" onClick={closeResourceMutationRecovery}>Close error</button>
      </div></div>}
      {resourceUndo && <div className="tangent-map-resource-undo" role="status"><span>Map resource change saved.</span><button type="button" disabled={!resourceWritesAvailable()} onClick={(event) => void undoResourceChange(event.currentTarget)}>Undo</button></div>}
      {resourceDetailsRow && resourceDetailsEntity && resourceDetailsFacts ? <article className="tangent-map-resource-details">
        <button type="button" className="tangent-map-resource-back" onClick={() => { setResourceDetails(null); requestAnimationFrame(() => resourceDetailsOpenerRef.current?.focus?.()); }}>← Back to resources</button>
        <h3>{resourceDetailsFacts.display.label}</h3>
        <dl><div><dt>Kind</dt><dd>{resourceDetailsFacts.display.kindLabel}</dd></div><div><dt>Exact target</dt><dd><textarea readOnly value={resourceDetailsFacts.primaryAction?.path ?? resourceDetailsFacts.primaryAction?.url ?? resourceDetailsEntity.lastKnown?.target?.path ?? resourceDetailsEntity.lastKnown?.target?.url ?? "Target unavailable"} onFocus={(event) => event.currentTarget.select()} /></dd></div><div><dt>Owning Area</dt><dd>{resourceDetailsEntity.locator.owner}</dd></div><div><dt>Source</dt><dd>{resourceDetailsRow.relation?.kind === "inherited" ? `From ${resourceDetailsRow.relation.sourceArea}` : "Direct"}</dd></div><div><dt>State</dt><dd>{resourceDetailsFacts.display.stateText.join(" · ") || "Current"}</dd></div><div><dt>Map</dt><dd>{representationForRow(resourceDetailsRow) === "on-map" ? "On Map" : representationForRow(resourceDetailsRow) === "hidden" ? "Not on Map · Hidden" : representationForRow(resourceDetailsRow) === "never-placed" ? "Not on Map · Never placed" : "Map state unavailable"}</dd></div>{resourceDetailsBranch && <div><dt>Branch</dt><dd>{resourceDetailsBranch}</dd></div>}{resourceDetailsRepository && <div><dt>Repository path</dt><dd><code>{resourceDetailsRepository}</code></dd></div>}{resourceDetailsCheckedAt && <div><dt>Checked</dt><dd><time dateTime={resourceDetailsCheckedAt}>{resourceDetailsCheckedAt}</time></dd></div>}{resourceDetailsProviderUpdatedAt && <div><dt>Provider updated</dt><dd><time dateTime={resourceDetailsProviderUpdatedAt}>{resourceDetailsProviderUpdatedAt}</time></dd></div>}{resourceDetailsObservationError?.message && <div><dt>Status error</dt><dd>{resourceDetailsObservationError.message}</dd></div>}{resourceDetailsRow.launchMatch?.state === "current" && <div><dt>Workers start here by default</dt><dd>{resourceDetailsRow.launchMatch.value ? `Yes · Area launch binding ${resourceDetailsEntity.locator.owner}` : "No"}</dd></div>}{resourceDetailsOrigin && <div><dt>Legacy origin</dt><dd>{resourceDetailsOrigin.field}{resourceDetailsOrigin.declaredBranch ? ` · Branch ${resourceDetailsOrigin.declaredBranch}` : ""}</dd></div>}{resourceDetailsWarnings.map((warning) => <div key={warning}><dt>Warning</dt><dd>{warning}</dd></div>)}</dl>
        <div className="tangent-map-resource-actions">{resourceDetailsFacts.primaryAction && <button type="button" aria-label={`${resourceDetailsFacts.display.actionLabel}. ${resourceDetailsFacts.accessibleName}`} onClick={(event) => void dispatchMapEntity(resourceDetailsFacts, resourceDetailsFacts.primaryAction, event.currentTarget)}>{resourceDetailsFacts.display.actionLabel}</button>}<button type="button" disabled={representationForRow(resourceDetailsRow) !== "on-map" && !resourceWritesAvailable()} aria-label={`${representationForRow(resourceDetailsRow) === "on-map" ? "Show on Map" : representationForRow(resourceDetailsRow) === "hidden" ? "Restore on Map" : "Place on Map"}. ${resourceDetailsFacts.accessibleName}`} data-resource-show={representationForRow(resourceDetailsRow) === "on-map" ? encodeURIComponent(`${resourceDetailsEntity.locator.owner}/${resourceDetailsEntity.locator.id}`) : undefined} data-resource-place={representationForRow(resourceDetailsRow) !== "on-map" ? encodeURIComponent(`${resourceDetailsEntity.locator.owner}/${resourceDetailsEntity.locator.id}`) : undefined} onClick={(event) => placeResourceOnMap(resourceDetailsRow, event.currentTarget)}>{representationForRow(resourceDetailsRow) === "on-map" ? "Show on Map" : representationForRow(resourceDetailsRow) === "hidden" ? "Restore on Map" : "Place on Map"}</button></div>
      </article> : resourceEditor && !resourceEditor.hidden ? <form className="tangent-map-resource-editor" onSubmit={(event) => { stop(event); void saveResourceDraft(); }}>
        <button type="button" className="tangent-map-resource-back" onClick={() => setResourceEditor((current) => ({ ...current, hidden: true }))}>← Back to resources</button>
        <h3>{resourceEditor.mode === "edit" ? "Edit resource" : resourceEditor.mode === "suggestion" ? "Add suggestion to Area" : `Add ${resourceEditor.kind}`}</h3>
        <label>Kind<select value={resourceEditor.kind} onChange={(event) => setResourceEditor((current) => ({ ...current, kind: event.target.value, inspection: null, confirmMissing: false }))}><option value="worktree">Worktree</option><option value="repository">Repository</option><option value="link">Link</option></select></label>
        <label>{resourceEditor.kind === "link" ? "HTTP or HTTPS URL" : "Absolute path"}<input required value={resourceEditor.target} onChange={(event) => setResourceEditor((current) => ({ ...current, target: event.target.value, inspection: null, confirmMissing: false, error: "" }))} /></label>
        <label>Label (optional)<input value={resourceEditor.label} onChange={(event) => setResourceEditor((current) => ({ ...current, label: event.target.value, error: "" }))} /></label>
        {resourceEditorTargetChanged && <dl className="tangent-map-resource-target-change"><div><dt>Current target</dt><dd><code>{resourceEditorPreviousTarget}</code></dd></div><div><dt>New target</dt><dd><code>{resourceEditor.target}</code></dd></div></dl>}
        {resourceEditor.inspection?.normalized && <p>Exact target after validation: <code>{resourceEditor.inspection.normalized.path ?? resourceEditor.inspection.normalized.url}</code></p>}
        {resourceEditor.inspection?.state === "missing" && <label className="tangent-map-resource-confirm"><input type="checkbox" checked={resourceEditor.confirmMissing} onChange={(event) => setResourceEditor((current) => ({ ...current, confirmMissing: event.target.checked }))} /> Add this path as Missing</label>}
        {resourceEditor.error && <p className="tangent-map-resource-form-error" role="alert">{resourceEditor.error}</p>}
        <div className="tangent-map-resource-actions"><button type="submit" disabled={!resourceWritesAvailable()}>{resourceBusy ? "Saving…" : "Save"}</button><button type="button" onClick={() => setResourceEditor(null)}>Discard changes</button></div>
      </form> : <div className="tangent-map-resource-inventory">
        {resourceEditor?.hidden && <div className="tangent-map-resource-draft"><span>Unsaved resource draft</span><button type="button" onClick={() => setResourceEditor((current) => ({ ...current, hidden: false }))}>Resume</button><button type="button" onClick={() => setResourceEditor(null)}>Discard</button></div>}
        <div className="tangent-map-resource-controls"><label>Filter resources<input value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} placeholder="Label, path, branch, host, or state" /></label><div><button type="button" disabled={!resourceWritesAvailable()} onClick={() => editResource({ kind: "worktree" })}>Add Worktree</button><button type="button" disabled={!resourceWritesAvailable()} onClick={() => editResource({ kind: "repository" })}>Add Repository</button><button type="button" disabled={!resourceWritesAvailable()} onClick={() => editResource({ kind: "link" })}>Add Link</button></div><div><button type="button" disabled={Boolean(resourceBusy) || !resourceControlsAvailable()} onClick={() => void discoverResources()}>{resourceBusy === "discover" ? "Checking worktrees…" : "Discover worktrees"}</button><button type="button" disabled={Boolean(resourceBusy) || Boolean(resourceRefreshing.size) || !resourceRows.length || !resourceControlsAvailable()} onClick={() => void refreshResourceFacts(resourceRows.map((row) => resourceEntityForRow(row)?.locator).filter(Boolean))}>{resourceRefreshing.size ? "Checking…" : "Refresh status"}</button></div><p>Discovery checks recorded repositories and the latest 20 Area attempts from 30 days. It never adds or places a Block.</p></div>
        {resourceDiscovery && <section className="tangent-map-resource-review" aria-label="Worktree discovery results"><h3>Discovery sources</h3>{resourceDiscovery.state === "checking" ? <p role="status">Checking recorded repositories and recent Attempt folders…</p> : !(resourceDiscovery.sources?.length) ? <p>Add a repository or run a Goal from a folder first.</p> : <ul>{resourceDiscovery.sources.map((result, index) => { const locator = result.source?.resource; const row = locator ? resourceRows.find((candidate) => resourceLocatorKey(resourceEntityForRow(candidate)?.locator) === resourceLocatorKey(locator)) : null; const entity = row ? resourceEntityForRow(row) : null; const facts = row ? resolveMapEntity({ source: { owner: entity.locator.owner, sourceId: entity.locator.id }, tangent: { kind: "resource", ref: entity.locator.id }, resource: resourceResolutionForRow(row) }) : null; const label = entity?.label ?? (result.source?.jobSlug ? `Goal ${result.source.jobSlug}` : result.source?.file ?? `Discovery source ${index + 1}`); return <li key={`${result.source?.kind ?? "source"}:${locator?.owner ?? ""}:${locator?.id ?? result.source?.jobSlug ?? index}`}><strong>{label}</strong><span>{result.state === "complete" ? "Checked" : result.state === "partial" ? "Checked with problems" : "Could not inspect"}</span>{result.diagnostics?.map((problem) => <span key={`${problem.code}:${problem.path ?? ""}`}>{problem.message}</span>)}{facts?.primaryAction?.kind === "copy-path" && <button type="button" onClick={(event) => void dispatchMapEntity(facts, facts.primaryAction, event.currentTarget)}>Copy repository path</button>}</li>; })}</ul>}{resourceDiscovery.problems?.length ? <ul>{resourceDiscovery.problems.map((problem, index) => <li key={`${problem.code}:${index}`}><strong>{problem.code}</strong><span>{problem.message}</span>{problem.retryable && <button type="button" onClick={() => void discoverResources()}>Retry discovery</button>}</li>)}</ul> : null}</section>}
        {resourceTransport.state === "loading" && !resourceProjection && <p role="status">Loading Map resources…</p>}
        {resourceProjection?.state === "current" && resourceTransport.state === "current" && !filteredResourceRows.length && !(resourceProjection.suggestions?.length) && !(resourceProjection.legacyReview?.length) && <p>{resourceFilter ? "No resources match this filter." : "No confirmed Map resources in this Area yet."}</p>}
        {!!filteredResourceRows.length && <ul className="tangent-map-resource-list">{filteredResourceRows.map(resourceRowView)}</ul>}
        {!!resourceProjection?.legacyReview?.length && <section className="tangent-map-resource-review"><h3>Legacy resources to review</h3><ul>{resourceProjection.legacyReview.map((candidate, index) => <li key={`${candidate.owner}:${candidate.field ?? candidate.targetFingerprint}:${index}`}><strong>{candidate.field ?? candidate.proposedLabel ?? candidate.target?.kind}</strong><code>{candidate.target?.path ?? candidate.message}</code>{candidate.state === "candidate" && <button type="button" disabled={!resourceWritesAvailable()} onClick={() => void applyResourceMutation({ kind: "import-legacy", selections: [{ candidate: suggestionReference(candidate), attachDeclaredBranch: Boolean(candidate.declaredBranch) }] }, { success: "Legacy resource imported." })}>Import</button>}</li>)}</ul></section>}
        {!!resourceProjection?.suggestions?.length && <section className="tangent-map-resource-review"><h3>Suggestions</h3><ul>{resourceProjection.suggestions.map((suggestion) => <li key={`${suggestion.owner}:${suggestion.evidenceHash}:${suggestion.targetFingerprint}`}><strong>{suggestion.proposedLabel ?? suggestion.target.kind}</strong><code>{suggestion.target.path ?? suggestion.target.url}</code><span>{suggestion.provenanceLabel}</span><button type="button" disabled={!resourceWritesAvailable()} onClick={() => editResource({ mode: "suggestion", suggestion })}>Add to Area</button><button type="button" disabled={!resourceWritesAvailable()} onClick={() => void applyResourceMutation({ kind: "dismiss-suggestion", suggestion: suggestionReference(suggestion) }, { success: "Suggestion dismissed." })}>Dismiss</button></li>)}</ul></section>}
      </div>}
    </section></div>}
    {resourceSceneBusy && <div className="tangent-map-resource-transaction" role="status" aria-live="polite"><strong>{resourceSceneBusy.label}</strong><span>Map and Area resource authority are saving together.</span></div>}
    {resourceSceneRecovery && <div className="tangent-map-resource-recovery"><section role="dialog" aria-modal="true" aria-labelledby="tangent-map-resource-scene-recovery-title" tabIndex="-1" onKeyDown={(event) => { if (event.key === "Escape") { stop(event); closeResourceSceneRecovery(); } else trapModalTab(event); }}>
      <h2 id="tangent-map-resource-scene-recovery-title">{resourceSceneRecovery.phase === "confirm-add-back" ? `Add ${resourceSceneRecovery.label} back to Area?` : "Map resource was not saved"}</h2>
      {resourceSceneRecovery.phase === "confirm-add-back" ? <><p>This creates a new resource identity and reconnects the visible gone Block in place.</p><label>Exact Last-known target<textarea readOnly value={resourceSceneRecovery.target} autoFocus onFocus={(event) => event.currentTarget.select()} /></label></> : <p role="alert">{resourceSceneRecovery.message}</p>}
      <div>{resourceSceneRecovery.phase === "confirm-add-back" ? <button type="button" autoFocus onClick={() => void confirmAddBack()}>Confirm add back</button> : <button type="button" autoFocus onClick={() => void retrySceneResourceMutation()}>Retry same operation</button>}<button type="button" onClick={closeResourceSceneRecovery}>Close</button></div>
    </section></div>}
    {resourceRecovery && <div className="tangent-map-resource-recovery"><section role="dialog" aria-modal="true" aria-labelledby="tangent-map-resource-recovery-title" tabIndex="-1" onKeyDown={(event) => { if (event.key === "Escape") { stop(event); closeResourceRecovery(); } else trapModalTab(event); }}><h2 id="tangent-map-resource-recovery-title">{resourceRecovery.action.kind === "copy-path" ? `Copy ${resourceRecovery.entity.display.label} path` : resourceRecovery.action.kind === "copy-url" ? "Copy link" : `Open ${resourceRecovery.action.targetLabel}`}</h2><p role="alert">{resourceRecovery.message}</p><textarea aria-label={resourceRecovery.action.kind === "copy-path" ? `Exact ${resourceRecovery.entity.display.label} path` : "Exact link URL"} readOnly value={resourceRecovery.result.copy?.value ?? resourceRecovery.result.url ?? resourceRecovery.action.path ?? resourceRecovery.action.url ?? ""} autoFocus onFocus={(event) => event.currentTarget.select()} />
      <div>{resourceRecovery.action.kind === "open-url" ? <><button type="button" onClick={() => void retryResourceAction()}>Try again</button><button type="button" onClick={copyBlockedLink}>Copy link</button></> : <button type="button" onClick={() => void retryResourceAction()}>Retry</button>}<button type="button" onClick={closeResourceRecovery}>Close</button></div></section></div>}
    {helpOpen && <div className="tangent-map-dialog-backdrop"><section className="tangent-map-help" role="dialog" aria-modal="true" aria-labelledby="tangent-map-help-title"><h2 id="tangent-map-help-title">Map keys</h2><p><kbd>V</kbd> select · <kbd>R</kbd> rectangle · <kbd>D</kbd> diamond · <kbd>O</kbd> ellipse · <kbd>A</kbd> arrow · <kbd>L</kbd> line · <kbd>P</kbd> draw · <kbd>T</kbd> text · <kbd>F</kbd> frame · <kbd>E</kbd> erase · <kbd>B</kbd> block</p><p><kbd>/</kbd> or <kbd>Ctrl-F</kbd> finds visible Areas. <kbd>⇧O</kbd> changes Only for the selected Area.</p><p>Space-drag pans. Command-wheel zooms. Command-Z undoes. Escape closes the top Map control or returns to the retained opener.</p><p>Use the named Brain control or <kbd>⌘⇧Enter</kbd> to open the relevant Brain. <kbd>Ctrl-L</kbd> / <kbd>Ctrl-H</kbd> switch columns.</p><p>With a block selected: <kbd>Enter</kbd> opens · <kbd>X</kbd> hides.</p><button type="button" autoFocus onClick={closeHelp}>Close</button></section></div>}
    {debug && <aside className="tangent-map-debug" aria-label="Area map diagnostics"><h2>Area map diagnostics</h2><p>dirty owners: {[...state.dirtyOwners].join(", ") || "none"}</p><table><thead><tr><th>owner</th><th>source</th><th>runtime</th><th>stored</th><th>constraint</th><th>load</th></tr></thead><tbody>{state.world.areas.map((node) => <tr key={node.key}><td>{node.parent}</td><td>{node.region.sourceId}</td><td>{worldCore.runtimeId(node.parent, node.region.sourceId)}</td><td>{rectWords(node.region.storedRect)}</td><td>{rectWords(state.composition.geometry.get(node.key)?.constraint)}</td><td>{node.shard.state}</td></tr>)}</tbody></table><details><summary>Authored identities</summary><ul>{[...state.composition.origins].filter(([, origin]) => !origin.regionKey).map(([runtime, origin]) => <li key={runtime}>{origin.owner} · {origin.sourceId} · {runtime}</li>)}</ul></details></aside>}
    {state.draft && !state.draft.restored && <section className="tangent-map-draft-choice"><strong>Draft from {new Date(state.draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><button type="button" onClick={() => controller.restoreDraft()}>Restore</button><button type="button" onClick={() => controller.discardDraft()}>Discard</button></section>}
  </div>;
}

export default AreaMapWorld;
