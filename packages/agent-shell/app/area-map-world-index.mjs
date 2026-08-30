import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { areaCanvasPath, parseAreaCanvas, validateAreaCanvas } from "./area-canvas.mjs";
import { areaForBlock, isAreaBoundary, isAreaRegion, tangentOf } from "./public/area-board-core.js";
import { regionId, regionKey, unionRects } from "./public/area-map-world-core.js";

const LABEL_BAND = 40;
const CONTENT_MARGIN = 60;
const SLOT_WIDTH = 460;
const SLOT_HEIGHT = 320;
const TARGET_RIGHT = 1660;
const ROOT_OWNER = "@root";
const CACHE_LIMIT = 256;

/** Returns a compact revision digest. */
const digest = (value) => createHash("sha256").update(String(value)).digest("base64url").slice(0, 16);
/** Returns the structural parent for one canonical Area path. */
const parentFor = (area) => area.includes("/") ? area.slice(0, area.lastIndexOf("/")) : ROOT_OWNER;
/** Copies one element rectangle. */
const rectangle = (element) => ({ x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height) });
/** Reports whether one rectangle can participate in structural placement. */
const validRectangle = (value) => value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0;
/** Reports strict overlap between two rectangles. */
const overlaps = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
/** Returns one bound text source ID, with a stable fallback. */
const labelId = (element) => element.boundElements?.find((entry) => entry.type === "text")?.id ?? `${element.id}-tangent-label`;
/** Returns one Area scene's revision token, including legacy in-memory reads. */
const shardRevision = (shard) => shard.hash ?? (shard.legacy?.text ? `legacy:${digest(shard.legacy.text)}` : shard.ok === false ? `unreadable:${digest(shard.errors?.join("\n"))}` : "missing");

