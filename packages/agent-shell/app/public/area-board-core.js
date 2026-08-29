const TANGENT_SOURCE = "https://tangent.local/area-map";
const BLOCK_WIDTH = 280;
const BLOCK_HEIGHT = 132;
const ENTITY_KINDS = new Set(["goal", "document", "area", "link", "idea", "brain", "agent", "person", "request", "commit", "evidence"]);

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
    angle: Number(geometry.angle ?? 0), strokeColor: geometry.strokeColor ?? "#e9ecef",
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
    ...elementBase(id, "text", { x, y, width, height, frameId, boundElements, strokeColor: style.strokeColor ?? "#e9ecef", roughness: 0, ...style }),
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
      backgroundColor: style.backgroundColor ?? (type === "frame" ? "transparent" : "#1e1e2e"),
      strokeColor: style.strokeColor ?? "#a5d8ff", roundness: type === "rectangle" ? { type: 3 } : null,
      boundElements, ...style,
    }),
  };
  if (type === "frame") shape.name = name || "Frame";
  if (customData) shape.customData = structuredClone(customData);
  return shape;
}

/** Creates an empty scene with authored content but no persisted viewport. */
function createEmptyScene() {
  return { type: "excalidraw", version: 2, source: TANGENT_SOURCE, elements: [], appState: { theme: "dark", viewBackgroundColor: "#121216" }, files: {} };
}

/** Returns the normal Tangent metadata on one connectable block. */
function tangentOf(element) {
  const tangent = element?.customData?.tangent;
  return tangent && ENTITY_KINDS.has(tangent.kind) && typeof tangent.ref === "string" ? tangent : null;
}

/** Infers a first-release entity kind for one vault reference. */
function kindForReference(ref) {
  if (/^https?:\/\//i.test(ref)) return "link";
  const file = ref.split("#")[0];
  if (/(^|\/)goal-[^/]+\.md$/.test(file)) return "goal";
  if (/(^|\/)ideas\.md$/.test(file)) return "idea";
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

/** Formats the visible, replaceable fact cache inside a Tangent block. */
function blockLabel(fact) {
  const badge = `${String(fact.kind || "document").toUpperCase()}${fact.live ? "  ●" : ""}`;
  return [badge, String(fact.title || "Untitled"), String(fact.status || "")].filter(Boolean).join("\n");
}

/** Creates a connectable shape and its fact-cache text. */
function createBlockElements({ id, kind, ref, title = ref, status = "", x = 0, y = 0, width = BLOCK_WIDTH, height = BLOCK_HEIGHT, style = {} }) {
  const blockId = String(id);
  const textId = `${blockId}-tangent-label`;
  const fact = { kind: ENTITY_KINDS.has(kind) ? kind : kindForReference(ref), title: String(title || ref), status: String(status || "") };
  const block = createShapeElement({ id: blockId, type: "rectangle", x, y, width, height, style, customData: { tangent: { kind: fact.kind, ref: String(ref) } }, boundElements: [{ id: textId, type: "text" }] });
  const text = createTextElement({ id: textId, text: blockLabel(fact), x: x + 14, y: y + 16, width: Math.max(40, width - 28), height: Math.max(36, height - 32), containerId: blockId, style: { fontSize: 18, strokeColor: "#f1f3f5" } });
  return [block, text];
}

/** Resolves one Tangent block without treating its cached text as authority. */
function factForBlock(element, documents = []) {
  const tangent = tangentOf(element);
  if (!tangent) return null;
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
    if (tangent) referenceCounts.set(`${tangent.kind}:${tangent.ref}`, (referenceCounts.get(`${tangent.kind}:${tangent.ref}`) ?? 0) + 1);
  }
  let changed = false;
  for (const block of next.elements) {
    let fact = factForBlock(block, documents);
    if (!fact) continue;
    const tangentKey = `${block.customData.tangent.kind}:${block.customData.tangent.ref}`;
    if (!block.isDeleted && referenceCounts.get(tangentKey) > 1) fact = { ...fact, status: [fact.status, "duplicate"].filter(Boolean).join(" · ") };
    const label = block.boundElements?.find((entry) => entry.type === "text");
    const text = label ? byId.get(label.id) : null;
    const words = blockLabel(fact);
    if (text?.type === "text" && (text.text !== words || text.originalText !== words)) {
      text.text = words; text.originalText = words; text.version = Number(text.version || 0) + 1;
      text.versionNonce = seedFor(`${text.id}:${text.version}:${words}`); changed = true;
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
    choices.push({ kind, ref, title: document.title || document.name || ref, status: document.status || "" });
  }
  return choices.sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
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
      theme: "dark", viewBackgroundColor: appState.viewBackgroundColor || "#121216",
      ...(Number.isFinite(appState.gridSize) ? { gridSize: appState.gridSize } : {}),
      ...(Number.isFinite(appState.gridStep) ? { gridStep: appState.gridStep } : {}),
      ...(typeof appState.gridModeEnabled === "boolean" ? { gridModeEnabled: appState.gridModeEnabled } : {}),
      ...(typeof appState.objectsSnapModeEnabled === "boolean" ? { objectsSnapModeEnabled: appState.objectsSnapModeEnabled } : {}),
    }, files: {},
  };
}

