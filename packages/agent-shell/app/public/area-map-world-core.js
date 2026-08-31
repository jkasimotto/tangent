import { isAreaBoundary, isAreaRegion, tangentOf } from "./area-board-core.js";

export const AREA_MAP_LAYOUT = Object.freeze({
  spacing: 60,
  labelBand: 40,
  minimumWidth: 300,
  minimumHeight: 220,
  placementSchema: "area-placement.v1",
});

const LABEL_BAND = AREA_MAP_LAYOUT.labelBand;
const CONTENT_MARGIN = AREA_MAP_LAYOUT.spacing;
const MIN_WIDTH = AREA_MAP_LAYOUT.minimumWidth;
const MIN_HEIGHT = AREA_MAP_LAYOUT.minimumHeight;
const PLACEMENT_SCHEMA = AREA_MAP_LAYOUT.placementSchema;

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
  let x = Infinity; let y = Infinity; let right = -Infinity; let bottom = -Infinity; let count = 0;
  for (const value of values) {
    if (!finiteRect(value)) continue;
    x = Math.min(x, value.x); y = Math.min(y, value.y);
    right = Math.max(right, value.x + value.width); bottom = Math.max(bottom, value.y + value.height);
    count += 1;
  }
  if (!count) return null;
  return rect({ x, y, width: right - x, height: bottom - y });
}

/** Adds equal breathing room around one rectangle. */
export function inflateRect(value, amount = CONTENT_MARGIN) {
  return value ? rect({ x: value.x - amount, y: value.y - amount, width: value.width + amount * 2, height: value.height + amount * 2 }) : null;
}

/** Returns deterministic identity tables for one source shard. */
function identityTables(owner, scene) {
  const elements = new Map();
  const groups = new Map();
  const files = new Map();
  for (const element of scene?.elements ?? []) {
    elements.set(element.id, runtimeId(owner, element.id));
    for (const id of element.groupIds ?? []) groups.set(id, runtimeId(owner, `group:${id}`));
  }
  for (const id of Object.keys(scene?.files ?? {})) files.set(id, runtimeId(owner, `file:${id}`));
  return { elements, groups, files };
}

/** Reverses one set of source-to-runtime identity tables. */
function reverseTables(tables) {
  return Object.fromEntries(Object.entries(tables).map(([kind, mapping]) => [kind, new Map([...mapping].map(([source, runtime]) => [runtime, source]))]));
}

/** Rewrites every Excalidraw identity-bearing field through typed tables. */
function rewriteIds(value, tables) {
  if (Array.isArray(value)) return value.map((item) => rewriteIds(item, tables));
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (["id", "elementId", "containerId", "frameId"].includes(key) && typeof item === "string") next[key] = tables.elements.get(item) ?? item;
    else if (key === "fileId" && typeof item === "string") next[key] = tables.files.get(item) ?? item;
    else if (key === "groupIds" && Array.isArray(item)) next[key] = item.map((id) => tables.groups.get(id) ?? id);
    else next[key] = rewriteIds(item, tables);
  }
  return next;
}

/** Converts one source shard into namespaced world elements. */
export function composeShard(owner, scene, offset = { x: 0, y: 0 }) {
  const regionIds = new Set((scene?.elements ?? []).filter((element) => element?.customData?.tangent?.role === "region").map((element) => element.id));
  const elements = (scene?.elements ?? []).filter((element) => !element.isDeleted && !["boundary", "region"].includes(element?.customData?.tangent?.role) && !regionIds.has(element.containerId));
  const tables = identityTables(owner, { elements, files: scene?.files ?? {} });
  const inverse = reverseTables(tables);
  const origins = new Map();
  const composed = elements.map((source) => {
    const runtime = rewriteIds(source, tables);
    runtime.x = Number(runtime.x ?? 0) + Number(offset.x ?? 0);
    runtime.y = Number(runtime.y ?? 0) + Number(offset.y ?? 0);
    runtime.customData = { ...(runtime.customData ?? {}), tangentWorld: { owner, sourceId: source.id } };
    origins.set(runtime.id, { owner, sourceId: source.id, identity: inverse, source: clone(source) });
    return runtime;
  });
  const files = Object.fromEntries(Object.entries(scene?.files ?? {}).map(([id, file]) => {
    const runtime = tables.files.get(id);
    const next = clone(file);
    if (next?.id === id) next.id = runtime;
    return [runtime, next];
  }));
  return { elements: composed, files, origins, mapping: tables.elements, identity: tables };
}