/** Keeps one bounded insertion-ordered cache. */
function cacheSet(cache, key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

/** Returns the first committed Tangent element positions for read-only card migration. */
export async function readFirstCommittedMapBaseline({ root, runGit, area, current }) {
  if (!runGit || !current?.exists || Number(current.scene?.tangent?.format ?? 0) >= 2) return null;
  const file = areaCanvasPath(area);
  try {
    const added = await runGit(["-C", root, "log", "--diff-filter=A", "--format=%H", "--", file]);
    const sha = String(added.stdout ?? added ?? "").trim().split("\n").filter(Boolean).at(-1);
    if (!sha) return null;
    const shown = await runGit(["-C", root, "show", `${sha}:${file}`]);
    const parsed = parseAreaCanvas(String(shown.stdout ?? shown ?? ""));
    if (!parsed.ok) return null;
    return Object.fromEntries(parsed.scene.elements.filter((element) => element.customData?.tangent).map((element) => [element.id, { x: element.x, y: element.y }]));
  } catch {
    return null;
  }
}

/** Returns the newest committed valid scene for structural unreadable-file recovery. */
export async function readLastCommittedValidMapScene({ root, runGit, area }) {
  if (!runGit) return null;
  const file = areaCanvasPath(area);
  try {
    const logged = await runGit(["-C", root, "log", "--format=%H", "--", file]);
    const commits = String(logged.stdout ?? logged ?? "").trim().split("\n").filter(Boolean).slice(0, 128);
    for (const commit of commits) {
      try {
        const shown = await runGit(["-C", root, "show", `${commit}:${file}`]);
        const parsed = parseAreaCanvas(String(shown.stdout ?? shown ?? ""));
        if (parsed.ok) return parsed.scene;
      } catch {}
    }
  } catch {}
  return null;
}

/** Returns a source scene's relation-independent parsed summary. */
function rawShardSummary(owner, shard) {
  const scene = shard.scene ?? { type: "excalidraw", version: 2, source: "tangent", elements: [], appState: {}, files: {} };
  const visible = (scene.elements ?? []).filter((element) => !element.isDeleted);
  return {
    owner,
    scene,
    visible,
    boundaries: visible.filter(isAreaBoundary),
    regions: visible.filter(isAreaRegion),
    areaCards: visible.filter((element) => tangentOf(element)?.kind === "area" && !element.customData?.tangent?.role),
  };
}

/** Builds one relation-aware shard projection without changing source bytes. */
function adaptShardSummary(raw, directChildren, baseline) {
  const direct = new Set(directChildren);
  const ignored = new Set();
  const structural = new Set(raw.boundaries.map((element) => element.id));
  const retired = new Set();
  const retiredCards = new Set();
  const staleRegions = new Set();
  const stored = new Map();
  const legacy = new Map();
  /** Adds one region candidate to a child-keyed list. */
  const push = (target, child, value) => { const list = target.get(child) ?? []; list.push(value); target.set(child, list); };
  for (const element of raw.regions) {
    structural.add(element.id); structural.add(labelId(element));
    const child = areaForBlock(element);
    if (!direct.has(child)) {
      staleRegions.add(element.id);
      const boundLabel = element.boundElements?.find((entry) => entry.type === "text")?.id;
      if (boundLabel) staleRegions.add(boundLabel);
      continue;
    }
    push(stored, child, {
      sourceId: element.id,
      labelSourceId: labelId(element),
      storedRect: rectangle(element),
      version: Number(element.version ?? 0),
      updated: Number(element.updated ?? 0),
    });
  }
  for (const element of raw.areaCards) {
    const child = areaForBlock(element);
    if (!direct.has(child) && child !== raw.owner) continue;
    ignored.add(element.id); ignored.add(labelId(element));
    if (child === raw.owner) { retired.add(element.id); retired.add(labelId(element)); retiredCards.add(element.id); continue; }
    const original = baseline?.[element.id];
    const moved = !original || Math.abs(Number(element.x) - Number(original.x)) >= 1 || Math.abs(Number(element.y) - Number(original.y)) >= 1;
    if (!moved) { retired.add(element.id); retired.add(labelId(element)); retiredCards.add(element.id); continue; }
    push(legacy, child, {
      sourceId: element.id,
      labelSourceId: labelId(element),
      storedRect: rectangle(element),
      version: Number(element.version ?? 0),
      updated: Number(element.updated ?? 0),
    });
  }
  const elements = (raw.scene.elements ?? []).filter((element) => !ignored.has(element.id));
  const scene = { ...raw.scene, elements };
  const visible = elements.filter((element) => !element.isDeleted);
  const blockRoots = visible.filter((element) => tangentOf(element) && !["boundary", "region"].includes(element.customData?.tangent?.role));
  const blockIds = new Set(blockRoots.map((element) => element.id));
  const blockLabels = new Set(blockRoots.flatMap((element) => element.boundElements?.filter((entry) => entry.type === "text").map((entry) => entry.id) ?? []));
  const blocks = blockRoots.filter((element) => validRectangle(rectangle(element))).map(rectangle);
  const ink = visible.filter((element) => !structural.has(element.id) && !structural.has(element.containerId) && !tangentOf(element) && !blockLabels.has(element.id) && !blockIds.has(element.containerId) && validRectangle(rectangle(element))).map(rectangle);
  return {
    scene,
    stored,
    legacy,
    ownBlockHull: unionRects(blocks),
    ownInkHull: unionRects(ink),
    blockCount: blockRoots.length,
    elementCount: visible.length,
    retiredIds: [...retired],
    staleRegionIds: [...staleRegions],
    boundaryIds: raw.boundaries.map((element) => element.id),
    migration: { legacyBoundaries: raw.boundaries.length, legacyCards: raw.areaCards.filter((element) => direct.has(areaForBlock(element))).length, retiredCards: retiredCards.size },
  };
}

/** Orders duplicate source regions by the approved stable winner rule. */
function candidateOrder(left, right) {
  return right.version - left.version || right.updated - left.updated || left.sourceId.localeCompare(right.sourceId);
}

/** Keeps losing duplicate regions visible as ordinary authored source content. */
function projectedShardScene(owner, summary, regions) {
  const selected = new Set([...regions.values()].filter((region) => region.owner === owner).map((region) => region.sourceId));
  const candidates = new Set([...summary.stored.values()].flat().map((candidate) => candidate.sourceId));
  const losing = new Set([...candidates].filter((sourceId) => !selected.has(sourceId)));
  if (!losing.size) return summary.scene;
  return { ...summary.scene, elements: summary.scene.elements.map((element) => {
    if (!losing.has(element.id) || !isAreaRegion(element)) return element;
    const copy = structuredClone(element); copy.customData.tangent.role = "shortcut"; return copy;
  }) };
}

/** Returns the computed structural size needed by one Area. */
function areaRequirement(area, summaries, children, regions, requirements) {
  const summary = summaries.get(area);
  const own = [summary?.ownBlockHull].filter(Boolean);
  const childRects = (children.get(area) ?? []).map((child) => {
    const stored = regions.get(child)?.storedRect;
    const needed = requirements.get(child) ?? { width: SLOT_WIDTH, height: SLOT_HEIGHT };
    return stored && { x: stored.x, y: stored.y, width: Math.max(stored.width, needed.width), height: Math.max(stored.height, needed.height) };
  }).filter(Boolean);
  const content = unionRects([...own, ...childRects]);
  if (!content) return { width: SLOT_WIDTH, height: SLOT_HEIGHT };
  const horizontalSpan = Math.max(content.width + CONTENT_MARGIN * 2, content.x + content.width + CONTENT_MARGIN);
  const verticalSpan = Math.max(content.height + CONTENT_MARGIN * 2 + LABEL_BAND, content.y + content.height + CONTENT_MARGIN + LABEL_BAND);
  return { width: Math.max(SLOT_WIDTH, horizontalSpan), height: Math.max(SLOT_HEIGHT, verticalSpan) };
}

/** Finds the first deterministic free row position around occupied structural walls. */
function firstFreePlacement(width, height, occupied) {
  const rows = [...new Set([60, ...occupied.map((value) => value.y + value.height + CONTENT_MARGIN)])].sort((a, b) => a - b);
  for (const y of rows) {
    let x = 60;
    for (let attempt = 0; attempt < occupied.length + 2; attempt += 1) {
      const candidate = { x, y, width, height };
      const blockers = occupied.filter((value) => overlaps(candidate, value)).sort((left, right) => left.x - right.x || left.y - right.y);
      if (!blockers.length && (x + width <= TARGET_RIGHT || x === 60)) return candidate;
      if (!blockers.length) break;
      x = Math.max(...blockers.map((value) => value.x + value.width + CONTENT_MARGIN));
    }
  }
  const y = occupied.length ? Math.max(...occupied.map((value) => value.y + value.height)) + CONTENT_MARGIN : 60;
  return { x: 60, y, width, height };
}

/** Selects stored, recovered, legacy, or provisional records for every Area edge. */
function buildRegionRecords(areaKeys, summaries, children) {
  const regions = new Map();
  const requirements = new Map();
  const owners = [...areaKeys].sort((left, right) => right.split("/").length - left.split("/").length || left.localeCompare(right));
  owners.push(ROOT_OWNER);
  for (const owner of owners) {
    const direct = children.get(owner) ?? [];
    const occupied = [];
    const pending = [];
    for (const child of direct) {
      const summary = summaries.get(owner);
      const valid = [...(summary?.stored.get(child) ?? [])].filter((candidate) => validRectangle(candidate.storedRect)).sort(candidateOrder);
      const invalid = [...(summary?.stored.get(child) ?? [])].filter((candidate) => !validRectangle(candidate.storedRect)).sort(candidateOrder);
      const legacy = [...(summary?.legacy.get(child) ?? [])].filter((candidate) => validRectangle(candidate.storedRect)).sort(candidateOrder);
      const candidate = valid[0] ?? invalid[0] ?? legacy[0] ?? null;
      const needed = requirements.get(child) ?? { width: SLOT_WIDTH, height: SLOT_HEIGHT };
      const source = valid[0] ? "stored" : candidate ? "recovered" : "provisional";
      const original = validRectangle(candidate?.storedRect) ? candidate.storedRect : { x: 60, y: 60, width: needed.width, height: needed.height };
      const wall = { x: original.x, y: original.y, width: Math.max(original.width, needed.width), height: Math.max(original.height, needed.height) };
      const record = {
        key: regionKey(owner, child), owner, child,
        sourceId: candidate?.sourceId ?? regionId(owner, child),
        labelSourceId: candidate?.labelSourceId ?? `${regionId(owner, child)}-label`,
        source,
        storedRect: { ...original },
      };
      if (source === "stored" && !occupied.some((value) => overlaps(wall, value))) {
        regions.set(child, record); occupied.push(wall);
      } else pending.push({ child, record, wall, needed, reason: source === "provisional" ? null : valid[0] ? "overlap" : "invalid or legacy geometry" });
    }
    for (const entry of pending) {
      const placed = firstFreePlacement(entry.wall.width, entry.wall.height, occupied);
      entry.record.storedRect = {
        x: placed.x,
        y: placed.y,
        width: entry.record.source === "provisional" ? entry.needed.width : Math.max(300, Number(entry.record.storedRect.width) || entry.needed.width),
        height: entry.record.source === "provisional" ? entry.needed.height : Math.max(220, Number(entry.record.storedRect.height) || entry.needed.height),
      };
      if (entry.record.source !== "provisional") { entry.record.source = "recovered"; entry.record.recoveryReason = entry.reason; }
      regions.set(entry.child, entry.record); occupied.push(placed);
    }
    if (owner !== ROOT_OWNER) requirements.set(owner, areaRequirement(owner, summaries, children, regions, requirements));
  }
  return { regions, requirements };
}

/** Reports a runtime/composed identity anywhere in one source element. */
function composedIdentity(value, key = "") {
  if (key === "tangentWorld") return true;
  if (typeof value === "string") return ["id", "elementId", "containerId", "frameId", "fileId"].includes(key) && value.startsWith("tw-");
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" ? item.startsWith("tw-") : composedIdentity(item));
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([name, item]) => composedIdentity(item, name)));
}

