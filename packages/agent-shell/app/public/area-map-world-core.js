const LABEL_BAND = 40;
const CONTENT_MARGIN = 60;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

/** Returns one deterministic URL-safe token. */
function stableToken(value, length = 22) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const character of String(value)) {
    left = Math.imul(left ^ character.charCodeAt(0), 0x01000193);
    right = Math.imul(right ^ character.charCodeAt(0), 0x85ebca6b);
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    left = Math.imul(left ^ (right >>> 13), 0x5bd1e995);
    right = Math.imul(right ^ (left >>> 15), 0x27d4eb2d);
    bytes[index] = (left ^ right) >>> ((index % 4) * 8);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "").slice(0, length);
}

/** Joins a shard owner and source ID without collisions. */
export const elementKey = (owner, sourceId) => `${owner}\u0000${sourceId}`;
/** Returns the world ID for one source element. */
export const runtimeId = (owner, sourceId) => `tw-${stableToken(elementKey(owner, sourceId))}`;
/** Returns the stable source ID for one Area region. */
export const regionId = (parent, child) => `tangent-region-${stableToken(`${parent}>${child}`)}`;
/** Returns the stable key for one parent-child edge. */
export const regionKey = (parent, child) => `${parent}>${child}`;

/** Clones one JSON-compatible value. */
const clone = (value) => structuredClone(value);
/** Reports whether a value is a finite rectangle. */
const finiteRect = (value) => value && [value.x, value.y, value.width, value.height].every(Number.isFinite);
/** Rounds geometry to the world quantum. */
const quantize = (value) => Math.round(value * 100) / 100;
/** Copies and quantizes a rectangle. */
const rect = (value) => ({ x: quantize(value.x), y: quantize(value.y), width: quantize(value.width), height: quantize(value.height) });

/** Returns the smallest rectangle that contains all finite inputs. */
export function unionRects(values = []) {
  const valid = values.filter(finiteRect);
  if (!valid.length) return null;
  const x = Math.min(...valid.map((value) => value.x));
  const y = Math.min(...valid.map((value) => value.y));
  const right = Math.max(...valid.map((value) => value.x + value.width));
  const bottom = Math.max(...valid.map((value) => value.y + value.height));
  return rect({ x, y, width: right - x, height: bottom - y });
}

/** Adds equal breathing room around one rectangle. */
export function inflateRect(value, amount = CONTENT_MARGIN) {
  return value ? rect({ x: value.x - amount, y: value.y - amount, width: value.width + amount * 2, height: value.height + amount * 2 }) : null;
}

/** Rewrites every Excalidraw identity-bearing field. */
function rewriteIds(value, mapping) {
  if (Array.isArray(value)) return value.map((item) => rewriteIds(item, mapping));
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (["id", "elementId", "containerId", "frameId", "fileId"].includes(key) && typeof item === "string") next[key] = mapping.get(item) ?? item;
    else if (key === "groupIds" && Array.isArray(item)) next[key] = item.map((id) => mapping.get(`group:${id}`) ?? id);
    else next[key] = rewriteIds(item, mapping);
  }
  return next;
}

/** Converts one source shard into namespaced world elements. */
export function composeShard(owner, scene, offset = { x: 0, y: 0 }) {
  const elements = (scene?.elements ?? []).filter((element) => !element.isDeleted && element?.customData?.tangent?.role !== "boundary");
  const mapping = new Map();
  for (const element of elements) mapping.set(element.id, runtimeId(owner, element.id));
  for (const element of elements) for (const id of element.groupIds ?? []) mapping.set(`group:${id}`, runtimeId(owner, `group:${id}`));
  for (const id of Object.keys(scene?.files ?? {})) mapping.set(id, runtimeId(owner, `file:${id}`));
  const origins = new Map();
  const composed = elements.map((source) => {
    const runtime = rewriteIds(source, mapping);
    runtime.x = Number(runtime.x ?? 0) + Number(offset.x ?? 0);
    runtime.y = Number(runtime.y ?? 0) + Number(offset.y ?? 0);
    runtime.customData = { ...(runtime.customData ?? {}), tangentWorld: { owner, sourceId: source.id } };
    origins.set(runtime.id, { owner, sourceId: source.id });
    return runtime;
  });
  const files = Object.fromEntries(Object.entries(scene?.files ?? {}).map(([id, file]) => [mapping.get(id), clone(file)]));
  return { elements: composed, files, origins, mapping };
}