/** Converts world elements back into exact source-owner groups. */
export function splitComposed(elements, origins, offsets = new Map()) {
  const byOwner = new Map();
  const fallback = { elements: new Map([...origins].map(([runtime, source]) => [runtime, source.sourceId])), groups: new Map(), files: new Map() };
  for (const runtime of elements ?? []) {
    const origin = origins.get(runtime.id) ?? runtime.customData?.tangentWorld;
    if (!origin) continue;
    const source = rewriteIds(runtime, origin.identity ?? fallback);
    if (Array.isArray(runtime.boundElements)) {
      source.boundElements = runtime.boundElements
        .filter((binding) => {
          const boundOrigin = origins.get(binding.id);
          return !boundOrigin || boundOrigin.owner === origin.owner;
        })
        .map((binding) => rewriteIds(binding, origin.identity ?? fallback));
    }
    const offset = offsets.get(origin.owner) ?? { x: 0, y: 0 };
    source.id = origin.sourceId;
    source.x = Number(source.x ?? 0) - Number(offset.x ?? 0);
    source.y = Number(source.y ?? 0) - Number(offset.y ?? 0);
    const endpoints = runtime.customData?.tangentWorldEndpoints;
    for (const side of ["start", "end"]) {
      const endpoint = endpoints?.[side];
      if (!endpoint) continue;
      const key = `${side}Binding`;
      if (endpoint.owner !== origin.owner) source[key] = null;
      else source[key] = { ...(source[key] ?? {}), elementId: endpoint.sourceId };
    }
    if (runtime.customData?.tangentWorldDeferredEndpoint && origin.source) {
      for (const key of ["x", "y", "points", "startBinding", "endBinding"]) {
        if (Object.hasOwn(origin.source, key)) source[key] = clone(origin.source[key]);
        else delete source[key];
      }
    }
    if (source.customData) {
      delete source.customData.tangentWorld;
      delete source.customData.tangentWorldDeferredEndpoint;
      delete source.customData.tangentWorldEphemeral;
      if (!Object.keys(source.customData).length) delete source.customData;
    }
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
    const values = children.get(parent).sort();
    const occupied = [];
    const placements = new Map();
    for (const child of values) {
      const saved = stored.get(regionKey(parent, child));
      if (!finiteRect(saved) || saved.width <= 0 || saved.height <= 0) continue;
      const storedRect = rect(saved);
      placements.set(child, { source: "stored", storedRect });
      occupied.push(storedRect);
    }
    for (const child of values) {
      if (placements.has(child)) continue;
      const storedRect = nearestFreeRectangle({ x: CONTENT_MARGIN, y: CONTENT_MARGIN, width: 460, height: 320 }, occupied, { gap: CONTENT_MARGIN });
      placements.set(child, { source: "provisional", storedRect });
      occupied.push(storedRect);
    }
    for (const child of values) {
      const placement = placements.get(child);
      regions.set(child, { key: regionKey(parent, child), owner: parent, child, sourceId: regionId(parent, child), labelSourceId: `${regionId(parent, child)}-label`, ...placement });
    }
  }
  return regions;
}

/** Builds the immutable tree order that one geometry pass uses. */
function prepareWorldGeometry(areas, regions) {
  const children = new Map();
  for (const [area, region] of regions) {
    const list = children.get(region.owner) ?? [];
    list.push(area); children.set(region.owner, list);
  }
  for (const list of children.values()) list.sort();
  const ordered = [...areas].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  return { children, ordered };
}