/** Reports whether a source element ID is safe at an authority boundary. */
function safeSourceId(value) {
  return typeof value === "string" && Boolean(value) && value.length <= 256 && !value.includes("\0") && !value.startsWith("tw-");
}

/** Validates one Tangent semantic reference without resolving outside the vault. */
function tangentReferenceError(element) {
  const tangent = tangentOf(element);
  if (!tangent) return null;
  const reference = tangent.ref;
  if (!reference || reference.length > 8_000 || reference.includes("\0")) return `source element ${element.id} has an unsafe Tangent reference`;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(reference)?.[1]?.toLowerCase();
  if (scheme) {
    if (!["http", "https", "mailto"].includes(scheme)) return `source element ${element.id} has an unsafe Tangent reference`;
    try { new URL(reference); } catch { return `source element ${element.id} has an unsafe Tangent reference`; }
    return null;
  }
  const hash = reference.indexOf("#");
  const file = hash < 0 ? reference : reference.slice(0, hash);
  const normalized = path.posix.normalize(file);
  if (!file || path.posix.isAbsolute(file) || file.includes("\\") || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized !== file) return `source element ${element.id} has an unsafe Tangent reference`;
  return null;
}

/** Validates every persisted cross-Area endpoint pair in one element. */
function endpointMetadataError(element, owners) {
  /** Validates one pair or pair collection below an endpoint-named metadata key. */
  function validateEndpoint(value, at) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateEndpoint(value[index], `${at}[${index}]`);
        if (error) return error;
      }
      return null;
    }
    if (typeof value !== "object") return `${at} must be an endpoint {owner, sourceId}`;
    const hasOwner = Object.hasOwn(value, "owner");
    const hasSourceId = Object.hasOwn(value, "sourceId");
    if (hasOwner || hasSourceId) {
      if (!hasOwner || !hasSourceId) return `${at} must be an endpoint {owner, sourceId}`;
      if (typeof value.owner !== "string" || !owners.has(value.owner)) return `${at} has an endpoint owner outside the current Area tree`;
      if (!safeSourceId(value.sourceId)) return `${at} has an unsafe endpoint sourceId`;
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      const error = validateEndpoint(child, `${at}.${key}`);
      if (error) return error;
    }
    return null;
  }
  /** Finds endpoint-named metadata without treating ordinary owner fields as endpoints. */
  function visit(value, at) {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const error = visit(value[index], `${at}[${index}]`);
        if (error) return error;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      const error = /endpoints?$/i.test(key) ? validateEndpoint(child, `${at}.${key}`) : visit(child, `${at}.${key}`);
      if (error) return error;
    }
    return null;
  }
  return visit(element.customData, `source element ${element.id}.customData`);
}