/** Converts world elements back into exact source-owner groups. */
export function splitComposed(elements, origins, offsets = new Map()) {
  const byOwner = new Map();
  const inverse = new Map([...origins].map(([runtime, source]) => [runtime, source.sourceId]));
  for (const runtime of elements ?? []) {
    const origin = origins.get(runtime.id) ?? runtime.customData?.tangentWorld;
    if (!origin) continue;
    const source = rewriteIds(runtime, inverse);
    const offset = offsets.get(origin.owner) ?? { x: 0, y: 0 };
    source.id = origin.sourceId;
    source.x = Number(source.x ?? 0) - Number(offset.x ?? 0);
    source.y = Number(source.y ?? 0) - Number(offset.y ?? 0);
    if (source.customData) { delete source.customData.tangentWorld; if (!Object.keys(source.customData).length) delete source.customData; }
    const list = byOwner.get(origin.owner) ?? [];
    list.push(source); byOwner.set(origin.owner, list);
  }
  return byOwner;
}

/** Creates deterministic stored or provisional regions for a complete Area list. */
export function provisionalRegions(areaKeys, stored = new Map()) {
  const children = new Map();
  for (const key of areaKeys) {
    const slash = key.lastIndexOf("/");
    const parent = slash < 0 ? "@root" : key.slice(0, slash);
    const list = children.get(parent) ?? []; list.push(key); children.set(parent, list);
  }
  const regions = new Map();
  for (const parent of [...children.keys()].sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))) {
    const values = children.get(parent);
    let x = 60; let y = 60; let rowHeight = 0;
    for (const child of values.sort()) {
      const saved = stored.get(regionKey(parent, child));
      const width = Math.max(MIN_WIDTH, Number(saved?.width ?? 460));
      const height = Math.max(MIN_HEIGHT, Number(saved?.height ?? 320));
      if (!saved && x > 60 && x + width > 1660) { x = 60; y += rowHeight + 60; rowHeight = 0; }
      const storedRect = rect(saved ?? { x, y, width, height });
      regions.set(child, { key: regionKey(parent, child), owner: parent, child, sourceId: regionId(parent, child), labelSourceId: `${regionId(parent, child)}-label`, source: saved ? "stored" : "provisional", storedRect });
      if (!saved) { x += width + 60; rowHeight = Math.max(rowHeight, height); }
    }
  }
  return regions;
}

/** Computes bottom-up stored, required, constraint, and drawn rectangles. */
export function computeWorldGeometry({ areas, regions, blockHulls = new Map(), inkHulls = new Map() }) {
  const result = new Map();
  const ordered = [...areas].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  for (const area of ordered) {
    const region = regions.get(area);
    const childRects = [...regions.values()].filter((entry) => entry.owner === area).map((entry) => result.get(entry.child)?.constraint).filter(Boolean);
    const required = unionRects([blockHulls.get(area), ...childRects]);
    const minimum = { x: region.storedRect.x, y: region.storedRect.y, width: Math.max(MIN_WIDTH, region.storedRect.width), height: Math.max(MIN_HEIGHT, region.storedRect.height, LABEL_BAND) };
    const translatedRequired = required && {
      x: region.storedRect.x + required.x,
      y: region.storedRect.y + LABEL_BAND + required.y,
      width: required.width,
      height: required.height,
    };
    const translatedInk = inkHulls.get(area) && {
      x: region.storedRect.x + inkHulls.get(area).x,
      y: region.storedRect.y + LABEL_BAND + inkHulls.get(area).y,
      width: inkHulls.get(area).width,
      height: inkHulls.get(area).height,
    };
    const constraint = unionRects([minimum, inflateRect(translatedRequired)]);
    result.set(area, { stored: rect(region.storedRect), required, constraint, drawn: unionRects([constraint, inflateRect(translatedInk)]) });
  }
  return result;
}

/** Reports strict rectangle overlap. */
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
/** Reports complete rectangle containment. */
function contains(parent, child) { return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height; }