/** Returns one region's authored placement priority. */
function placementPriority(region) {
  const value = Number(region?.layout?.priority ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Returns one complete persistence-safe layout record. */
function normalizedLayout(region, priority = placementPriority(region), overlapWith = region?.layout?.overlapWith ?? []) {
  return {
    schema: PLACEMENT_SCHEMA,
    priority: Number.isSafeInteger(priority) && priority >= 0 ? priority : 0,
    overlapWith: [...new Set(Array.isArray(overlapWith) ? overlapWith.filter((area) => typeof area === "string" && area) : [])].sort(),
  };
}

/** Authors one Area's current resolved anchor before changing branch priority. */
export function reprioritizeAreaPlacement(region, resolvedStored, priority) {
  const next = clone(region);
  if (finiteRect(resolvedStored)) next.storedRect = rect(resolvedStored);
  next.layout = normalizedLayout(next, priority);
  return next;
}

/** Reports whether an authored placement explicitly permits one sibling pair. */
function permitsOverlap(regions, left, right) {
  /** Reports whether one Area names the other half of the pair. */
  const includes = (area, other) => Array.isArray(regions.get(area)?.layout?.overlapWith)
    && regions.get(area).layout.overlapWith.includes(other);
  return includes(left, right) && includes(right, left);
}

/** Computes one Area geometry record after its sibling placement is resolved. */
function computeAreaGeometry(region, required, inkHull, resolvedStored = region.storedRect, branchPriority = placementPriority(region), drawnRequired = null) {
  const preferred = rect(region.storedRect);
  const resolved = rect(resolvedStored);
  const minimum = { x: resolved.x, y: resolved.y, width: Math.max(MIN_WIDTH, preferred.width), height: Math.max(MIN_HEIGHT, preferred.height, LABEL_BAND) };
  const translatedRequired = required && {
    x: resolved.x + required.x,
    y: resolved.y + LABEL_BAND + required.y,
    width: required.width,
    height: required.height,
  };
  const translatedInk = inkHull && {
    x: resolved.x + inkHull.x,
    y: resolved.y + LABEL_BAND + inkHull.y,
    width: inkHull.width,
    height: inkHull.height,
  };
  const translatedDrawnRequired = drawnRequired && {
    x: resolved.x + drawnRequired.x,
    y: resolved.y + LABEL_BAND + drawnRequired.y,
    width: drawnRequired.width,
    height: drawnRequired.height,
  };
  const constraint = unionRects([minimum, inflateRect(translatedRequired)]);
  return {
    stored: preferred,
    resolvedStored: resolved,
    layoutOffset: { x: quantize(resolved.x - preferred.x), y: quantize(resolved.y - preferred.y) },
    branchPriority,
    required,
    drawnRequired,
    constraint,
    drawn: unionRects([constraint, inflateRect(translatedInk), inflateRect(translatedDrawnRequired)]),
  };
}

/** Resolves direct siblings while leaving their authored rectangles unchanged. */
function arrangeChildren(owner, children, regions, geometry, inkHulls) {
  if (children.length < 2) return owner;
  const ordered = [...children].sort((left, right) => {
    const leftGeometry = geometry.get(left); const rightGeometry = geometry.get(right);
    return rightGeometry.branchPriority - leftGeometry.branchPriority
      || placementPriority(regions.get(right)) - placementPriority(regions.get(left))
      || left.localeCompare(right);
  });
  const occupied = [];
  const cells = new Map();
  const cellSize = 1024;
  /** Returns the spatial buckets touched by one rectangle and its clearance. */
  const cellKeys = (value) => {
    const left = Math.floor((value.x - CONTENT_MARGIN) / cellSize); const right = Math.floor((value.x + value.width + CONTENT_MARGIN) / cellSize);
    const top = Math.floor((value.y - CONTENT_MARGIN) / cellSize); const bottom = Math.floor((value.y + value.height + CONTENT_MARGIN) / cellSize);
    const keys = [];
    for (let x = left; x <= right; x += 1) for (let y = top; y <= bottom; y += 1) keys.push(`${x}:${y}`);
    return keys;
  };
  /** Adds one resolved branch to the local broad-phase index. */
  const index = (entry) => {
    for (const key of cellKeys(entry.constraint)) {
      const values = cells.get(key) ?? []; values.push(entry); cells.set(key, values);
    }
  };
  /** Returns each possibly colliding branch once. */
  const nearby = (value) => {
    const found = new Set(); const values = [];
    for (const key of cellKeys(value)) for (const entry of cells.get(key) ?? []) {
      if (found.has(entry.area)) continue;
      found.add(entry.area); values.push(entry);
    }
    return values;
  };
  for (const area of ordered) {
    const current = geometry.get(area); const region = regions.get(area);
    const collision = nearby(current.constraint).some((entry) => !permitsOverlap(regions, area, entry.area)
      && !separated(current.constraint, entry.constraint, CONTENT_MARGIN));
    const blockerRects = collision
      ? occupied.filter((entry) => !permitsOverlap(regions, area, entry.area)).map((entry) => entry.constraint)
      : [];
    const resolvedConstraint = collision ? nearestFreeRectangle(current.constraint, blockerRects, { gap: CONTENT_MARGIN }) : current.constraint;
    const dx = resolvedConstraint.x - current.constraint.x; const dy = resolvedConstraint.y - current.constraint.y;
    const resolvedStored = rect({ ...current.resolvedStored, x: current.resolvedStored.x + dx, y: current.resolvedStored.y + dy });
    const resolved = computeAreaGeometry(region, current.required, inkHulls.get(area), resolvedStored, current.branchPriority, current.drawnRequired);
    geometry.set(area, resolved);
    const entry = { area, constraint: resolved.constraint };
    occupied.push(entry); index(entry);
  }
  return owner;
}

/** Computes geometry against one prepared immutable tree order. */
function computePreparedWorldGeometry({ regions, blockHulls = new Map(), inkHulls = new Map() }, { children, ordered }) {
  const result = new Map();
  for (const area of ordered) {
    const region = regions.get(area);
    arrangeChildren(area, children.get(area) ?? [], regions, result, inkHulls);
    const childConstraints = (children.get(area) ?? []).map((child) => result.get(child)?.constraint).filter(Boolean);
    const childDrawn = (children.get(area) ?? []).map((child) => result.get(child)?.drawn).filter(Boolean);
    const required = unionRects([blockHulls.get(area), ...childConstraints]);
    // Drawn extents propagate separately so every ancestor contains the
    // rendered subtree without turning free ink into a sibling collision wall.
    const drawnRequired = unionRects(childDrawn);
    const branchPriority = Math.max(placementPriority(region), ...(children.get(area) ?? []).map((child) => result.get(child)?.branchPriority ?? 0));
    result.set(area, computeAreaGeometry(region, required, inkHulls.get(area), region.storedRect, branchPriority, drawnRequired));
  }
  arrangeChildren("@root", children.get("@root") ?? [], regions, result, inkHulls);
  return result;
}

const gestureBaselines = new WeakMap();

/** Prepares one immutable pointer-down snapshot for every preview frame. */
function prepareGestureBaseline(baseline) {
  const cached = gestureBaselines.get(baseline);
  if (cached
    && cached.areas === baseline.areas
    && cached.regions === baseline.regions
    && cached.blockHulls === baseline.blockHulls
    && cached.inkHulls === baseline.inkHulls) return cached;
  const baseRegions = new Map(baseline.regions);
  const preparedGeometry = prepareWorldGeometry(baseline.areas, baseRegions);
  const baselineGeometry = computePreparedWorldGeometry({ ...baseline, regions: baseRegions }, preparedGeometry);
  const prepared = {
    areas: baseline.areas,
    regions: baseline.regions,
    blockHulls: baseline.blockHulls,
    inkHulls: baseline.inkHulls,
    baseRegions,
    preparedGeometry,
    baselineGeometry,
  };
  gestureBaselines.set(baseline, prepared);
  return prepared;
}

/** Computes bottom-up stored, required, constraint, and drawn rectangles. */
export function computeWorldGeometry({ areas, regions, blockHulls = new Map(), inkHulls = new Map() }) {
  return computePreparedWorldGeometry(
    { regions, blockHulls, inkHulls },
    prepareWorldGeometry(areas, regions),
  );
}

/** Reports strict rectangle overlap. */
export function rectanglesOverlap(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
/** Reports whether two rectangles have the requested clear space. */
function separated(a, b, gap = 0) {
  return a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x
    || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y;
}
/** Reports complete rectangle containment. */
function contains(parent, child) { return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height; }

/**
 * Returns the nearest deterministic free position on one cardinal axis.
 *
 * The preferred size never changes. Candidates stay on the preferred row or
 * column and sit immediately left, right, above, or below one occupied box.
 */
export function nearestFreeRectangle(preferred, occupied = [], { gap = 0 } = {}) {
  const origin = rect(preferred);
  const spacing = Math.max(0, Number(gap) || 0);
  const walls = [...occupied]
    .map((value) => value?.rect ?? value)
    .filter(finiteRect)
    .map(rect)
    .sort((left, right) => left.x - right.x || left.y - right.y || left.width - right.width || left.height - right.height);
  /** Reports whether one candidate keeps the requested gap from every wall. */
  const clear = (candidate) => walls.every((wall) => separated(candidate, wall, spacing));
  if (clear(origin)) return origin;

  const candidates = [];
  const seen = new Set();
  /** Adds one clear candidate once, with deterministic tie-break metadata. */
  const add = (candidate, direction) => {
    const value = rect({ ...origin, ...candidate });
    const key = `${value.x}\0${value.y}`;
    if (seen.has(key) || !clear(value)) return;
    seen.add(key);
    const dx = value.x - origin.x; const dy = value.y - origin.y;
    candidates.push({ value, direction, distance: dx * dx + dy * dy, travel: Math.abs(dx) + Math.abs(dy) });
  };
  for (const wall of walls) {
    add({ x: wall.x - spacing - origin.width }, 0);
    add({ x: wall.x + wall.width + spacing }, 1);
    add({ y: wall.y - spacing - origin.height }, 2);
    add({ y: wall.y + wall.height + spacing }, 3);
  }
  const hull = unionRects(walls);
  add({ x: hull.x - spacing - origin.width }, 0);
  add({ x: hull.x + hull.width + spacing }, 1);
  add({ y: hull.y - spacing - origin.height }, 2);
  add({ y: hull.y + hull.height + spacing }, 3);
  candidates.sort((left, right) => left.distance - right.distance || left.travel - right.travel
    || left.direction - right.direction || left.value.x - right.value.x || left.value.y - right.value.y);
  return candidates[0].value;
}

/** Returns the local hulls that affect one Area's structural and drawn rectangles. */
export function shardHulls(scene) {
  const blocks = [];
  const ink = [];
  const visible = (scene?.elements ?? []).filter((element) => !element.isDeleted);
  const structural = new Set(visible.filter((element) => isAreaBoundary(element) || isAreaRegion(element)).map((element) => element.id));
  for (const region of visible.filter(isAreaRegion)) {
    for (const binding of region.boundElements ?? []) if (binding.type === "text") structural.add(binding.id);
  }
  const blockRoots = visible.filter((element) => tangentOf(element)
    && !["boundary", "region"].includes(element.customData?.tangent?.role));
  const blockIds = new Set(blockRoots.map((element) => element.id));
  const blockLabels = new Set(blockRoots.flatMap((element) => element.boundElements
    ?.filter((entry) => entry.type === "text").map((entry) => entry.id) ?? []));
  for (const element of scene?.elements ?? []) {
    if (element.isDeleted || structural.has(element.id) || structural.has(element.containerId)
      || element?.customData?.tangent?.role === "area-region"
      || blockLabels.has(element.id) || blockIds.has(element.containerId) || !finiteRect(element)) continue;
    const target = tangentOf(element) ? blocks : ink;
    target.push(rectangleOf(element));
  }
  return { blocks: unionRects(blocks), ink: unionRects(ink) };
}

/** Returns one element's axis-aligned rectangle. */
function rectangleOf(element) {
  return rect({ x: Number(element.x), y: Number(element.y), width: Math.abs(Number(element.width)), height: Math.abs(Number(element.height)) });
}

/** Returns the direct-resize floor required by one Area's local contents. */
function storedSizeFloor(required) {
  if (!required) return { width: MIN_WIDTH, height: MIN_HEIGHT };
  return {
    width: Math.max(MIN_WIDTH, required.x + required.width + CONTENT_MARGIN),
    height: Math.max(MIN_HEIGHT, LABEL_BAND + required.y + required.height + CONTENT_MARGIN),
  };
}

/** Solves one gesture from its immutable pointer-down world snapshot. */
export function solveAreaMapGesture(baseline, intent) {
  const selected = new Set(intent.selectedAreas ?? []);
  const desired = { x: Number(intent.desiredWorldDelta?.x ?? 0), y: Number(intent.desiredWorldDelta?.y ?? 0) };
  const { baseRegions, preparedGeometry, baselineGeometry } = prepareGestureBaseline(baseline);
  if (desired.x === 0 && desired.y === 0) {
    return {
      regions: baseRegions,
      geometry: baselineGeometry,
      changedAreas: new Set(),
      wall: null,
      appliedDelta: { x: 0, y: 0 },
      valid: true,
    };
  }
  const regions = new Map(baseRegions);
  const priority = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, ...[...baseRegions.values()].map(placementPriority)) + 1);
  const changedAreas = new Set();
  for (const area of selected) {
    const originalRecord = baseRegions.get(area); const current = baselineGeometry.get(area);
    if (!originalRecord || !current) continue;
    // Absorb a derived reflow before direct manipulation so the selected Area
    // never jumps back to an older preferred position at pointer-down.
    const original = current.resolvedStored;
    const visible = current.constraint;
    const storedRect = { ...original };
    if (intent.handle) {
      const floor = storedSizeFloor(current.required);
      if (intent.handle.includes("e")) storedRect.width = Math.max(floor.width, visible.x + visible.width + desired.x - original.x);
      if (intent.handle.includes("s")) storedRect.height = Math.max(floor.height, visible.y + visible.height + desired.y - original.y);
      if (intent.handle.includes("w")) {
        const right = visible.x + visible.width;
        storedRect.width = Math.max(floor.width, visible.width - desired.x);
        storedRect.x = right - storedRect.width;
      }
      if (intent.handle.includes("n")) {
        const bottom = visible.y + visible.height;
        storedRect.height = Math.max(floor.height, visible.height - desired.y);
        storedRect.y = bottom - storedRect.height;
      }
    } else {
      storedRect.x = original.x + desired.x;
      storedRect.y = original.y + desired.y;
    }
    const region = clone(originalRecord);
    region.storedRect = rect(storedRect);
    region.layout = normalizedLayout(region, priority);
    regions.set(area, region);
    changedAreas.add(area);
  }

  if (!intent.handle) {
    // A direct move is the only command that authors structural overlap. Store
    // the exact direct-sibling pairs hit at the requested final position.
    const intended = new Map();
    for (const area of selected) {
      const current = baselineGeometry.get(area); const region = regions.get(area);
      if (!current || !region) continue;
      intended.set(area, computeAreaGeometry(region, current.required, baseline.inkHulls?.get(area), region.storedRect, priority, current.drawnRequired));
    }
    /** Adds or removes both authored halves of one exact overlap pair. */
    const setPair = (area, sibling, enabled) => {
      for (const [owner, other] of [[area, sibling], [sibling, area]]) {
        const before = regions.get(owner); if (!before) continue;
        const values = new Set(before.layout?.overlapWith ?? []);
        const had = values.has(other);
        if (enabled) values.add(other); else values.delete(other);
        if (had === values.has(other)) continue;
        const next = clone(before);
        next.layout = normalizedLayout(next, placementPriority(next), [...values]);
        regions.set(owner, next);
        changedAreas.add(owner);
      }
    };
    for (const area of selected) {
      const region = regions.get(area); const candidate = intended.get(area); if (!region || !candidate) continue;
      for (const sibling of preparedGeometry.children.get(region.owner) ?? []) {
        if (sibling === area) continue;
        const other = intended.get(sibling) ?? baselineGeometry.get(sibling);
        setPair(area, sibling, Boolean(other && rectanglesOverlap(candidate.constraint, other.constraint)));
      }
    }
  }

  const geometry = computeWorldGeometry({ ...baseline, regions });
  const valid = [...geometry.values()].every((value) => finiteRect(value.constraint) && finiteRect(value.drawn)
    && finiteRect(value.resolvedStored) && value.stored.width >= MIN_WIDTH && value.stored.height >= MIN_HEIGHT);
  return { regions, geometry, changedAreas, wall: null, appliedDelta: { x: quantize(desired.x), y: quantize(desired.y) }, valid };
}

/** Solves a block or free-ink move inside one owning shard. */
export function solveOwnedElementGesture(baseline, intent) {
  const desired = { x: Number(intent.desiredWorldDelta?.x ?? 0), y: Number(intent.desiredWorldDelta?.y ?? 0) };
  const start = rect(intent.rect);
  if (intent.kind === "ink") return { rect: rect({ ...start, x: start.x + desired.x, y: start.y + desired.y }), wall: null, valid: true };
  const value = rect({ ...start, x: start.x + desired.x, y: start.y + desired.y });
  const blockHulls = new Map(baseline.blockHulls ?? []);
  const ownerHull = unionRects([intent.remainingBlockHull, value]);
  if (ownerHull) blockHulls.set(intent.owner, ownerHull); else blockHulls.delete(intent.owner);
  const geometry = computeWorldGeometry({ ...baseline, blockHulls });
  const valid = [...geometry.values()].every((entry) => finiteRect(entry.constraint) && finiteRect(entry.resolvedStored));
  return { rect: value, wall: null, geometry, appliedDelta: { x: quantize(desired.x), y: quantize(desired.y) }, valid };
}

/** Returns one Excalidraw rectangle for an Area tree node. */
export function composeRegionElement(node, geometry, worldRect) {
  const id = runtimeId(node.parent, node.region.sourceId);
  return {
    id, type: "rectangle", x: worldRect.x, y: worldRect.y,
    width: worldRect.width, height: worldRect.height, angle: 0,
    strokeColor: "#8b95a3", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "dashed", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1, version: 1,
    versionNonce: 1, isDeleted: false, boundElements: [], updated: 1, link: null,
    locked: false,
    customData: { tangent: { role: "area-region", area: node.key }, tangentWorld: { owner: node.parent, sourceId: node.region.sourceId, regionKey: node.region.key } },
  };
}

/** Returns one arrow endpoint in composed world coordinates. */
function arrowEndpoint(element, side) {
  const points = element.points ?? [[0, 0], [Number(element.width ?? 0), Number(element.height ?? 0)]];
  const point = side === "start" ? points[0] : points.at(-1);
  return { x: Number(element.x ?? 0) + Number(point?.[0] ?? 0), y: Number(element.y ?? 0) + Number(point?.[1] ?? 0) };
}

/** Returns the nearest stable point on a region edge. */
function nearestRegionEdge(box, from) {
  const right = box.x + box.width; const bottom = box.y + box.height;
  const point = { x: Math.max(box.x, Math.min(right, from.x)), y: Math.max(box.y, Math.min(bottom, from.y)) };
  if (from.x >= box.x && from.x <= right && from.y >= box.y && from.y <= bottom) {
    const edges = [[Math.abs(from.x - box.x), "left"], [Math.abs(right - from.x), "right"], [Math.abs(from.y - box.y), "top"], [Math.abs(bottom - from.y), "bottom"]].sort((left, rightValue) => left[0] - rightValue[0]);
    if (edges[0][1] === "left") point.x = box.x;
    if (edges[0][1] === "right") point.x = right;
    if (edges[0][1] === "top") point.y = box.y;
    if (edges[0][1] === "bottom") point.y = bottom;
  }
  return point;
}

/** Creates one disposable dot for an endpoint whose target shard is deferred. */
function deferredEndpointDot(arrow, side, endpoint, point) {
  return {
    id: runtimeId(arrow.customData.tangentWorld.owner, `endpoint:${arrow.customData.tangentWorld.sourceId}:${side}:${endpoint.owner}:${endpoint.sourceId}`),
    type: "ellipse", x: point.x - 5, y: point.y - 5, width: 10, height: 10, angle: 0,
    strokeColor: "#8b95a3", backgroundColor: "#8b95a3", fillStyle: "solid", strokeWidth: 1,
    strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: [], updated: 1, link: null, locked: false,
    customData: { tangent: { role: "endpoint-dot" }, tangentWorldEphemeral: true },
  };
}

/** Resolves cross-owner endpoint metadata after every materialized shard has composed. */
function resolveWorldEndpoints(elements, origins, regionRects) {
  const dots = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.type !== "arrow" || !element.customData?.tangentWorldEndpoints) continue;
    for (const side of ["start", "end"]) {
      const endpoint = element.customData.tangentWorldEndpoints[side];
      if (!endpoint?.owner || !endpoint.sourceId) continue;
      const target = runtimeId(endpoint.owner, endpoint.sourceId);
      if (origins.has(target)) {
        element[`${side}Binding`] = { ...(element[`${side}Binding`] ?? {}), elementId: target };
        const targetElement = byId.get(target);
        if (targetElement) {
          const boundElements = Array.isArray(targetElement.boundElements) ? targetElement.boundElements : [];
          if (!boundElements.some((binding) => binding.id === element.id && binding.type === "arrow")) {
            targetElement.boundElements = [...boundElements, { id: element.id, type: "arrow" }];
          }
        }
        continue;
      }
      element[`${side}Binding`] = null;
      const box = regionRects.get(endpoint.owner);
      if (!box) continue;
      const other = arrowEndpoint(element, side === "start" ? "end" : "start");
      const point = nearestRegionEdge(box, other);
      if (side === "end") {
        const points = clone(element.points ?? [[0, 0], [Number(element.width ?? 0), Number(element.height ?? 0)]]);
        points[points.length - 1] = [quantize(point.x - element.x), quantize(point.y - element.y)];
        element.points = points;
      } else {
        const end = arrowEndpoint(element, "end");
        element.x = point.x; element.y = point.y;
        element.points = [[0, 0], [quantize(end.x - point.x), quantize(end.y - point.y)]];
      }
      element.customData.tangentWorldDeferredEndpoint = true;
      dots.push(deferredEndpointDot(element, side, endpoint, point));
    }
  }
  elements.push(...dots);
}

