import {
  areaResourceTargetFingerprint,
  safeAreaResourceOwner,
} from "./area-resource-catalog.mjs";
import { inspectAreaResourceTarget } from "./area-resource-mutations.mjs";
import { isSafeResourceId } from "./public/area-map-entities.js";

const MAX_RESOURCES = 500;
const DEFAULT_DISCOVERY_AREAS = 64;

/** A stable public failure for one composed Area-resource operation. */
export class AreaResourceServiceError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.name = "AreaResourceServiceError";
    this.status = status;
    this.code = code;
    this.retryable = fields.retryable === true;
    Object.assign(this, fields);
  }
}

/** Throws one bounded resource-service failure. */
function fail(status, code, message, fields = {}) {
  throw new AreaResourceServiceError(status, code, message, fields);
}

/** Stable JSON used only for suggestion identities whose object key order is not authority. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Returns the durable evidence identity shared by suggestions and decisions. */
function suggestionIdentity(value) {
  return canonicalJson([value?.evidence, value?.evidenceHash, value?.targetFingerprint]);
}

/** Returns the complete opaque locator identity or null. */
function validLocator(value) {
  if (!safeAreaResourceOwner(value?.owner) || !isSafeResourceId(value?.id)) return null;
  return { owner: value.owner, id: value.id };
}

/** Validates the bounded ordered locator request shared by resolve and refresh. */
function requestedLocators(input) {
  const resources = input?.resources ?? input?.locators;
  if (!Array.isArray(resources)) fail(400, "invalid-resource-request", "A resource locator list is required.");
  if (resources.length > MAX_RESOURCES) fail(400, "invalid-resource-request", `At most ${MAX_RESOURCES} Map resources can be requested at once.`);
  return resources.map((resource) => {
    const locator = validLocator(resource?.locator ?? resource);
    if (!locator) fail(422, "invalid-resource-target", "A resource locator has an unsafe owner or ID.");
    const representation = resource?.representation;
    if (representation !== undefined && !["on-map", "hidden"].includes(representation)) {
      fail(422, "invalid-resource-target", "A retained resource representation must be on-map or hidden.");
    }
    let lastKnown = null;
    if (resource?.lastKnown !== undefined && resource.lastKnown !== null) {
      if (typeof resource.lastKnown?.label !== "string") fail(422, "invalid-resource-target", "Retained resource facts need a label and valid target.");
      try { areaResourceTargetFingerprint(resource.lastKnown.target); }
      catch { fail(422, "invalid-resource-target", "Retained resource facts need a label and valid target."); }
      lastKnown = { label: resource.lastKnown.label, target: structuredClone(resource.lastKnown.target) };
    }
    return {
      ...locator,
      ...(representation === undefined ? {} : { representation }),
      ...(lastKnown === null ? {} : { lastKnown }),
    };
  });
}

/** Returns the entity carried by one current resolution. */
function currentEntity(resolution) {
  return resolution?.state === "current" ? resolution.value ?? null : null;
}

/** Returns a catalog-backed target from one panel row. */
function rowTarget(row) {
  return row?.entity?.target ?? row?.entity?.lastKnown?.target ?? null;
}

/** Returns the direct selected-Area target fingerprints that already have membership. */
function directTargetFingerprints(projection, area) {
  const fingerprints = new Set();
  for (const row of projection?.rows ?? []) {
    if (row?.relation?.kind !== "direct" || row?.entity?.locator?.owner !== area || row?.entity?.reason) continue;
    const target = rowTarget(row);
    if (!target) continue;
    try { fingerprints.add(areaResourceTargetFingerprint(target)); } catch { /* Invalid facts stay projection-owned problems. */ }
  }
  return fingerprints;
}

/** Merges explicit discovery into side-effect-free projection Suggestions. */
function mergeSuggestions(projection, discovered, evidence) {
  if (!projection || projection.state === "unavailable") return projection;
  const decisions = new Set((evidence?.decisions ?? []).map(suggestionIdentity));
  const confirmed = directTargetFingerprints(projection, evidence?.owner ?? projection.viewedFrom);
  const merged = [];
  const identities = new Set();
  const targets = new Set();
  for (const suggestion of [...(projection.suggestions ?? []), ...(discovered ?? [])]) {
    const identity = suggestionIdentity(suggestion);
    if (decisions.has(identity) || identities.has(identity) || confirmed.has(suggestion?.targetFingerprint)) continue;
    // One current candidate per normalized target keeps repeated Attempt and repository
    // evidence from producing parallel rows. The source ordering chooses its provenance.
    if (targets.has(suggestion?.targetFingerprint)) continue;
    identities.add(identity);
    targets.add(suggestion?.targetFingerprint);
    merged.push(suggestion);
  }
  const legacyReview = projection.legacyReview ?? [];
  const counts = projection.state === "current"
    ? {
        state: "current",
        confirmedAssociations: projection.counts?.confirmedAssociations ?? projection.rows?.length ?? 0,
        suggestions: merged.length,
        legacyReview: legacyReview.length,
      }
    : {
        state: "lower-bound",
        confirmedAssociationsAtLeast: projection.counts?.confirmedAssociationsAtLeast ?? projection.rows?.length ?? 0,
        suggestionsAtLeast: merged.length,
        legacyReviewAtLeast: legacyReview.length,
      };
  return { ...projection, suggestions: merged, legacyReview, counts };
}