/** Returns a stable content signal; view and selection changes do not affect it. */
function authoredFingerprint(elements) { return JSON.stringify(elements); }

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
  return {
    schema: "area-board-view.v1",
    pan: { x: Number(appState.scrollX ?? 0), y: Number(appState.scrollY ?? 0) },
    zoom: Number(appState.zoom?.value ?? appState.zoom ?? 1) || 1,
    foldedGroupIds: previous.foldedGroupIds ?? [],
    openInlineAreaNodeIds: previous.openInlineAreaNodeIds ?? [],
    hiddenKinds: previous.hiddenKinds ?? [],
    showDone: previous.showDone ?? false,
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
    else if (node.type === "text") scene.elements.push(createTextElement({ id: node.id, text: node.text, x: node.x, y: node.y, width: node.width, height: node.height, frameId, boundElements: arrowBindings.get(node.id) ?? null, style: { strokeColor: node.color || "#e9ecef" } }));
    else if (node.type === "file" || node.type === "link") {
      const ref = node.type === "file" ? `${node.file}${node.subpath || ""}` : node.url;
      const kind = node.type === "link" ? "link" : kindForReference(ref);
      const [block, text] = createBlockElements({ id: node.id, kind, ref, title: node.type === "file" ? node.file : node.url, x: node.x, y: node.y, width: node.width, height: node.height, style: { strokeColor: node.color || "#a5d8ff" } });
      block.frameId = frameId; text.frameId = frameId; block.boundElements.push(...(arrowBindings.get(node.id) ?? [])); scene.elements.push(block, text);
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = nodeById.get(edge.fromNode); const to = nodeById.get(edge.toNode);
    if (!from || !to) continue;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }; const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const arrow = {
      ...elementBase(edge.id, "arrow", { x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), strokeColor: edge.color || "#e9ecef" }),
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
        width: 100, height: 32, style: { fontSize: 16, strokeColor: edge.color || "#e9ecef" },
      }));
    } else scene.elements.push(arrow);
  }
  return scene;
}

const api = { addBlock, appStateWithView, authoredFingerprint, blockLabel, createBlockElements, createEmptyScene, createShapeElement, createTextElement, entityChoices, factForBlock, insertionPoint, kindForReference, legacyCanvasToExcalidraw, referenceFromText, refreshTangentFacts, sceneForSave, sceneOutline, setBlockHidden, splitReference, tangentOf, viewFromAppState };
export { addBlock, appStateWithView, authoredFingerprint, blockLabel, createBlockElements, createEmptyScene, createShapeElement, createTextElement, entityChoices, factForBlock, insertionPoint, kindForReference, legacyCanvasToExcalidraw, referenceFromText, refreshTangentFacts, sceneForSave, sceneOutline, setBlockHidden, splitReference, tangentOf, viewFromAppState };
export default api;