/** Composes one complete structural world and all supplied shard content. */
export function composeAreaMapWorld(world) {
  const areas = world.areas.map((node) => node.key);
  const regions = new Map(world.areas.map((node) => [node.key, clone(node.region)]));
  const blockHulls = new Map();
  const inkHulls = new Map();
  for (const node of world.areas) {
    const hulls = shardHulls(node.shard.scene);
    const blocks = hulls.blocks ?? node.shard.ownBlockHull;
    const ink = hulls.ink ?? node.shard.ownInkHull;
    if (blocks) blockHulls.set(node.key, blocks);
    if (ink) inkHulls.set(node.key, ink);
  }
  const geometry = computeWorldGeometry({ areas, regions, blockHulls, inkHulls });
  const nodes = new Map(world.areas.map((node) => [node.key, node]));
  const offsets = new Map();
  const regionRects = new Map();
  const storedRegionRects = new Map();
  /** Resolves the world-space content origin for one Area. */
  function locate(area) {
    if (offsets.has(area)) return offsets.get(area);
    const node = nodes.get(area);
    const parentOffset = node.parent === "@root" ? { x: 0, y: 0 } : locate(node.parent);
    const value = geometry.get(area);
    const stored = value.resolvedStored;
    const drawn = value.drawn;
    const regionRect = { x: parentOffset.x + drawn.x, y: parentOffset.y + drawn.y, width: drawn.width, height: drawn.height };
    regionRects.set(area, regionRect);
    storedRegionRects.set(area, { x: parentOffset.x + stored.x, y: parentOffset.y + stored.y, width: stored.width, height: stored.height });
    const offset = { x: parentOffset.x + stored.x, y: parentOffset.y + stored.y + LABEL_BAND };
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
  }
  // Keep every transparent structural outline below authored content. A deep
  // child region must not intercept a click on its ancestor's visible block.
  for (const node of world.areas) {
    if (!node.shard.scene) continue;
    const composed = composeShard(node.key, node.shard.scene, offsets.get(node.key));
    elements.push(...composed.elements);
    Object.assign(files, composed.files);
    for (const entry of composed.origins) origins.set(...entry);
  }
  resolveWorldEndpoints(elements, origins, regionRects);
  return { scene: { type: "excalidraw", version: 2, source: "tangent", elements, appState: { theme: "dark", viewBackgroundColor: "#121417" }, files }, origins, offsets, regions, geometry, regionRects, storedRegionRects };
}