/** Keeps recent explicit-discovery results bounded by selected Area. */
export function createAreaResourceDiscoveryStore({ capacity = DEFAULT_DISCOVERY_AREAS } = {}) {
  const entries = new Map();
  let access = 0;

  /** Records the last terminal discovery result without turning it into membership. */
  function set(area, result) {
    if (!safeAreaResourceOwner(area)) return;
    if (!entries.has(area) && entries.size >= capacity) {
      const victim = [...entries.entries()].sort((left, right) => left[1].access - right[1].access)[0];
      if (victim) entries.delete(victim[0]);
    }
    entries.set(area, { access: ++access, result: structuredClone(result) });
  }

  /** Reads one result without starting discovery. */
  function get(area) {
    const entry = entries.get(area);
    if (!entry) return null;
    entry.access = ++access;
    return structuredClone(entry.result);
  }

  /** Clears stale owner paths after structural Area changes. */
  function clear(area = null) {
    if (area === null) entries.clear();
    else entries.delete(area);
  }

  /** Reports bounded process-memory occupancy without revealing targets. */
  function status() { return { size: entries.size, capacity }; }

  return { clear, get, set, status };
}

/** Creates the composed read, discovery, observation, mutation, and representation service. */
export function createAreaResourceService({
  projection,
  observations,
  mutations,
  representations,
  discover,
  jobsRoot = null,
  areaExists = async () => true,
  inspectTarget = inspectAreaResourceTarget,
  discoveryStore = createAreaResourceDiscoveryStore(),
} = {}) {
  if (!projection?.read || !projection?.resolve || !projection?.evidence) throw new TypeError("resource service requires projection read, resolve, and evidence operations");
  if (!observations?.refresh) throw new TypeError("resource service requires observation refresh authority");
  if (!mutations?.apply || !representations?.apply || typeof discover !== "function") throw new TypeError("resource service requires mutation, representation, and discovery operations");

  /** Requires one physical selected Area without accepting the logical root. */
  async function requireArea(area) {
    const safe = safeAreaResourceOwner(area);
    if (!safe) fail(422, "invalid-resource-target", "A physical Area is required for Map resources.");
    if (!await areaExists(safe)) fail(404, "area-not-found", `No Area ${safe}.`);
    return safe;
  }

  /** Returns durable evidence plus the current explicit-discovery view. */
  async function evidence(input) {
    const area = await requireArea(typeof input === "string" ? input : input?.area);
    const base = await projection.evidence({ area, ...(Array.isArray(input?.owners) ? { owners: input.owners } : {}) });
    if (!base || base.state === "unavailable") return base;
    const panel = await projection.read({ area });
    const merged = mergeSuggestions(panel, discoveryStore.get(area)?.suggestions, { ...base, owner: area });
    return { ...base, suggestions: merged?.suggestions ?? base.suggestions ?? [] };
  }

  /** Reads the panel without starting Git, provider, or filesystem observation work. */
  async function read(input) {
    const area = await requireArea(typeof input === "string" ? input : input?.area);
    const panel = await projection.read({ area });
    let facts = { owner: area, decisions: [] };
    try { facts = { ...await projection.evidence({ area }), owner: area }; }
    catch { /* The panel owns source-specific partial/unavailable facts for GET. */ }
    return mergeSuggestions(panel, discoveryStore.get(area)?.suggestions, { ...facts, owner: area });
  }

  /** Resolves an ordered locator list strictly from catalogs, sources, and cached facts. */
  async function resolve(input) {
    const resources = requestedLocators(input);
    return projection.resolve({ resources });
  }

  /** Refreshes only current entities, then resolves the same ordered request again. */
  async function refresh(input, { signal } = {}) {
    const resources = requestedLocators(input);
    const before = await projection.resolve({ resources });
    const current = (before?.resolutions ?? []).map(currentEntity).filter(Boolean);
    await observations.refresh(current, { signal });
    const after = await projection.resolve({ resources });
    return { ...after, results: after?.resolutions ?? [] };
  }

  /** Runs explicit bounded discovery and retains its selectable suggestions in process memory. */
  async function runDiscovery(input, { signal } = {}) {
    const area = await requireArea(input?.area);
    const panel = await read({ area });
    if (panel?.state === "unavailable") {
      fail(Number(panel.error?.status ?? 409), panel.error?.code ?? "catalog-load-failed", panel.error?.message ?? "Map resources could not be loaded.", { retryable: panel.error?.retryable === true });
    }
    const repositories = (panel?.rows ?? []).map((row) => row?.entity).filter((entity) => entity?.target?.kind === "repository" && !entity.reason);
    const result = await discover({ area, repositories, jobsRoot, signal });
    const facts = await projection.evidence({ area });
    const merged = mergeSuggestions({ ...panel, suggestions: [] }, result?.suggestions ?? [], { ...facts, owner: area });
    const terminal = { ...result, area, suggestions: merged?.suggestions ?? [] };
    discoveryStore.set(area, terminal);
    return terminal;
  }

  /** Applies one catalog mutation using evidence from the same service view. */
  async function apply(input) {
    const result = await mutations.apply(input);
    if (Number(result?.status ?? 200) < 400) {
      const reviewed = input?.mutation?.kind === "add-suggestion" ? input.mutation.selection?.suggestion
        : input?.mutation?.kind === "dismiss-suggestion" ? input.mutation.suggestion
          : null;
      const retained = reviewed ? discoveryStore.get(input.viewedFrom) : null;
      if (reviewed && retained) {
        const identity = suggestionIdentity(reviewed);
        discoveryStore.set(input.viewedFrom, {
          ...retained,
          suggestions: (retained.suggestions ?? []).filter((item) => suggestionIdentity(item) !== identity),
        });
      }
    }
    return result;
  }

  /** Applies one canonical source representation mutation. */
  async function representation(input) {
    return representations.apply(input);
  }

  return {
    apply,
    discover: runDiscovery,
    discoveryStore,
    evidence,
    inspectTarget,
    read,
    refresh,
    representation,
    resolve,
  };
}

export default { createAreaResourceDiscoveryStore, createAreaResourceService };
