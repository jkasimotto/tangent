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

/** Computes one Area geometry record from its local required hull. */
function computeAreaGeometry(region, required, inkHull) {
  const minimum = { x: region.storedRect.x, y: region.storedRect.y, width: Math.max(MIN_WIDTH, region.storedRect.width), height: Math.max(MIN_HEIGHT, region.storedRect.height, LABEL_BAND) };
  const translatedRequired = required && {
    x: region.storedRect.x + required.x,
    y: region.storedRect.y + LABEL_BAND + required.y,
    width: required.width,
    height: required.height,
  };
  const translatedInk = inkHull && {
    x: region.storedRect.x + inkHull.x,
    y: region.storedRect.y + LABEL_BAND + inkHull.y,
    width: inkHull.width,
    height: inkHull.height,
  };
  const constraint = unionRects([minimum, inflateRect(translatedRequired)]);
  return { stored: rect(region.storedRect), required, constraint, drawn: unionRects([constraint, inflateRect(translatedInk)]) };
}

/** Computes geometry against one prepared immutable tree order. */
function computePreparedWorldGeometry({ regions, blockHulls = new Map(), inkHulls = new Map() }, { children, ordered }) {
  const result = new Map();
  for (const area of ordered) {
    const region = regions.get(area);
    const childRects = (children.get(area) ?? []).map((child) => result.get(child)?.constraint).filter(Boolean);
    const required = unionRects([blockHulls.get(area), ...childRects]);
    result.set(area, computeAreaGeometry(region, required, inkHulls.get(area)));
  }
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
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
/** Reports complete rectangle containment. */
function contains(parent, child) { return child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height; }

/** Returns the local hulls that affect one Area's structural and drawn rectangles. */
export function shardHulls(scene) {
  const blocks = [];
  const ink = [];
  const regionIds = new Set((scene?.elements ?? []).filter((element) => element?.customData?.tangent?.role === "region").map((element) => element.id));
  for (const element of scene?.elements ?? []) {
    if (element.isDeleted || ["boundary", "region", "area-region"].includes(element?.customData?.tangent?.role) || regionIds.has(element.containerId) || !finiteRect(element)) continue;
    const target = element?.customData?.tangent?.ref ? blocks : ink;
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
  const affected = new Set(selected);
  const siblings = preparedGeometry.children;
  for (const area of selected) {
    let owner = baseRegions.get(area)?.owner;
    while (owner && owner !== "@root") { affected.add(owner); owner = baseRegions.get(owner)?.owner; }
  }
  const affectedOrder = preparedGeometry.ordered.filter((area) => affected.has(area));
  const affectedChildren = new Map();
  const staticRequired = new Map();
  for (const area of affectedOrder) {
    const changed = [];
    const stable = [baseline.blockHulls?.get(area)];
    for (const child of preparedGeometry.children.get(area) ?? []) {
      if (affected.has(child)) changed.push(child);
      else stable.push(baselineGeometry.get(child)?.constraint);
    }
    affectedChildren.set(area, changed);
    staticRequired.set(area, unionRects(stable));
  }
  /** Expands one sparse candidate into the public complete map result. */
  const materialize = (candidate) => {
    const regions = new Map(baseRegions);
    for (const [area, storedRect] of candidate.storedRects) {
      const region = clone(baseRegions.get(area));
      region.storedRect = storedRect;
      regions.set(area, region);
    }
    const geometry = new Map(baselineGeometry);
    for (const [area, value] of candidate.geometry) geometry.set(area, value);
    return { regions, geometry, wall: candidate.wall };
  };
  const evaluations = new Map();
  /** Evaluates one requested pointer delta. */
  const evaluate = (delta) => {
    const storedRects = new Map();
    const cacheKey = [];
    for (const area of selected) {
      const originalRecord = baseRegions.get(area); if (!originalRecord) continue;
      const original = originalRecord.storedRect;
      const storedRect = { ...original };
      if (intent.handle) {
        const floor = storedSizeFloor(baselineGeometry.get(area)?.required);
        if (intent.handle.includes("e")) storedRect.width = Math.max(floor.width, original.width + delta.x);
        if (intent.handle.includes("s")) storedRect.height = Math.max(floor.height, original.height + delta.y);
        if (intent.handle.includes("w")) {
          const right = original.x + original.width;
          storedRect.width = Math.max(floor.width, original.width - delta.x);
          storedRect.x = right - storedRect.width;
        }
        if (intent.handle.includes("n")) {
          const bottom = original.y + original.height;
          storedRect.height = Math.max(floor.height, original.height - delta.y);
          storedRect.y = bottom - storedRect.height;
        }
      } else {
        storedRect.x = original.x + delta.x;
        storedRect.y = original.y + delta.y;
      }
      const quantized = rect(storedRect);
      storedRects.set(area, quantized);
      cacheKey.push(area, ...[quantized.x, quantized.y, quantized.width, quantized.height].map((value) => Object.is(value, -0) ? "-0" : String(value)));
    }
    const fingerprint = cacheKey.join("\u0000");
    const cached = evaluations.get(fingerprint);
    if (cached) return cached;
    const geometry = new Map();
    for (const area of affectedOrder) {
      const childRects = (affectedChildren.get(area) ?? []).map((child) => geometry.get(child)?.constraint ?? baselineGeometry.get(child)?.constraint);
      const required = unionRects([staticRequired.get(area), ...childRects]);
      const region = storedRects.has(area) ? { ...baseRegions.get(area), storedRect: storedRects.get(area) } : baseRegions.get(area);
      geometry.set(area, computeAreaGeometry(region, required, baseline.inkHulls?.get(area)));
    }
    let wall = null;
    for (const area of affected) {
      const value = geometry.get(area) ?? baselineGeometry.get(area); if (!value) continue;
      const owner = baseRegions.get(area)?.owner;
      const swept = unionRects([baselineGeometry.get(area)?.constraint, value.constraint]);
      for (const other of siblings.get(owner) ?? []) {
        if (area === other || selected.has(other)) continue;
        const otherValue = geometry.get(other) ?? baselineGeometry.get(other);
        if (overlaps(swept, otherValue.constraint)) { wall = other; break; }
      }
      if (wall) break;
    }
    const candidate = { storedRects, geometry, wall };
    evaluations.set(fingerprint, candidate);
    return candidate;
  };
  // The full swept rectangle contains both axis-segment sweeps. Accept a clear
  // request before the fallback solver checks its axis candidates.
  const direct = evaluate(desired);
  if (!direct.wall) {
    const result = materialize(direct);
    const valid = [...result.geometry.values()].every((value) => finiteRect(value.constraint) && value.stored.width >= MIN_WIDTH && value.stored.height >= MIN_HEIGHT);
    return { ...result, appliedDelta: { x: quantize(desired.x), y: quantize(desired.y) }, valid };
  }
  let applied = { x: 0, y: 0 };
  let blockedBy = null;
  const axes = Math.abs(desired.x) >= Math.abs(desired.y) ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    const target = { ...applied, [axis]: desired[axis] };
    const full = evaluate(target);
    if (!full.wall) { applied = target; continue; }
    blockedBy ??= full.wall;
    let low = 0; let high = 1;
    for (let index = 0; index < 48; index += 1) {
      const middle = (low + high) / 2;
      const candidate = { ...applied, [axis]: desired[axis] * middle };
      if (evaluate(candidate).wall) high = middle; else low = middle;
    }
    applied[axis] = desired[axis] * low;
  }
  const accepted = materialize(evaluate(applied));
  accepted.wall = blockedBy;
  const valid = [...accepted.geometry.values()].every((value) => finiteRect(value.constraint) && value.stored.width >= MIN_WIDTH && value.stored.height >= MIN_HEIGHT);
  return { ...accepted, appliedDelta: { x: quantize(applied.x), y: quantize(applied.y) }, valid };
}

/** Solves a block or free-ink move inside one owning shard. */
export function solveOwnedElementGesture(baseline, intent) {
  const desired = { x: Number(intent.desiredWorldDelta?.x ?? 0), y: Number(intent.desiredWorldDelta?.y ?? 0) };
  const start = rect(intent.rect);
  if (intent.kind === "ink") return { rect: rect({ ...start, x: start.x + desired.x, y: start.y + desired.y }), wall: null, valid: true };
  const baselineGeometry = computeWorldGeometry(baseline);
  const directWalls = [...baseline.regions].filter(([, region]) => region.owner === intent.owner).map(([area]) => [area, baselineGeometry.get(area).constraint]);
  const siblings = new Map();
  for (const [area, region] of baseline.regions) {
    const list = siblings.get(region.owner) ?? [];
    list.push(area); siblings.set(region.owner, list);
  }
  for (const list of siblings.values()) list.sort();
  const affected = [];
  let current = intent.owner;
  while (current && current !== "@root") {
    affected.push(current);
    current = baseline.regions.get(current)?.owner;
  }
  /** Evaluates one desired block delta without relying on final overlap alone. */
  const evaluate = (delta) => {
    const value = rect({ ...start, x: start.x + delta.x, y: start.y + delta.y });
    const sweptElement = unionRects([start, value]);
    const directHit = directWalls.find(([, wall]) => overlaps(sweptElement, wall));
    if (directHit) return { rect: value, wall: directHit[0], geometry: baselineGeometry };
    const blockHulls = new Map(baseline.blockHulls ?? []);
    const ownerHull = unionRects([intent.remainingBlockHull, value]);
    if (ownerHull) blockHulls.set(intent.owner, ownerHull); else blockHulls.delete(intent.owner);
    const geometry = computeWorldGeometry({ ...baseline, blockHulls });
    for (const area of affected) {
      const region = baseline.regions.get(area);
      const sweptConstraint = unionRects([baselineGeometry.get(area)?.constraint, geometry.get(area)?.constraint]);
      for (const sibling of siblings.get(region?.owner) ?? []) {
        if (sibling === area) continue;
        if (overlaps(sweptConstraint, baselineGeometry.get(sibling).constraint)) return { rect: value, wall: sibling, geometry };
      }
    }
    return { rect: value, wall: null, geometry };
  };
  let applied = { x: 0, y: 0 };
  let blockedBy = null;
  const axes = Math.abs(desired.x) >= Math.abs(desired.y) ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    const target = { ...applied, [axis]: desired[axis] };
    if (!evaluate(target).wall) { applied = target; continue; }
    blockedBy ??= evaluate(target).wall;
    let low = 0; let high = 1;
    for (let index = 0; index < 48; index += 1) {
      const middle = (low + high) / 2;
      const candidate = { ...applied, [axis]: desired[axis] * middle };
      if (evaluate(candidate).wall) high = middle; else low = middle;
    }
    applied[axis] = desired[axis] * low;
  }
  return { ...evaluate(applied), wall: blockedBy, appliedDelta: { x: quantize(applied.x), y: quantize(applied.y) }, valid: true };
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
    if (hulls.blocks) blockHulls.set(node.key, hulls.blocks);
    if (hulls.ink) inkHulls.set(node.key, hulls.ink);
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
    const stored = node.region.storedRect;
    const drawn = geometry.get(area).drawn;
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
  /** Maps one exact Area path and leaves virtual owners unchanged. */
  const remap = (value) => changedPaths.get(value) ?? value;
  moved.locatedArea = remap(moved.locatedArea);
  /** Rewrites nested endpoint metadata without treating ordinary authored words as paths. */
  function rewriteEndpoints(value) {
    if (Array.isArray(value)) return value.map(rewriteEndpoints);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, item] of Object.entries(value)) next[key] = key === "owner" && typeof item === "string" ? remap(item) : rewriteEndpoints(item);
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

export default { composeAreaMapWorld, composeRegionElement, composeShard, computeWorldGeometry, elementKey, inflateRect, protectAreaRegions, provisionalRegions, regionId, regionKey, remapAreaMapWorld, runtimeId, shardHulls, solveAreaMapGesture, solveOwnedElementGesture, splitComposed, unionRects };
