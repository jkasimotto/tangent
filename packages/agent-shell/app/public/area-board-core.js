const TANGENT_SOURCE = "https://tangent.local/area-map";
const BLOCK_WIDTH = 280;
const BLOCK_HEIGHT = 132;
const REGION_SIZES = Object.freeze({ small: { width: 300, height: 220 }, medium: { width: 460, height: 320 }, large: { width: 680, height: 460 } });
const BOUNDARY_MARGIN = 80;
const LABEL_BAND = 40;
// Colours are stored the way Excalidraw stores them: for its light theme. The
// editor's dark theme inverts them on the canvas, so the scene never stores
// dark-theme colours; a scene that did would render inverted, with white ink
// on a white canvas.
const INK = "#1e1e1e";
const CANVAS = "#ffffff";
const BLOCK_STROKE = "#1971c2";
const BLOCK_FILL = "#a5d8ff";
const LABEL_COLUMNS = 26;
const ENTITY_KINDS = new Set(["goal", "document", "area", "link", "brain", "agent", "person", "request", "commit", "evidence", "resource"]);

/** Returns a stable positive Excalidraw seed for one authored id. */
function seedFor(id) {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0 || 1;
}

/** Creates the fields shared by Excalidraw elements made by Tangent. */
function elementBase(id, type, geometry = {}) {
  return {
    id, type,
    x: Number(geometry.x ?? 0), y: Number(geometry.y ?? 0),
    width: Math.max(1, Number(geometry.width ?? 1)), height: Math.max(1, Number(geometry.height ?? 1)),
    angle: Number(geometry.angle ?? 0), strokeColor: geometry.strokeColor ?? INK,
    backgroundColor: geometry.backgroundColor ?? "transparent", fillStyle: geometry.fillStyle ?? "solid",
    strokeWidth: Number(geometry.strokeWidth ?? 2), strokeStyle: geometry.strokeStyle ?? "solid",
    roughness: Number(geometry.roughness ?? 1), opacity: Number(geometry.opacity ?? 100),
    groupIds: Array.isArray(geometry.groupIds) ? [...geometry.groupIds] : [], frameId: geometry.frameId ?? null,
    index: geometry.index ?? null, roundness: geometry.roundness ?? null, seed: Number(geometry.seed ?? seedFor(id)),
    version: Number(geometry.version ?? 1), versionNonce: Number(geometry.versionNonce ?? seedFor(`${id}:version`)),
    isDeleted: Boolean(geometry.isDeleted), boundElements: geometry.boundElements ? structuredClone(geometry.boundElements) : null,
    updated: Number(geometry.updated ?? 1), link: geometry.link ?? null, locked: Boolean(geometry.locked),
  };
}

/** Creates one editable Excalidraw text element. */
function createTextElement({ id, text, x = 0, y = 0, width = 220, height = 48, containerId = null, frameId = null, boundElements = null, style = {} }) {
  const value = String(text ?? "");
  return {
    ...elementBase(id, "text", { x, y, width, height, frameId, boundElements, strokeColor: style.strokeColor ?? INK, roughness: 0, ...style }),
    fontSize: Number(style.fontSize ?? 20), fontFamily: Number(style.fontFamily ?? 5), text: value,
    textAlign: style.textAlign ?? (containerId ? "center" : "left"), verticalAlign: style.verticalAlign ?? (containerId ? "middle" : "top"),
    containerId, originalText: value, autoResize: style.autoResize ?? true, lineHeight: Number(style.lineHeight ?? 1.25),
  };
}

/** Creates one normal Excalidraw shape or frame. */
function createShapeElement({ id, type = "rectangle", x = 0, y = 0, width = 200, height = 100, name = null, frameId = null, style = {}, customData = null, boundElements = null }) {
  const shape = {
    ...elementBase(id, type, {
      x, y, width, height, frameId,
      backgroundColor: style.backgroundColor ?? (type === "frame" ? "transparent" : BLOCK_FILL),
      strokeColor: style.strokeColor ?? BLOCK_STROKE, roundness: type === "rectangle" ? { type: 3 } : null,
      boundElements, ...style,
    }),
  };
  if (type === "frame") shape.name = name || "Frame";
  if (customData) shape.customData = structuredClone(customData);
  return shape;
}