/** Solves one gesture from its immutable pointer-down world snapshot. */
export function solveAreaMapGesture(baseline, intent) {
  const selected = new Set(intent.selectedAreas ?? []);
  const baseRegions = new Map([...baseline.regions].map(([key, value]) => [key, clone(value)]));
  const desired = { x: Number(intent.desiredWorldDelta?.x ?? 0), y: Number(intent.desiredWorldDelta?.y ?? 0) };
  const baselineGeometry = computeWorldGeometry({ ...baseline, regions: baseRegions });
  /** Evaluates one fraction of the desired pointer delta. */
  const evaluate = (factor) => {
    const regions = new Map([...baseRegions].map(([key, value]) => [key, clone(value)]));
    for (const area of selected) {
      const record = regions.get(area); if (!record) continue;
      if (intent.handle) {
        if (intent.handle.includes("e")) record.storedRect.width = Math.max(MIN_WIDTH, record.storedRect.width + desired.x * factor);
        if (intent.handle.includes("s")) record.storedRect.height = Math.max(MIN_HEIGHT, record.storedRect.height + desired.y * factor);
        if (intent.handle.includes("w")) { const right = record.storedRect.x + record.storedRect.width; record.storedRect.x += desired.x * factor; record.storedRect.width = Math.max(MIN_WIDTH, right - record.storedRect.x); }
        if (intent.handle.includes("n")) { const bottom = record.storedRect.y + record.storedRect.height; record.storedRect.y += desired.y * factor; record.storedRect.height = Math.max(MIN_HEIGHT, bottom - record.storedRect.y); }
      } else { record.storedRect.x += desired.x * factor; record.storedRect.y += desired.y * factor; }
      record.storedRect = rect(record.storedRect);
    }
    const geometry = computeWorldGeometry({ ...baseline, regions });
    let wall = null;
    for (const [area, value] of geometry) {
      const owner = regions.get(area)?.owner;
      for (const [other, otherValue] of geometry) {
        if (area === other || selected.has(other) || regions.get(other)?.owner !== owner) continue;
        const swept = selected.has(area) ? unionRects([baselineGeometry.get(area)?.constraint, value.constraint]) : value.constraint;
        if (overlaps(swept, otherValue.constraint)) { wall = other; break; }
      }
      if (wall) break;
    }
    return { regions, geometry, wall };
  };
  let accepted = evaluate(1);
  if (accepted.wall) {
    let low = 0; let high = 1;
    for (let index = 0; index < 48; index += 1) { const middle = (low + high) / 2; if (evaluate(middle).wall) high = middle; else low = middle; }
    const blockedBy = accepted.wall; accepted = evaluate(low); accepted.wall = blockedBy;
  }
  const valid = [...accepted.geometry].every(([area, value]) => {
    const parent = accepted.regions.get(area)?.owner;
    return parent === "@root" || !accepted.geometry.has(parent) || contains(accepted.geometry.get(parent).constraint, value.constraint);
  });
  return { ...accepted, valid };
}

/** Returns one Excalidraw rectangle for an Area tree node. */
export function composeRegionElement(node, geometry, worldRect) {
  const id = runtimeId(node.parent, node.region.sourceId);
  return {
    id, type: "rectangle", x: worldRect.x, y: worldRect.y,
    width: geometry.drawn.width, height: geometry.drawn.height, angle: 0,
    strokeColor: "#8b95a3", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "dashed", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1, version: 1,
    versionNonce: 1, isDeleted: false, boundElements: [], updated: 1, link: null,
    locked: false,
    customData: { tangent: { role: "area-region", area: node.key }, tangentWorld: { owner: node.parent, sourceId: node.region.sourceId, regionKey: node.region.key } },
  };
}

/** Composes one complete structural world and all supplied shard content. */
export function composeAreaMapWorld(world) {
  const areas = world.areas.map((node) => node.key);
  const regions = new Map(world.areas.map((node) => [node.key, clone(node.region)]));
  const geometry = computeWorldGeometry({ areas, regions });
  const nodes = new Map(world.areas.map((node) => [node.key, node]));
  const offsets = new Map();
  const regionRects = new Map();
  /** Resolves the world-space content origin for one Area. */
  function locate(area) {
    if (offsets.has(area)) return offsets.get(area);
    const node = nodes.get(area);
    const parentOffset = node.parent === "@root" ? { x: 0, y: 0 } : locate(node.parent);
    const stored = node.region.storedRect;
    const regionRect = { x: parentOffset.x + stored.x, y: parentOffset.y + stored.y, width: geometry.get(area).drawn.width, height: geometry.get(area).drawn.height };
    regionRects.set(area, regionRect);
    const offset = { x: regionRect.x, y: regionRect.y + LABEL_BAND };
    offsets.set(area, offset);
    return offset;
  }
  for (const area of areas) locate(area);
  const elements = [];
  const origins = new Map();
  const files = {};
  for (const node of world.areas) {
    const region = composeRegionElement(node, geometry.get(node.key), regionRects.get(node.key));
    elements.push(region);
    origins.set(region.id, region.customData.tangentWorld);
    if (!node.shard.scene) continue;
    const composed = composeShard(node.key, node.shard.scene, offsets.get(node.key));
    elements.push(...composed.elements);
    Object.assign(files, composed.files);
    for (const entry of composed.origins) origins.set(...entry);
  }
  return { scene: { type: "excalidraw", version: 2, source: "tangent", elements, appState: { viewBackgroundColor: "#121417" }, files }, origins, offsets, regions, geometry, regionRects };
}

export default { composeAreaMapWorld, composeRegionElement, composeShard, computeWorldGeometry, elementKey, inflateRect, provisionalRegions, regionId, regionKey, runtimeId, solveAreaMapGesture, splitComposed, unionRects };