/** Returns the source IDs that each owner will contain after one gesture. */
function futureSourceIds(state, mutations) {
  const result = new Map(state.owners.map((owner) => [owner, new Set((state.reads.get(owner)?.scene?.elements ?? []).map((element) => element.id).filter(safeSourceId))]));
  for (const mutation of mutations) {
    const ids = result.get(mutation?.owner);
    if (!ids) continue;
    for (const sourceId of Array.isArray(mutation.remove) ? mutation.remove : []) if (safeSourceId(sourceId)) ids.delete(sourceId);
    for (const element of Array.isArray(mutation.put) ? mutation.put : []) if (safeSourceId(element?.id)) ids.add(element.id);
  }
  return result;
}

/** Rejects a source binding that resolves only inside another owner's shard. */
function sourceBindingError(element, owner, idsByOwner) {
  const bindings = [];
  /** Records one nullable Excalidraw binding. */
  function addBinding(value, field, idField = "elementId") {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value) || !safeSourceId(value[idField])) return `source element ${element.id} has an unsafe ${field}`;
    bindings.push([field, value[idField]]);
    return null;
  }
  for (const field of ["startBinding", "endBinding"]) {
    const error = addBinding(element[field], field);
    if (error) return error;
  }
  for (const field of ["containerId", "frameId"]) {
    const sourceId = element[field];
    if (sourceId === null || sourceId === undefined) continue;
    if (!safeSourceId(sourceId)) return `source element ${element.id} has an unsafe ${field}`;
    bindings.push([field, sourceId]);
  }
  if (element.boundElements !== null && element.boundElements !== undefined) {
    if (!Array.isArray(element.boundElements)) return `source element ${element.id} has unsafe boundElements`;
    for (const [index, binding] of element.boundElements.entries()) {
      const error = addBinding(binding, `boundElements[${index}]`, "id");
      if (error) return error;
    }
  }
  const local = idsByOwner.get(owner) ?? new Set();
  for (const [field, sourceId] of bindings) {
    if (local.has(sourceId)) continue;
    const foreign = [...idsByOwner].find(([candidate, ids]) => candidate !== owner && ids.has(sourceId));
    if (foreign) return `source element ${element.id} ${field} binds across source owners to ${foreign[0]}:${sourceId}`;
  }
  return null;
}