/** Creates an empty scene with authored content but no persisted viewport. */
function createEmptyScene() {
  return { type: "excalidraw", version: 2, source: TANGENT_SOURCE, elements: [], appState: { viewBackgroundColor: CANVAS }, files: {}, tangent: { format: 2 } };
}

/** Returns the normal Tangent metadata on one connectable block. */
function tangentOf(element) {
  const tangent = element?.customData?.tangent;
  return tangent && ENTITY_KINDS.has(tangent.kind) && typeof tangent.ref === "string" ? tangent : null;
}

/** Returns one Tangent element's explicit spatial role. */
function spatialRole(element) { return element?.customData?.tangent?.role ?? ""; }
/** Reports whether an element represents a direct-child Area region. */
function isAreaRegion(element) { return tangentOf(element)?.kind === "area" && spatialRole(element) === "region"; }
/** Reports whether an element is the boundary owned by its Area file. */
function isAreaBoundary(element) { return spatialRole(element) === "boundary"; }

/** Infers a first-release entity kind for one vault reference. */
function kindForReference(ref) {
  if (/^https?:\/\//i.test(ref)) return "link";
  const file = ref.split("#")[0];
  if (/(^|\/)goal-[^/]+\.md$/.test(file)) return "goal";
  const parent = file.replace(/\/[^/]+$/, "");
  const leaf = parent.split("/").pop();
  if (leaf && file === `${parent}/${leaf}.md`) return "area";
  return "document";
}

/** Splits a Tangent reference into the vault file and optional subpath. */
function splitReference(ref) {
  if (/^https?:\/\//i.test(ref)) return { url: ref };
  const index = ref.indexOf("#");
  return index < 0 ? { file: ref } : { file: ref.slice(0, index), subpath: ref.slice(index) };
}

/** Returns the authoritative Area path represented by one Tangent block. */
function areaForBlock(element, documents = [], sourceOwner = null) {
  const tangent = tangentOf(element);
  if (!tangent) return "";
  const owner = String(sourceOwner?.owner ?? sourceOwner ?? element?.customData?.tangentWorld?.owner ?? "");
  if (["link", "resource"].includes(tangent.kind)) return owner === "@root" ? "" : owner;
  const file = splitReference(tangent.ref).file ?? "";
  if (tangent.kind === "area") return file.replace(/\/[^/]+\.md$/, "");
  return documents.find((item) => item.file === file)?.area ?? file.replace(/\/[^/]+$/, "");
}

/** True when a block stays visible under the shared Work Focus switches. */
function blockMatchesFocus(element, documents, focus = {}, locatedArea = "") {
  const area = areaForBlock(element, documents);
  if (!area) return true;
  const onLocatedPath = area === locatedArea || String(locatedArea).startsWith(`${area}/`);
  const starred = !focus.only || !(focus.areas ?? []).length || focus.areas.some((root) => area === root || area.startsWith(`${root}/`));
  const fact = factForBlock(element, documents);
  const active = !focus.activeOnly || Boolean(fact?.live);
  return onLocatedPath || starred && active;
}

/** Packs pieces into lines of at most `columns` characters so a block label fits its block instead of being clipped. */
function wrapLabelLine(line, separator = " ", columns = LABEL_COLUMNS) {
  const lines = [];
  let current = "";
  for (const piece of String(line).split(separator).map((part) => part.trim()).filter(Boolean)) {
    if (current && `${current}${separator}${piece}`.length > columns) { lines.push(current); current = piece; }
    else current = current ? `${current}${separator}${piece}` : piece;
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/** Formats the visible, replaceable fact cache inside a Tangent block. */
function blockLabel(fact) {
  const badge = `${String(fact.kind || "document").toUpperCase()}${fact.live ? "  ●" : ""}`;
  return [badge, wrapLabelLine(fact.title || "Untitled"), wrapLabelLine(fact.status || "", " · ")].filter(Boolean).join("\n");
}
/** Formats the compact one-line label bound to an Area region. */
function regionLabel(fact) {
  return `${fact.title || "Untitled"}${fact.live ? " ★" : ""}${fact.status ? ` · ${fact.status}` : ""}`;
}

/** Creates a connectable shape and its fact-cache text. */
function createBlockElements({ id, kind, ref, title = ref, status = "", x = 0, y = 0, width = BLOCK_WIDTH, height = BLOCK_HEIGHT, style = {} }) {
  const blockId = String(id);
  const textId = `${blockId}-tangent-label`;
  const fact = { kind: ENTITY_KINDS.has(kind) ? kind : kindForReference(ref), title: String(title || ref), status: String(status || "") };
  const block = createShapeElement({ id: blockId, type: "rectangle", x, y, width, height, style, customData: { tangent: { kind: fact.kind, ref: String(ref) } }, boundElements: [{ id: textId, type: "text" }] });
  const text = createTextElement({ id: textId, text: blockLabel(fact), x: x + 14, y: y + 16, width: Math.max(40, width - 28), height: Math.max(36, height - 32), containerId: blockId, style: { fontSize: 18, strokeColor: INK } });
  return [block, text];
}

/** Creates a direct-child Area region with optional forward-compatible layout intent. */
function createRegionElements({ id, ref, title = ref, status = "", x = 0, y = 0, width = REGION_SIZES.medium.width, height = REGION_SIZES.medium.height, style = {}, layout = null }) {
  const regionId = String(id);
  const textId = `${regionId}-tangent-label`;
  const tangent = { kind: "area", ref: String(ref), role: "region", ...(layout ? { layout: structuredClone(layout) } : {}) };
  const block = createShapeElement({ id: regionId, type: "rectangle", x, y, width, height, style: { backgroundColor: "transparent", strokeColor: "#4c6ef5", ...style }, customData: { tangent }, boundElements: [{ id: textId, type: "text" }] });
  const text = createTextElement({ id: textId, text: regionLabel({ title, status }), x: x + 14, y: y + 8, width: Math.max(80, width - 28), height: LABEL_BAND - 8, containerId: regionId, style: { fontSize: 20, textAlign: "left", verticalAlign: "top", strokeColor: INK } });
  return [block, text];
}

/** Creates the one authored boundary for an Area file. */
function createAreaBoundary(area, bounds = {}) {
  return createShapeElement({ id: `tangent-boundary-${seedFor(area)}`, type: "rectangle", x: bounds.x ?? 0, y: bounds.y ?? 0, width: bounds.width ?? 1200, height: bounds.height ?? 800, style: { backgroundColor: "transparent", strokeColor: "#868e96", strokeStyle: "dashed", strokeWidth: 1 }, customData: { tangent: { kind: "area", ref: `${area}/${area.split("/").pop()}.md`, role: "boundary" } } });
}

/** Resolves one Tangent block without treating its cached text as authority. */
function factForBlock(element, documents = []) {
  const tangent = tangentOf(element);
  if (!tangent) return null;
  if (tangent.role === "boundary") return null;
  if (tangent.kind === "resource") return { kind: "resource", title: "Map resource", status: "unresolved", ghost: true, ref: tangent.ref };
  if (tangent.kind === "link") {
    let host = tangent.ref;
    try { host = new URL(tangent.ref).host; } catch {}
    return { kind: "link", title: host || tangent.ref, status: tangent.ref, ghost: false, ref: tangent.ref };
  }
  const source = splitReference(tangent.ref);
  const document = documents.find((item) => item.file === source.file);
  if (!document) return { kind: tangent.kind, title: source.file || tangent.ref, status: "gone", ghost: true, ref: tangent.ref };
  const title = document.title || document.name || source.file;
  const statusWords = [];
  if (document.status === "verify" || document.verify && document.status === "done") statusWords.push("Check it");
  else if (document.status) statusWords.push(document.status);
  const live = Boolean(document.live || document.sessionState === "live");
  if (live) statusWords.push("live");
  if (document.stale || document.olderThanNotes) statusWords.push("older than the notes");
  return { kind: tangent.kind, title, status: statusWords.join(" · "), ghost: false, live, ref: tangent.ref };
}

/** Refreshes only fact-cache words and ghost styling, never authored geometry. */
function refreshTangentFacts(scene, documents = []) {
  const next = structuredClone(scene);
  const byId = new Map(next.elements.map((element) => [element.id, element]));
  const referenceCounts = new Map();
  for (const element of next.elements) {
    const tangent = !element.isDeleted && tangentOf(element);
    if (tangent) {
      const owner = tangent.kind === "resource" ? element.customData?.tangentWorld?.owner ?? "" : "";
      const key = `${owner}\u0000${tangent.kind}:${tangent.ref}`;
      referenceCounts.set(key, (referenceCounts.get(key) ?? 0) + 1);
    }
  }
  let changed = false;
  for (const block of next.elements) {
    let fact = factForBlock(block, documents);
    if (!fact) continue;
    const tangentOwner = block.customData.tangent.kind === "resource" ? block.customData?.tangentWorld?.owner ?? "" : "";
    const tangentKey = `${tangentOwner}\u0000${block.customData.tangent.kind}:${block.customData.tangent.ref}`;
    if (!block.isDeleted && referenceCounts.get(tangentKey) > 1) fact = { ...fact, status: [fact.status, "duplicate"].filter(Boolean).join(" · ") };
    const label = block.boundElements?.find((entry) => entry.type === "text");
    const text = label ? byId.get(label.id) : null;
    const words = isAreaRegion(block) ? regionLabel(fact) : blockLabel(fact);
    if (text?.type === "text" && (text.text !== words || text.originalText !== words)) {
      text.text = words; text.originalText = words; text.version = Number(text.version || 0) + 1;
      text.versionNonce = seedFor(`${text.id}:${text.version}:${words}`); changed = true;
    }
    if (text?.type === "text" && isAreaRegion(block)) {
      Object.assign(text, { fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", lineHeight: 1.25, x: block.x + 14, y: block.y + 8, width: Math.max(80, block.width - 28), height: LABEL_BAND - 8 });
    }
    const tangent = { ...block.customData.tangent };
    const wasGhost = tangent.ghost === true;
    let blockChanged = false;
    if (fact.ghost && !wasGhost) {
      tangent.inkStrokeStyle = block.strokeStyle ?? "solid";
      tangent.ghost = true;
      blockChanged = true;
    } else if (!fact.ghost && wasGhost) {
      delete tangent.ghost;
      blockChanged = true;
    }
    const desiredStyle = fact.ghost ? "dashed" : (tangent.inkStrokeStyle ?? block.strokeStyle ?? "solid");
    if (block.strokeStyle !== desiredStyle) { block.strokeStyle = desiredStyle; blockChanged = true; }
    if (!fact.ghost) delete tangent.inkStrokeStyle;
    block.customData = { ...(block.customData || {}), tangent };
    if (blockChanged) {
      block.version = Number(block.version || 0) + 1;
      block.versionNonce = seedFor(`${block.id}:facts:${block.version}:${fact.ghost}`);
      changed = true;
    }
  }
  return { scene: next, changed };
}

/** Returns Area-scoped choices for the Block picker. */
function entityChoices(area, documents = []) {
  const choices = [];
  const seen = new Set();
  for (const document of documents) {
    if (!document?.file || !(document.file === `${area}/${area.split("/").pop()}.md` || document.file.startsWith(`${area}/`))) continue;
    const ref = document.file;
    const kind = document.kind === "goal" || document.goal ? "goal" : kindForReference(ref);
    const key = `${kind}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const itemArea = kind === "area" ? document.area || ref.replace(/\/[^/]+\.md$/, "") : document.area || ref.replace(/\/[^/]+$/, "");
    const directChild = kind === "area" && itemArea.startsWith(`${area}/`) && !itemArea.slice(area.length + 1).includes("/");
    choices.push({ kind, ref, title: document.title || document.name || ref, status: document.status || "", area: itemArea, directChild });
  }
  return choices.sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
}

/** Splits picker facts into direct child Areas and records owned by this Area. */
function scopedEntities(area, documents = []) {
  const choices = entityChoices(area, documents);
  return { children: choices.filter((choice) => choice.kind === "area" && choice.directChild), own: choices.filter((choice) => choice.kind !== "area" && choice.area === area) };
}

/** Selects a first-arrange region size from authoritative child weight. */
function regionSize(choice, documents = []) {
  const childArea = choice.area;
  const hasChildren = documents.some((item) => item.kind === "area" && item.area?.startsWith(`${childArea}/`) && !item.area.slice(childArea.length + 1).includes("/"));
  const openGoals = documents.filter((item) => (item.kind === "goal" || item.goal) && item.area === childArea && !["done", "dropped"].includes(item.status)).length;
  return hasChildren || openGoals > 5 ? REGION_SIZES.large : openGoals ? REGION_SIZES.medium : REGION_SIZES.small;
}

/** Adds the one initial boundary without changing an existing boundary. */
function withBoundary(scene, area) {
  if ((scene.elements ?? []).some(isAreaBoundary)) return scene;
  const next = structuredClone(scene);
  const visible = next.elements.filter((element) => !element.isDeleted && element.type !== "text");
  const minX = visible.length ? Math.min(...visible.map((element) => element.x)) : 0;
  const minY = visible.length ? Math.min(...visible.map((element) => element.y)) : 0;
  const maxX = visible.length ? Math.max(...visible.map((element) => element.x + element.width)) : 1040;
  const maxY = visible.length ? Math.max(...visible.map((element) => element.y + element.height)) : 640;
  next.elements.unshift(createAreaBoundary(area, { x: minX - BOUNDARY_MARGIN, y: minY - BOUNDARY_MARGIN, width: Math.max(600, maxX - minX + BOUNDARY_MARGIN * 2), height: Math.max(440, maxY - minY + BOUNDARY_MARGIN * 2) }));
  return next;
}

/** Converts Area cards once while preserving their position, style, ink, and ids. */
function migrateAreaCardsToRegions(scene, area, documents = []) {
  if (!scene || (scene.elements ?? []).some(isAreaBoundary)) return { scene, changed: false };
  const next = structuredClone(scene);
  const direct = new Set(scopedEntities(area, documents).children.map((choice) => choice.ref));
  const byId = new Map(next.elements.map((element) => [element.id, element]));
  let changed = false;
  for (let index = 0; index < next.elements.length; index += 1) {
    const card = next.elements[index];
    const tangent = tangentOf(card);
    if (tangent?.kind !== "area" || tangent.role) continue;
    if (direct.has(tangent.ref)) {
      const fact = factForBlock(card, documents);
      const [region, label] = createRegionElements({ id: card.id, ref: tangent.ref, title: fact?.title, status: fact?.status, x: card.x, y: card.y, width: REGION_SIZES.medium.width, height: REGION_SIZES.medium.height, style: card });
      const oldLabelId = card.boundElements?.find((binding) => binding.type === "text")?.id;
      next.elements[index] = region;
      if (oldLabelId && byId.has(oldLabelId)) next.elements[next.elements.findIndex((element) => element.id === oldLabelId)] = label;
      else next.elements.push(label);
      changed = true;
    } else {
      card.customData.tangent.role = "shortcut";
      card.opacity = Math.min(Number(card.opacity ?? 100), 70);
      changed = true;
    }
  }
  const bounded = withBoundary(next, area);
  return { scene: bounded, changed: changed || bounded !== next };
}

/** Finds a block reference in pasted or picker text. Plain prose returns null. */
function referenceFromText(text, choices = []) {
  const value = String(text ?? "").trim();
  if (!value || value.includes("\n")) return null;
  if (/^https?:\/\/\S+$/i.test(value)) return { kind: "link", ref: value, title: value };
  const wiki = value.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  const normalized = wiki ? wiki[1] : value;
  const exact = choices.find((choice) => choice.ref === normalized || choice.ref.replace(/\.md$/, "") === normalized || choice.ref.split("/").pop()?.replace(/^goal-/, "").replace(/\.md$/, "") === normalized);
  if (exact) return exact;
  if (/^(?:[\w.-]+\/)+[\w .@#^-]+\.md(?:#\S+)?$/.test(normalized)) return { kind: kindForReference(normalized), ref: normalized, title: normalized.split("/").pop().replace(/\.md(?:#.*)?$/, "") };
  return null;
}

/** Returns a scene save payload without selection, scroll, or zoom state. */
function sceneForSave(elements, appState = {}) {
  return {
    type: "excalidraw", version: 2, source: TANGENT_SOURCE, elements: structuredClone(elements),
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor || CANVAS,
      ...(Number.isFinite(appState.gridSize) ? { gridSize: appState.gridSize } : {}),
      ...(Number.isFinite(appState.gridStep) ? { gridStep: appState.gridStep } : {}),
      ...(typeof appState.gridModeEnabled === "boolean" ? { gridModeEnabled: appState.gridModeEnabled } : {}),
      ...(typeof appState.objectsSnapModeEnabled === "boolean" ? { objectsSnapModeEnabled: appState.objectsSnapModeEnabled } : {}),
    }, files: {}, tangent: { format: 2 },
  };
}

/** Dark-theme colours that earlier Tangent builds stored, mapped to the light-theme colours Excalidraw expects. */
const LEGACY_COLORS = new Map([["#121216", CANVAS], ["#e9ecef", INK], ["#f1f3f5", INK], ["#1e1e2e", BLOCK_FILL], ["#a5d8ff", BLOCK_STROKE]]);

/**
 * Rewrites a scene saved with dark-theme colours into Excalidraw's stored
 * light-theme colours. Earlier builds stored the dark colours and also ran
 * the dark theme, so Excalidraw inverted them: near-white canvas, and the
 * default ink (#1e1e1e) drawn white on it. Runs once on load; a scene that
 * already stores the light canvas is returned unchanged.
 */
function normalizeSceneColors(scene) {
  if (!scene || scene.appState?.viewBackgroundColor !== "#121216") return { scene, changed: false };
  const next = structuredClone(scene);
  next.appState = { ...next.appState, viewBackgroundColor: CANVAS };
  delete next.appState.theme;
  for (const element of next.elements ?? []) {
    element.strokeColor = LEGACY_COLORS.get(element.strokeColor) ?? element.strokeColor;
    element.backgroundColor = LEGACY_COLORS.get(element.backgroundColor) ?? element.backgroundColor;
  }
  return { scene: next, changed: true };
}

/** Returns a stable content signal; view and selection changes do not affect it. */
function authoredFingerprint(elements) {
  const transient = new Set(["index", "version", "versionNonce", "updated", "seed"]);
  /** Removes transient Excalidraw fields recursively. */
  const clean = (value, key = "") => {
    if (transient.has(key)) return undefined;
    if (typeof value === "number" && ["x", "y", "width", "height", "angle"].includes(key)) return Math.round(value * 1000) / 1000;
    if (Array.isArray(value)) return value.map((item) => clean(item)).filter((item) => item !== undefined);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name)]).filter(([, item]) => item !== undefined));
    return value;
  };
  return JSON.stringify((elements ?? []).filter((element) => !element?.customData?.tangentWorldEphemeral).map((element) => clean(element)));
}

/** Converts an old auto-arranged scene while preserving authored positions and ink. */
function convertToBlankSlate(scene, area, documents = [], baseline = null) {
  if (Number(scene?.tangent?.format ?? 0) >= 2) return { scene, changed: false, kept: 0, retired: 0, inboxed: [] };
  const source = structuredClone(scene ?? createEmptyScene());
  const direct = new Set(scopedEntities(area, documents).children.map((choice) => choice.ref));
  const removed = new Set(); const kept = []; const inboxed = [];
  for (const element of source.elements ?? []) {
    if (element.isDeleted) { removed.add(element.id); continue; }
    const tangent = tangentOf(element);
    if (!tangent || isAreaBoundary(element)) { kept.push(element); continue; }
    const ownRef = `${area}/${area.split("/").at(-1)}.md`;
    if (tangent.kind === "area" && tangent.ref === ownRef) { removed.add(element.id); continue; }
    const original = baseline?.[element.id];
    const automatic = original && Math.abs(element.x - original.x) < 1 && Math.abs(element.y - original.y) < 1;
    if (automatic) { removed.add(element.id); if (direct.has(tangent.ref)) inboxed.push(tangent.ref); continue; }
    if (tangent.kind === "area" && direct.has(tangent.ref) && !isAreaRegion(element)) {
      const fact = factForBlock(element, documents);
      const [region, label] = createRegionElements({ id: element.id, ref: tangent.ref, title: fact?.title, status: fact?.status, x: element.x, y: element.y, width: element.width, height: element.height, style: element });
      kept.push(region, label); removed.add(element.boundElements?.find((item) => item.type === "text")?.id);
    } else { if (tangent.kind === "area") element.customData.tangent.role ||= "shortcut"; kept.push(element); }
  }
  const keptIds = new Set(kept.map((element) => element.id));
  source.elements = kept.filter((element) => !element.containerId || keptIds.has(element.containerId));
  source.elements = withBoundary(source, area).elements;
  source.tangent = { ...(source.tangent ?? {}), format: 2 };
  return { scene: source, changed: true, kept: source.elements.filter((element) => !isAreaBoundary(element)).length, retired: removed.size, inboxed: [...new Set(inboxed)] };
}

/** Applies disposable viewport state to an editor app state. */
function appStateWithView(appState = {}, view = null) {
  if (!view) return { ...appState };
  const zoom = Number(view.zoom);
  return {
    ...appState,
    scrollX: Number(view.pan?.x ?? 0),
    scrollY: Number(view.pan?.y ?? 0),
    ...(Number.isFinite(zoom) && zoom > 0 ? { zoom: { value: zoom } } : {}),
  };
}

/** Projects an Excalidraw viewport into the shell-owned Area view record. */
function viewFromAppState(appState = {}, previous = {}) {
  const base = previous ?? {};
  return {
    schema: "area-board-view.v1",
    pan: { x: Number(appState.scrollX ?? 0), y: Number(appState.scrollY ?? 0) },
    zoom: Number(appState.zoom?.value ?? appState.zoom ?? 1) || 1,
    foldedGroupIds: base.foldedGroupIds ?? [],
    openInlineAreaNodeIds: base.openInlineAreaNodeIds ?? [],
    hiddenKinds: base.hiddenKinds ?? [],
    showDone: base.showDone ?? false,
    ...(Number.isFinite(base.scopeProxy?.x) && Number.isFinite(base.scopeProxy?.y) ? { scopeProxy: { x: base.scopeProxy.x, y: base.scopeProxy.y } } : {}),
  };
}

/** Returns the scene point under the last pointer, or the viewport center. */
function insertionPoint(appState = {}, pointer = null) {
  if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) return pointer;
  const zoom = Number(appState.zoom?.value ?? appState.zoom ?? 1) || 1;
  return { x: -Number(appState.scrollX || 0) + Number(appState.width || 900) / (2 * zoom), y: -Number(appState.scrollY || 0) + Number(appState.height || 600) / (2 * zoom) };
}

/** Adds one Tangent block while preserving the scene's current z-order. */
function addBlock(scene, choice, point, id = globalThis.crypto?.randomUUID?.() ?? `block-${Date.now()}`) {
  const next = structuredClone(scene);
  next.elements.push(...createBlockElements({ id, ...choice, x: Number(point?.x ?? 0) - BLOCK_WIDTH / 2, y: Number(point?.y ?? 0) - BLOCK_HEIGHT / 2 }));
  return next;
}

/** Hides or restores a block and its bound text without deleting other ink. */
function setBlockHidden(scene, blockId, hidden) {
  const next = structuredClone(scene);
  const block = next.elements.find((element) => element.id === blockId && tangentOf(element));
  if (!block) return next;
  const ids = new Set([block.id, ...(block.boundElements || []).filter((entry) => entry.type === "text").map((entry) => entry.id)]);
  for (const element of next.elements) if (ids.has(element.id)) {
    element.isDeleted = hidden; element.version = Number(element.version || 0) + 1;
    element.versionNonce = seedFor(`${element.id}:hidden:${hidden}:${element.version}`);
  }
  return next;
}

/** Returns the source IDs of each hidden resource Block and its bound label. */
function hiddenResourceRecordIds(scene) {
  const ids = new Set();
  for (const element of scene?.elements ?? []) {
    if (!element?.isDeleted || tangentOf(element)?.kind !== "resource") continue;
    ids.add(element.id);
    for (const binding of element.boundElements ?? []) if (binding?.type === "text" && typeof binding.id === "string") ids.add(binding.id);
  }
  return ids;
}

/** Lists screen-reader and outline entries in spatial reading order. */
function sceneOutline(scene, documents = []) {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const named = [];
  for (const element of elements) {
    const fact = factForBlock(element, documents);
    if (fact) named.push({ id: element.id, x: element.x, y: element.y, label: `${fact.kind}: ${fact.title}${fact.status ? `, ${fact.status}` : ""}` });
    else if (element.type === "text" && !element.containerId) named.push({ id: element.id, x: element.x, y: element.y, label: `note: ${element.text}` });
    else if (element.type === "arrow") {
      const start = byId.get(element.startBinding?.elementId); const end = byId.get(element.endBinding?.elementId);
      if (start && end) {
        const startFact = factForBlock(start, documents); const endFact = factForBlock(end, documents);
        named.push({ id: element.id, x: element.x, y: element.y, label: `${startFact?.title || start.id} ${element.customData?.label || "points to"} ${endFact?.title || end.id}` });
      }
    }
  }
  return named.sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
}

/** Converts the former standards-only JSON Canvas into one Excalidraw scene. */
function legacyCanvasToExcalidraw(canvas) {
  const scene = createEmptyScene();
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas?.edges) ? canvas.edges : [];
  const groups = nodes.filter((node) => node.type === "group");
  /** Finds the smallest legacy group that fully contains a node. */
  const containingFrame = (node) => groups.filter((group) => node.id !== group.id && node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height).sort((left, right) => left.width * left.height - right.width * right.height)[0]?.id ?? null;
  const arrowBindings = new Map();
  for (const edge of edges) for (const id of [edge.fromNode, edge.toNode]) { const list = arrowBindings.get(id) ?? []; list.push({ id: edge.id, type: "arrow" }); arrowBindings.set(id, list); }
  for (const node of nodes) {
    const frameId = containingFrame(node);
    if (node.type === "group") scene.elements.push(createShapeElement({ id: node.id, type: "frame", x: node.x, y: node.y, width: node.width, height: node.height, name: node.label || "Frame", style: { strokeColor: node.color || "#868e96" }, boundElements: arrowBindings.get(node.id) ?? null }));
    else if (node.type === "text") scene.elements.push(createTextElement({ id: node.id, text: node.text, x: node.x, y: node.y, width: node.width, height: node.height, frameId, boundElements: arrowBindings.get(node.id) ?? null, style: { strokeColor: node.color || INK } }));
    else if (node.type === "file" || node.type === "link") {
      const ref = node.type === "file" ? `${node.file}${node.subpath || ""}` : node.url;
      const kind = node.type === "link" ? "link" : kindForReference(ref);
      const [block, text] = createBlockElements({ id: node.id, kind, ref, title: node.type === "file" ? node.file : node.url, x: node.x, y: node.y, width: node.width, height: node.height, style: { strokeColor: node.color || BLOCK_STROKE } });
      block.frameId = frameId; text.frameId = frameId; block.boundElements.push(...(arrowBindings.get(node.id) ?? [])); scene.elements.push(block, text);
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = nodeById.get(edge.fromNode); const to = nodeById.get(edge.toNode);
    if (!from || !to) continue;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }; const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const arrow = {
      ...elementBase(edge.id, "arrow", { x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), strokeColor: edge.color || INK }),
      points: [[0, 0], [end.x - start.x, end.y - start.y]], lastCommittedPoint: null,
      startBinding: { elementId: edge.fromNode, focus: 0, gap: 1, fixedPoint: null }, endBinding: { elementId: edge.toNode, focus: 0, gap: 1, fixedPoint: null },
      startArrowhead: edge.fromEnd === "arrow" ? "arrow" : null, endArrowhead: edge.toEnd === "none" ? null : "arrow", elbowed: false,
    };
    if (edge.label) {
      const labelId = `${edge.id}-label`;
      arrow.customData = { label: edge.label };
      arrow.boundElements = [{ id: labelId, type: "text" }];
      scene.elements.push(arrow, createTextElement({
        id: labelId, text: edge.label, containerId: edge.id,
        x: start.x + (end.x - start.x) / 2 - 50, y: start.y + (end.y - start.y) / 2 - 16,
        width: 100, height: 32, style: { fontSize: 16, strokeColor: edge.color || INK },
      }));
    } else scene.elements.push(arrow);
  }
  return scene;
}

const api = { addBlock, appStateWithView, areaForBlock, authoredFingerprint, blockLabel, blockMatchesFocus, convertToBlankSlate, createAreaBoundary, createBlockElements, createEmptyScene, createRegionElements, createShapeElement, createTextElement, entityChoices, factForBlock, hiddenResourceRecordIds, insertionPoint, isAreaBoundary, isAreaRegion, kindForReference, legacyCanvasToExcalidraw, migrateAreaCardsToRegions, normalizeSceneColors, referenceFromText, refreshTangentFacts, regionSize, sceneForSave, sceneOutline, scopedEntities, setBlockHidden, spatialRole, splitReference, tangentOf, viewFromAppState, withBoundary };
export { addBlock, appStateWithView, areaForBlock, authoredFingerprint, blockLabel, blockMatchesFocus, convertToBlankSlate, createAreaBoundary, createBlockElements, createEmptyScene, createRegionElements, createShapeElement, createTextElement, entityChoices, factForBlock, hiddenResourceRecordIds, insertionPoint, isAreaBoundary, isAreaRegion, kindForReference, legacyCanvasToExcalidraw, migrateAreaCardsToRegions, normalizeSceneColors, referenceFromText, refreshTangentFacts, regionSize, sceneForSave, sceneOutline, scopedEntities, setBlockHidden, spatialRole, splitReference, tangentOf, viewFromAppState, withBoundary };
export default api;