/** Restores tree-derived regions that an Excalidraw delete or eraser action removed. */
export function protectAreaRegions(canonicalElements, changedElements) {
  const canonical = new Map((canonicalElements ?? []).filter((element) => element.customData?.tangent?.role === "area-region").map((element) => [element.id, element]));
  const changed = new Map((changedElements ?? []).map((element) => [element.id, element]));
  const authored = (changedElements ?? []).filter((element) => element.customData?.tangent?.role !== "area-region");
  const regions = [];
  for (const [id, source] of canonical) {
    const candidate = changed.get(id);
    regions.push(candidate && !candidate.isDeleted
      ? { ...candidate, locked: false, isDeleted: false, customData: clone(source.customData) }
      : clone(source));
  }
  return [...regions, ...authored];
}

/** Rewrites Area-path identities after one explicit vault move. */
export function remapAreaMapWorld(world, changedPaths) {
  const moved = clone(world);
  const orderedPaths = [...changedPaths].sort(([left], [right]) => right.length - left.length || left.localeCompare(right));
  /** Maps one Area path, including descendants, and leaves virtual owners unchanged. */
  const remap = (value) => {
    if (typeof value !== "string") return value;
    for (const [from, to] of orderedPaths) {
      if (value === from) return to;
      if (value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`;
    }
    return value;
  };
  moved.locatedArea = remap(moved.locatedArea);
  /** Rewrites nested endpoint metadata without treating ordinary authored words as paths. */
  function rewriteEndpoints(value) {
    if (Array.isArray(value)) return value.map(rewriteEndpoints);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "owner" && typeof item === "string") next[key] = remap(item);
      else if (key === "overlapWith" && Array.isArray(item)) next[key] = item.map(remap);
      else next[key] = rewriteEndpoints(item);
    }
    return next;
  }
  moved.areas = moved.areas.map((node) => {
    const key = remap(node.key);
    const parent = remap(node.parent);
    const child = remap(node.region.child);
    return {
      ...rewriteEndpoints(node), key, parent,
      children: (node.children ?? []).map(remap),
      region: { ...rewriteEndpoints(node.region), key: regionKey(parent, child), owner: parent, child },
      shard: { ...rewriteEndpoints(node.shard), owner: remap(node.shard.owner) },
    };
  });
  return moved;
}

export default { AREA_MAP_LAYOUT, composeAreaMapWorld, composeRegionElement, composeShard, computeWorldGeometry, elementKey, inflateRect, nearestFreeRectangle, protectAreaRegions, provisionalRegions, rectanglesOverlap, regionId, regionKey, remapAreaMapWorld, reprioritizeAreaPlacement, runtimeId, shardHulls, solveAreaMapGesture, solveOwnedElementGesture, splitComposed, unionRects };