/** Validates one complete source element at the mutation boundary. */
function sourceElementError(element, owners) {
  if (!element || typeof element !== "object" || Array.isArray(element)) return "put entries must be source elements";
  if (typeof element.id !== "string" || !element.id || element.id.length > 256 || element.id.includes("\0")) return "source element IDs must be safe non-empty strings";
  if (element.id.startsWith("tw-") || composedIdentity(element)) return "runtime IDs and composed metadata are not source mutations";
  if (["x", "y", "width", "height", "angle"].some((field) => typeof element[field] !== "number" || !Number.isFinite(element[field]))) return `source element ${element.id} has non-finite geometry`;
  if (element.width < 0 || element.height < 0) return `source element ${element.id} has negative geometry`;
  const referenceError = tangentReferenceError(element);
  if (referenceError) return referenceError;
  const endpointError = endpointMetadataError(element, owners);
  if (endpointError) return endpointError;
  return null;
}

/** Builds complete structural world snapshots over the per-Area shard repository. */
export function createAreaMapWorldIndex({ root, repository, listAreas, runGit = null }) {
  const summaryCache = new Map();
  const baselineCache = new Map();
  const fallbackCache = new Map();
  const revisionStates = new Map();
  const worldIdPromise = realpath(root).catch(() => path.resolve(root)).then((resolved) => digest(resolved));

  /** Reads and summarizes the current complete tree under any outer read lease. */
  async function readStateUnlocked(locatedArea = null) {
    const areaKeys = [...new Set(await listAreas())].filter((area) => area && area !== ROOT_OWNER).sort();
    if (locatedArea && !areaKeys.includes(locatedArea)) return null;
    const owners = [ROOT_OWNER, ...areaKeys];
    const reads = new Map(await Promise.all(owners.map(async (owner) => {
      try { return [owner, await repository.read(owner)]; }
      catch (error) { return [owner, { area: owner, exists: true, ok: false, hash: null, errors: [error.message], scene: null }]; }
    })));
    const children = new Map();
    const relations = new Map();
    for (const area of areaKeys) {
      const parent = parentFor(area); relations.set(area, parent);
      const values = children.get(parent) ?? []; values.push(area); children.set(parent, values);
    }
    for (const values of children.values()) values.sort();
    const summaries = new Map();
    for (const owner of owners) {
      const shard = reads.get(owner);
      const key = `${owner}\0${shardRevision(shard)}`;
      let raw = summaryCache.get(key);
      if (!raw) {
        let structural = shard;
        if (shard.ok === false) {
          const pending = fallbackCache.get(key) ?? cacheSet(fallbackCache, key, readLastCommittedValidMapScene({ root, runGit, area: owner }));
          const fallback = await pending;
          if (fallback) structural = { ...shard, scene: fallback };
        }
        raw = cacheSet(summaryCache, key, rawShardSummary(owner, structural));
      }
      let baseline = null;
      if (raw.areaCards.length) {
        const pending = baselineCache.get(key) ?? cacheSet(baselineCache, key, readFirstCommittedMapBaseline({ root, runGit, area: owner, current: shard }));
        baseline = await pending;
      }
      summaries.set(owner, adaptShardSummary(raw, children.get(owner) ?? [], baseline));
    }
    const { regions } = buildRegionRecords(areaKeys, summaries, children);
    const projectedScenes = new Map(owners.map((owner) => [owner, projectedShardScene(owner, summaries.get(owner), regions)]));
    const treeRevision = digest(areaKeys.map((area) => `${area}>${relations.get(area)}`).join("\n"));
    const worldRevision = digest(`${treeRevision}\n${owners.map((owner) => `${owner}:${shardRevision(reads.get(owner))}`).join("\n")}`);
    const locatedDepth = locatedArea?.split("/").length ?? 0;
    /** Reports whether one Area is on the located ancestor path. */
    const onPath = (area) => Boolean(locatedArea && (locatedArea === area || locatedArea.startsWith(`${area}/`)));
    /** Reports whether one Area is in the initial descendant load band. */
    const inEagerSubtree = (area) => Boolean(locatedArea && (area === locatedArea || area.startsWith(`${locatedArea}/`) && area.split("/").length <= locatedDepth + 2));
    /** Projects one source shard into its public descriptor. */
    const descriptor = (owner, eager = false) => {
      const shard = reads.get(owner); const summary = summaries.get(owner);
      const state = shard.ok === false ? "unreadable" : !shard.exists ? "missing" : eager ? "ready" : "deferred";
      return {
        owner, file: shard.file ?? null, hash: shard.hash ?? null, state,
        elementCount: summary.elementCount, blockCount: summary.blockCount,
        ownBlockHull: summary.ownBlockHull, ownInkHull: summary.ownInkHull,
        ...(eager && shard.ok !== false ? { scene: projectedScenes.get(owner) } : {}),
        ...(shard.errors?.length ? { errors: shard.errors } : {}),
        ...(summary.migration.legacyBoundaries || summary.migration.legacyCards ? { migration: summary.migration } : {}),
      };
    };
    const areas = areaKeys.map((key) => ({
      key, parent: relations.get(key), children: children.get(key) ?? [], depth: key.split("/").length - 1,
      region: regions.get(key),
      shard: descriptor(key, onPath(key) || inEagerSubtree(key)),
    }));
    const world = {
      schema: "area-map-world.v1", worldId: await worldIdPromise, treeRevision, worldRevision, locatedArea,
      rootShard: descriptor(ROOT_OWNER, false), areas,
    };
    const state = { world, areaKeys, owners, reads, summaries, projectedScenes, regions, relations, children };
    revisionStates.set(worldRevision, state);
    if (revisionStates.size > 8) revisionStates.delete(revisionStates.keys().next().value);
    return state;
  }

  /** Holds one repository read lease across both the Area tree and every shard. */
  async function readState(locatedArea = null) {
    /** Reads the state inside the selected repository lease policy. */
    const read = () => readStateUnlocked(locatedArea);
    return typeof repository.withRead === "function" ? repository.withRead(read) : read();
  }

  /** Reads one complete structural world snapshot. */
  async function snapshot(locatedArea) {
    return (await readState(locatedArea))?.world ?? null;
  }

  /** Reads one deferred shard only while that shard still matches its snapshot descriptor. */
  async function shard(area, worldRevision, locatedArea) {
    let state = revisionStates.get(worldRevision);
    if (!state) {
      const current = await readState(locatedArea);
      state = current?.world.worldRevision === worldRevision ? current : null;
    }
    if (!state) return { status: 409, error: "map world changed", worldRevision: null };
    const node = state.world.areas.find((entry) => entry.key === area);
    if (!node) return { status: 404, error: `no Area ${area}` };
    const current = await repository.read(area);
    if (shardRevision(current) !== shardRevision(state.reads.get(area))) return { status: 409, error: "map shard changed", worldRevision };
    return { status: 200, area, worldRevision, hash: current.hash, state: current.ok === false ? "unreadable" : current.exists ? "ready" : "missing", scene: current.ok === false ? undefined : state.projectedScenes.get(area), errors: current.errors ?? [] };
  }

  /** Applies one validated source-space gesture through the injected transaction adapter. */
  async function applyGesture(request, saveGesture) {
    if (request?.schema !== "area-map-gesture.v1") return { status: 400, error: "gesture schema must be area-map-gesture.v1" };
    if (request.scene !== undefined || request.elements !== undefined || request.composedScene !== undefined || request.tangentWorld !== undefined) return { status: 422, error: "a map gesture accepts source mutations, not a composed scene" };
    const operationId = String(request.operationId ?? "").trim();
    if (!operationId || operationId.length > 128 || operationId.includes("\0")) return { status: 400, error: "a safe operation ID is required" };
    if (typeof request.treeRevision !== "string" || !request.treeRevision || request.treeRevision.includes("\0")) return { status: 400, error: "a safe tree revision is required" };
    if (!Array.isArray(request.mutations) || !request.mutations.length) return { status: 422, error: "a gesture must contain source mutations" };
    const state = await readState();
    if (request.worldId !== state.world.worldId) return { status: 409, conflict: true, code: "world-conflict", error: "map world changed", worldId: state.world.worldId };
    const ownerSet = new Set(state.owners);
    const idsByOwner = futureSourceIds(state, request.mutations);
    const byOwner = new Set();
    const writes = [];
    for (const mutation of request.mutations) {
      const owner = String(mutation?.owner ?? "");
      if (!state.owners.includes(owner)) return { status: 409, conflict: true, code: "tree-conflict", error: `Area relation changed for ${owner || "(none)"}`, treeRevision: state.world.treeRevision };
      if (byOwner.has(owner)) return { status: 422, error: `source owner ${owner} appears more than once` };
      byOwner.add(owner);
      if (!Array.isArray(mutation.put) || !Array.isArray(mutation.remove)) return { status: 422, error: `source mutation ${owner} needs put and remove arrays` };
      if (mutation.baseHash !== null && mutation.baseHash !== undefined && (typeof mutation.baseHash !== "string" || mutation.baseHash.includes("\0"))) return { status: 422, error: `source mutation ${owner} has an unsafe base hash` };
      const ids = new Set();
      for (const element of mutation.put) {
        const error = sourceElementError(element, ownerSet); if (error) return { status: 422, error };
        const bindingError = sourceBindingError(element, owner, idsByOwner); if (bindingError) return { status: 422, error: bindingError };
        if (ids.has(element.id)) return { status: 422, error: `source ID ${element.id} appears more than once for ${owner}` };
        ids.add(element.id);
        const authoritativeRegion = [...state.regions.values()].find((region) => region.owner === owner && region.sourceId === element.id);
        if (authoritativeRegion && !isAreaRegion(element)) return { status: 422, error: `Area region ${element.id} must stay a direct-child region` };
        if (isAreaRegion(element)) {
          const child = areaForBlock(element);
          const expected = state.regions.get(child);
          if (!expected || expected.owner !== owner || expected.sourceId !== element.id) return { status: 409, conflict: true, code: "tree-conflict", error: `${child || element.id} is not the current direct-child region of ${owner}`, treeRevision: state.world.treeRevision };
          if (element.isDeleted || element.width <= 0 || element.height <= 0 || element.angle !== 0) return { status: 422, error: `Area region ${element.id} needs visible positive unrotated source geometry` };
        }
      }
      for (const sourceId of mutation.remove) {
        if (typeof sourceId !== "string" || !sourceId || sourceId.startsWith("tw-") || sourceId.includes("\0")) return { status: 422, error: "remove IDs must be safe source IDs" };
        if (ids.has(sourceId)) return { status: 422, error: `source ID ${sourceId} appears more than once for ${owner}` };
        ids.add(sourceId);
        if ([...state.regions.values()].some((region) => region.owner === owner && region.sourceId === sourceId)) return { status: 422, error: "Area regions come from the Area tree" };
      }
      const current = state.reads.get(owner);
      if (current.ok === false) return { status: 409, conflict: true, error: `map file unreadable for ${owner}` };
      const scene = structuredClone(current.scene);
      const puts = new Map(mutation.put.map((element) => [element.id, structuredClone(element)]));
      const removals = new Set([...mutation.remove, ...state.summaries.get(owner).boundaryIds, ...state.summaries.get(owner).retiredIds, ...state.summaries.get(owner).staleRegionIds]);
      const existing = new Set(scene.elements.map((element) => element.id));
      scene.elements = scene.elements.flatMap((element) => removals.has(element.id) ? [] : puts.has(element.id) ? [puts.get(element.id)] : [element]);
      for (const [sourceId, element] of puts) if (!existing.has(sourceId)) scene.elements.push(element);
      const validation = validateAreaCanvas(scene);
      if (!validation.ok) return { status: 422, error: validation.errors.join("; ") };
      writes.push({ owner, area: owner, baseHash: mutation.baseHash ?? null, canvas: scene, reason: String(request.reason ?? "map gesture").slice(0, 120) });
    }
    if (typeof saveGesture !== "function") return { status: 503, error: "map transaction writer is unavailable" };
    try {
      const result = await saveGesture(writes, { operationId, area: writes[0].area, worldId: state.world.worldId, treeRevision: state.world.treeRevision });
      const status = result.status ?? 200;
      if (status >= 400) return { ...result, status, treeRevision: state.world.treeRevision, worldRevision: state.world.worldRevision };
      const acknowledged = await readState();
      return { ...result, status, worldId: acknowledged.world.worldId, treeRevision: acknowledged.world.treeRevision, worldRevision: acknowledged.world.worldRevision };
    } catch (error) {
      return { status: 503, error: String(error?.message ?? error), operationId };
    }
  }

  return { applyGesture, shard, snapshot };
}
