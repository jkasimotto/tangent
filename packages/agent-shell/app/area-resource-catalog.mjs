import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { areaAncestors } from "./area-agent-command.mjs";

export const AREA_RESOURCE_CATALOG_SCHEMA = "area-map-resources.v1";
export const AREA_RESOURCE_CATALOG_NAME = "map-resources.json";

const TARGET_KINDS = new Set(["worktree", "repository", "link"]);
const SUGGESTED_TARGET_KINDS = new Set([...TARGET_KINDS, "local-path"]);
const LOCAL_TARGET_KINDS = new Set(["worktree", "repository", "local-path"]);
const EVIDENCE_KINDS = new Set(["legacy-area-binding", "knowledge-line", "attempt", "git-worktree"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stable, typed failure used by target inspection and catalog serialization. */
export class AreaResourceCatalogError extends Error {
  constructor(code, message, { retryable = false, details = undefined } = {}) {
    super(message);
    this.name = "AreaResourceCatalogError";
    this.code = code;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
  }
}

/** Creates a new empty catalog without sharing mutable arrays. */
export function emptyAreaResourceCatalog() {
  return { schema: AREA_RESOURCE_CATALOG_SCHEMA, resources: [], suggestionDecisions: [] };
}

/** Returns the SHA-256 revision of exact persisted bytes. */
export function areaResourceCatalogRevision(bytes) {
  return createHash("sha256").update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes))).digest("hex");
}

/** Returns a safe physical Area owner, or null for a logical or unsafe path. */
export function safeAreaResourceOwner(value) {
  if (typeof value !== "string" || !value || value === "@root" || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.endsWith("/")) return null;
  const normalized = path.posix.normalize(value);
  const parts = value.split("/");
  if (normalized !== value || parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return null;
  return value;
}

/** Returns the vault-relative catalog file for one safe physical Area. */
export function areaResourceCatalogPath(owner) {
  const safe = safeAreaResourceOwner(owner);
  return safe ? `${safe}/${AREA_RESOURCE_CATALOG_NAME}` : null;
}

/** Resolves one exact vault-relative catalog file beneath a vault root. */
export function safeAreaResourceCatalogPath(root, file) {
  if (typeof root !== "string" || !root || root.includes("\0")) return null;
  const suffix = `/${AREA_RESOURCE_CATALOG_NAME}`;
  const owner = typeof file === "string" && file.endsWith(suffix) ? file.slice(0, -suffix.length) : null;
  const relative = areaResourceCatalogPath(owner);
  if (!relative || file !== relative) return null;
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relative);
  if (!absolute.startsWith(`${absoluteRoot}${path.sep}`)) return null;
  return { owner, relative, absolute };
}

/** Returns stable JSON for evidence identities without depending on key order. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Throws a bounded invalid-target error. */
function invalidTarget(message) {
  throw new AreaResourceCatalogError("invalid-resource-target", message);
}

/** Expands and normalizes one local path without filesystem identity lookups. */
function normalizeLocalPath(value, home) {
  if (typeof value !== "string" || !value || value.includes("\0")) invalidTarget("A local resource target must be a safe absolute path.");
  let expanded = value;
  if (value === "~") expanded = home;
  else if (value.startsWith("~/")) expanded = path.join(home, value.slice(2));
  else if (value.startsWith("~")) invalidTarget("A local resource target can expand only the current home folder.");
  if (!path.isAbsolute(expanded)) invalidTarget("A local resource target must be an absolute path.");
  let normalized = path.normalize(expanded);
  const root = path.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith(path.sep)) normalized = normalized.slice(0, -1);
  return normalized;
}

/** Lowercases only the authority's host token while retaining every other recorded URL byte. */
function normalizeHttpUrl(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) {
    invalidTarget("A Link resource target must be a safe HTTP or HTTPS URL.");
  }
  const match = value.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([\s\S]*)$/i);
  if (!match || !/^https?$/i.test(match[1])) invalidTarget("A Link resource target must use HTTP or HTTPS.");
  let parsed;
  try { parsed = new URL(value); } catch { invalidTarget("A Link resource target must be a valid HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) invalidTarget("A Link resource target must be a valid HTTP or HTTPS URL.");

  const authority = match[2];
  const at = authority.lastIndexOf("@");
  const userInfo = at >= 0 ? authority.slice(0, at + 1) : "";
  const hostAndPort = authority.slice(at + 1);
  let host;
  let port;
  if (hostAndPort.startsWith("[")) {
    const closing = hostAndPort.indexOf("]");
    if (closing < 0) invalidTarget("A Link resource target must contain a valid host.");
    host = hostAndPort.slice(0, closing + 1);
    port = hostAndPort.slice(closing + 1);
  } else {
    const colon = hostAndPort.lastIndexOf(":");
    host = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
    port = colon >= 0 ? hostAndPort.slice(colon) : "";
  }
  if (!host) invalidTarget("A Link resource target must contain a valid host.");
  return `${match[1]}://${userInfo}${host.toLowerCase()}${port}${match[3]}`;
}

/** Ensures that an input and all additive fields remain JSON data. */
function jsonErrors(value, at = "catalog", seen = new Set(), errors = []) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return errors;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${at} must contain finite JSON numbers`);
    return errors;
  }
  if (typeof value !== "object") {
    errors.push(`${at} must contain only JSON values`);
    return errors;
  }
  if (seen.has(value)) {
    errors.push(`${at} must not contain a cycle`);
    return errors;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    errors.push(`${at} must contain only JSON objects`);
    return errors;
  }
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => jsonErrors(item, `${at}[${index}]`, seen, errors));
  else for (const [key, item] of Object.entries(value)) jsonErrors(item, `${at}.${key}`, seen, errors);
  seen.delete(value);
  return errors;
}

/** Normalizes one persisted or suggested target while preserving additive fields. */
export function normalizeAreaResourceTarget(target, { home = os.homedir(), allowLocalPath = false } = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) invalidTarget("A resource target must be an object.");
  const accepted = allowLocalPath ? SUGGESTED_TARGET_KINDS : TARGET_KINDS;
  if (!accepted.has(target.kind)) invalidTarget("The resource target kind is unsupported.");
  if (jsonErrors(target, "target").length) invalidTarget("A resource target must contain only JSON values.");
  if (LOCAL_TARGET_KINDS.has(target.kind)) return { ...target, path: normalizeLocalPath(target.path, home) };
  return { ...target, url: normalizeHttpUrl(target.url) };
}

/** Returns a target's kind-aware SHA-256 identity after exact normalization. */
export function areaResourceTargetFingerprint(target, options = {}) {
  const normalized = normalizeAreaResourceTarget(target, { ...options, allowLocalPath: true });
  const value = LOCAL_TARGET_KINDS.has(normalized.kind) ? normalized.path : normalized.url;
  return createHash("sha256").update(canonicalJson({ kind: normalized.kind, value })).digest("hex");
}

/** Returns the normalized target value used for same-Area relation checks. */
function targetRelation(target) {
  const normalized = normalizeAreaResourceTarget(target, { allowLocalPath: true });
  return {
    domain: LOCAL_TARGET_KINDS.has(normalized.kind) ? "local" : "link",
    kind: normalized.kind,
    value: LOCAL_TARGET_KINDS.has(normalized.kind) ? normalized.path : normalized.url,
  };
}

/** True when a value is a non-array object. */
function object(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
/** True when a required persisted string is non-empty and NUL-free. */
function safeString(value) { return typeof value === "string" && value.length > 0 && !value.includes("\0"); }
/** True when a value is a parseable persisted timestamp. */
function validTime(value) { return safeString(value) && Number.isFinite(Date.parse(value)); }
/** True when a value has the opaque UUID representation used by resource refs. */
function validId(value) { return typeof value === "string" && UUID.test(value); }

/** Adds one known/unknown discriminant problem with the correct compatibility class. */
function discriminant(value, accepted, at, errors, unsupported) {
  if (typeof value !== "string" || !value) errors.push(`${at} must have a discriminant`);
  else if (!accepted.has(value)) unsupported.push(`${at} uses unsupported discriminant ${JSON.stringify(value)}`);
}

/** Validates one closed persisted target variant. */
function validateTarget(target, at, errors, unsupported) {
  if (!object(target)) { errors.push(`${at} must be an object`); return null; }
  discriminant(target.kind, TARGET_KINDS, `${at}.kind`, errors, unsupported);
  if (!TARGET_KINDS.has(target.kind)) return null;
  try { normalizeAreaResourceTarget(target); }
  catch (error) { errors.push(`${at} is invalid: ${error.message}`); }
  return target.kind;
}

/** Validates active or removed membership without discarding extra fields. */
function validateMembership(membership, at, errors, unsupported) {
  if (!object(membership)) { errors.push(`${at} must be an object`); return null; }
  discriminant(membership.state, new Set(["active", "removed"]), `${at}.state`, errors, unsupported);
  if (membership.state === "removed" && !validTime(membership.removedAt)) errors.push(`${at}.removedAt must be a timestamp`);
  return membership.state;
}

/** Validates one optional legacy import origin against its local target. */
function validateOrigin(origin, targetKind, at, errors, unsupported) {
  if (origin === null) return;
  if (!object(origin)) { errors.push(`${at} must be null or an object`); return; }
  discriminant(origin.kind, new Set(["legacy-area-binding"]), `${at}.kind`, errors, unsupported);
  if (origin.kind !== "legacy-area-binding") return;
  if (!["Repository", "Worktree"].includes(origin.field)) {
    if (typeof origin.field === "string") unsupported.push(`${at}.field uses unsupported discriminant ${JSON.stringify(origin.field)}`);
    else errors.push(`${at}.field must be Repository or Worktree`);
  }
  if (!safeString(origin.evidenceHash)) errors.push(`${at}.evidenceHash must be a non-empty string`);
  if (origin.declaredBranch !== null && !safeString(origin.declaredBranch)) errors.push(`${at}.declaredBranch must be a non-empty string or null`);
  const expected = targetKind === "worktree" ? "Worktree" : targetKind === "repository" ? "Repository" : null;
  if (!expected || origin.field !== expected) errors.push(`${at}.field does not match the resource target kind`);
}

/** Validates one closed suggestion evidence identity. */
function validateEvidence(evidence, at, errors, unsupported) {
  if (!object(evidence)) { errors.push(`${at} must be an object`); return null; }
  discriminant(evidence.kind, EVIDENCE_KINDS, `${at}.kind`, errors, unsupported);
  if (!EVIDENCE_KINDS.has(evidence.kind)) return null;
  if (evidence.kind === "legacy-area-binding") {
    if (!["Repository", "Worktree"].includes(evidence.field)) {
      if (typeof evidence.field === "string") unsupported.push(`${at}.field uses unsupported discriminant ${JSON.stringify(evidence.field)}`);
      else errors.push(`${at}.field must be Repository or Worktree`);
    }
  } else if (evidence.kind === "attempt") {
    for (const field of ["jobSlug", "assignmentId", "attemptId"]) if (!safeString(evidence[field])) errors.push(`${at}.${field} must be a non-empty string`);
    if (!Number.isInteger(evidence.run) || evidence.run < 1) errors.push(`${at}.run must be a positive integer`);
  } else if (evidence.kind === "git-worktree") {
    for (const field of ["repositoryTargetFingerprint", "pathFingerprint"]) if (!safeString(evidence[field])) errors.push(`${at}.${field} must be a non-empty string`);
  }
  return evidence.kind;
}

/** Validates the full closed catalog while retaining additive JSON fields. */
export function validateAreaResourceCatalog(catalog) {
  const errors = jsonErrors(catalog);
  const unsupported = [];
  if (!object(catalog)) return { ok: false, code: "catalog-invalid", errors: ["catalog must be an object"] };
  if (typeof catalog.schema !== "string" || !catalog.schema) errors.push("catalog.schema must be a string");
  else if (catalog.schema !== AREA_RESOURCE_CATALOG_SCHEMA) unsupported.push(`catalog.schema ${JSON.stringify(catalog.schema)} is unsupported`);
  if (!Array.isArray(catalog.resources)) errors.push("catalog.resources must be an array");
  if (!Array.isArray(catalog.suggestionDecisions)) errors.push("catalog.suggestionDecisions must be an array");
  if (!Array.isArray(catalog.resources) || !Array.isArray(catalog.suggestionDecisions)) {
    const all = [...unsupported, ...errors];
    return { ok: false, code: unsupported.length ? "catalog-unsupported" : "catalog-invalid", errors: all };
  }

  const records = new Map();
  const activeTargets = new Map();
  for (const [index, record] of catalog.resources.entries()) {
    const at = `catalog.resources[${index}]`;
    if (!object(record)) { errors.push(`${at} must be an object`); continue; }
    if (!validId(record.id)) errors.push(`${at}.id must be a UUID`);
    else if (records.has(record.id)) errors.push(`${at}.id duplicates another resource ID`);
    else records.set(record.id, record);
    if (record.label !== null && typeof record.label !== "string") errors.push(`${at}.label must be a string or null`);
    if (!validTime(record.createdAt)) errors.push(`${at}.createdAt must be a timestamp`);
    if (!validTime(record.updatedAt)) errors.push(`${at}.updatedAt must be a timestamp`);
    const targetKind = validateTarget(record.target, `${at}.target`, errors, unsupported);
    const membership = validateMembership(record.membership, `${at}.membership`, errors, unsupported);
    validateOrigin(record.origin, targetKind, `${at}.origin`, errors, unsupported);
    if (membership === "active" && targetKind && TARGET_KINDS.has(targetKind)) {
      try {
        const key = areaResourceTargetFingerprint(record.target);
        if (activeTargets.has(key)) errors.push(`${at}.target duplicates active resource ${activeTargets.get(key)}`);
        else activeTargets.set(key, record.id);
      } catch { /* target validation already recorded the bounded error */ }
    }
  }

  const decisions = new Set();
  for (const [index, decision] of catalog.suggestionDecisions.entries()) {
    const at = `catalog.suggestionDecisions[${index}]`;
    if (!object(decision)) { errors.push(`${at} must be an object`); continue; }
    discriminant(decision.decision, new Set(["dismissed", "imported"]), `${at}.decision`, errors, unsupported);
    const evidenceKind = validateEvidence(decision.evidence, `${at}.evidence`, errors, unsupported);
    if (!safeString(decision.evidenceHash)) errors.push(`${at}.evidenceHash must be a non-empty string`);
    if (!safeString(decision.targetFingerprint)) errors.push(`${at}.targetFingerprint must be a non-empty string`);
    if (!validTime(decision.decidedAt)) errors.push(`${at}.decidedAt must be a timestamp`);
    if (evidenceKind && safeString(decision.evidenceHash) && safeString(decision.targetFingerprint)) {
      const key = canonicalJson([decision.evidence, decision.evidenceHash, decision.targetFingerprint]);
      if (decisions.has(key)) errors.push(`${at} duplicates another suggestion decision`); else decisions.add(key);
    }
    if (decision.decision === "dismissed") {
      if (evidenceKind === "legacy-area-binding") errors.push(`${at} cannot dismiss legacy Area binding evidence`);
      if (decision.resourceId !== null) errors.push(`${at}.resourceId must be null for a dismissed decision`);
    } else if (decision.decision === "imported") {
      if (!validId(decision.resourceId)) errors.push(`${at}.resourceId must be a UUID for an imported decision`);
      const record = records.get(decision.resourceId);
      if (validId(decision.resourceId) && !record) errors.push(`${at}.resourceId must reference this catalog`);
      // A later explicit Edit can change the record's kind and target while the
      // reviewed baseline remains durable. Import validates the pairing before
      // it writes; the schema therefore checks only the same-catalog reference.
    }
  }

  const all = [...unsupported, ...errors];
  return all.length
    ? { ok: false, code: unsupported.length ? "catalog-unsupported" : "catalog-invalid", errors: all }
    : { ok: true, catalog };
}

/** Parses exact JSON bytes and classifies malformed data separately from new unions. */
export function parseAreaResourceCatalog(bytes) {
  const exact = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  const revision = areaResourceCatalogRevision(exact);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(exact); }
  catch { return { ok: false, code: "catalog-invalid", revision, errors: ["catalog must be valid UTF-8 JSON"] }; }
  let catalog;
  try { catalog = JSON.parse(text); }
  catch (error) { return { ok: false, code: "catalog-invalid", revision, errors: [`invalid JSON: ${error.message}`] }; }
  const result = validateAreaResourceCatalog(catalog);
  return result.ok ? { ...result, revision, text } : { ...result, revision };
}

/** Serializes one validated catalog without removing additive object fields. */
export function serializeAreaResourceCatalog(catalog) {
  const result = validateAreaResourceCatalog(catalog);
  if (!result.ok) throw new AreaResourceCatalogError(result.code, result.errors.join("; "), { details: { errors: result.errors } });
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Reads one direct Area catalog from exact filesystem bytes. */
export async function readAreaResourceCatalog(root, owner, { read = readFile } = {}) {
  const relative = areaResourceCatalogPath(owner);
  const safe = relative && safeAreaResourceCatalogPath(root, relative);
  if (!safe) throw new AreaResourceCatalogError("invalid-resource-target", "The Area resource owner is unsafe.");
  let bytes;
  try { bytes = await read(safe.absolute); }
  catch (error) {
    if (error?.code === "ENOENT") {
      return { state: "current", owner, file: safe.relative, exists: false, revision: null, text: null, catalog: emptyAreaResourceCatalog() };
    }
    return {
      state: "unavailable",
      owner,
      file: safe.relative,
      error: { owner, code: "catalog-load-failed", message: `Map resources for ${owner} could not be loaded.`, retryable: true },
    };
  }
  const exact = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  const parsed = parseAreaResourceCatalog(exact);
  if (!parsed.ok) {
    return {
      state: "unavailable",
      owner,
      file: safe.relative,
      revision: parsed.revision,
      error: {
        owner,
        code: parsed.code,
        message: parsed.code === "catalog-unsupported" ? `Map resources for ${owner} use a newer format.` : `Map resources for ${owner} are invalid.`,
        retryable: false,
        errors: parsed.errors,
      },
    };
  }
  return { state: "current", owner, file: safe.relative, exists: true, revision: parsed.revision, text: parsed.text, catalog: parsed.catalog };
}

/** Returns one catalog record without changing tombstone visibility. */
export function findAreaResourceRecord(catalog, id) {
  return Array.isArray(catalog?.resources) ? catalog.resources.find((record) => record?.id === id) ?? null : null;
}

/** Returns only confirmed active direct associations. */
export function activeAreaResourceRecords(catalog) {
  return Array.isArray(catalog?.resources) ? catalog.resources.filter((record) => record?.membership?.state === "active") : [];
}

/** Supplies the best pure label available before observations and provider facts. */
export function areaResourceLabel(record) {
  if (typeof record?.label === "string" && record.label) return record.label;
  if (record?.target?.kind === "link") {
    try { return new URL(record.target.url).hostname || record.target.url; } catch { return record.target.url ?? "Link"; }
  }
  const value = record?.target?.path;
  return typeof value === "string" ? path.basename(value) || value : "Resource";
}

/** Returns cross-kind warnings inside exactly one owning catalog. */
export function areaResourceWarnings(catalog, owner, id) {
  const current = findAreaResourceRecord(catalog, id);
  if (!current || current.membership?.state !== "active") return [];
  let relation;
  try { relation = targetRelation(current.target); } catch { return []; }
  return activeAreaResourceRecords(catalog).flatMap((other) => {
    if (other.id === current.id || other.target.kind === current.target.kind) return [];
    let compared;
    try { compared = targetRelation(other.target); } catch { return []; }
    return relation.domain === compared.domain && relation.value === compared.value
      ? [{ kind: "cross-kind-target", other: { owner, id: other.id } }]
      : [];
  });
}

/** Projects validated direct reads into nearest-first direct/inherited catalog rows. */
export function projectAreaResourceCatalogs(viewedFrom, reads) {
  const owner = safeAreaResourceOwner(viewedFrom);
  if (!owner) throw new AreaResourceCatalogError("invalid-resource-target", "The viewed Area is unsafe.");
  const ancestors = areaAncestors(owner);
  const byOwner = new Map((reads ?? []).map((entry) => [entry.owner, entry]));
  const ordered = ancestors.map((candidate) => byOwner.get(candidate) ?? {
    state: "unavailable",
    owner: candidate,
    error: { owner: candidate, code: "catalog-load-failed", message: `Map resources for ${candidate} were not read.`, retryable: true },
  });
  const direct = ordered[0];
  if (direct?.state !== "current") return { state: "unavailable", error: direct.error };

  const usable = ordered.filter((entry) => entry.state === "current");
  const problems = ordered.slice(1).filter((entry) => entry.state !== "current").map((entry) => entry.error);
  const all = usable.flatMap((entry) => activeAreaResourceRecords(entry.catalog).map((record) => ({ entry, record })));
  const directKeys = new Map(activeAreaResourceRecords(direct.catalog).map((record) => [areaResourceTargetFingerprint(record.target), record]));
  const suppressed = new Map([...directKeys.keys()].map((key) => [key, []]));
  const visible = all.filter(({ entry, record }) => {
    if (entry.owner === owner) return true;
    const key = areaResourceTargetFingerprint(record.target);
    if (!directKeys.has(key)) return true;
    const sources = suppressed.get(key);
    if (!sources.includes(entry.owner)) sources.push(entry.owner);
    return false;
  });
  const rows = visible.map(({ entry, record }) => {
    const directRow = entry.owner === owner;
    const key = areaResourceTargetFingerprint(record.target);
    return {
      viewedFrom: owner,
      locator: { owner: entry.owner, id: record.id },
      relation: directRow ? { kind: "direct" } : { kind: "inherited", sourceArea: entry.owner },
      alsoFrom: directRow ? suppressed.get(key) ?? [] : [],
      label: areaResourceLabel(record),
      target: record.target,
      origin: record.origin,
      warnings: areaResourceWarnings(entry.catalog, entry.owner, record.id),
      record,
    };
  });
  const catalogs = usable.map((entry) => ({ owner: entry.owner, revision: entry.revision }));
  const confirmedAssociations = all.length;
  if (problems.length) {
    return {
      state: "partial",
      viewedFrom: owner,
      rows,
      catalogs,
      counts: { state: "lower-bound", confirmedAssociationsAtLeast: confirmedAssociations },
      problems,
    };
  }
  return {
    state: "current",
    viewedFrom: owner,
    rows,
    catalogs,
    counts: { state: "current", confirmedAssociations },
  };
}

/** Reads the selected Area and every ancestor before producing one catalog projection. */
export async function readAreaResourceProjection(root, viewedFrom, options = {}) {
  const owners = areaAncestors(viewedFrom);
  const reader = options.readCatalog ?? ((owner) => readAreaResourceCatalog(root, owner, options));
  const reads = await Promise.all(owners.map((owner) => reader(owner)));
  return projectAreaResourceCatalogs(viewedFrom, reads);
}

/** Produces the additive active-only Area-show contract from a catalog projection. */
export function projectAreaShowMapResources(projection) {
  if (projection.state === "unavailable") return { state: "unavailable", error: projection.error };
  const rows = projection.rows.map((row) => ({
    locator: row.locator,
    label: row.label,
    target: row.target,
    source: row.relation.kind === "direct" ? { kind: "direct" } : { kind: "inherited", sourceArea: row.relation.sourceArea },
    origin: row.origin,
  }));
  return projection.state === "partial" ? { state: "partial", rows, problems: projection.problems } : { state: "current", rows };
}

/** Reads active direct and inherited resources for the additive Area-show field. */
export async function readAreaShowMapResources(root, viewedFrom, options = {}) {
  return projectAreaShowMapResources(await readAreaResourceProjection(root, viewedFrom, options));
}

/** Converts catalog validation into the mutation result error union. */
function catalogFailure(validation) {
  return { ok: false, error: { code: validation.code, message: validation.errors.join("; "), retryable: false, details: { errors: validation.errors } } };
}

/** Creates one bounded invalid mutation-input result. */
function inputFailure(message, details = undefined) {
  return { ok: false, error: { code: "invalid-resource-target", message, retryable: false, ...(details === undefined ? {} : { details }) } };
}

/** Validates and clones a catalog before any pure mutation. */
function beginMutation(catalog) {
  const validation = validateAreaResourceCatalog(catalog);
  if (!validation.ok) return catalogFailure(validation);
  return { ok: true, catalog: structuredClone(catalog) };
}

/** Resolves and validates a mutation clock value. */
function mutationStamp(now) {
  const source = now ?? (() => new Date().toISOString());
  const value = typeof source === "function" ? source() : source;
  return validTime(value) ? value : null;
}

/** Reads the non-persisted owner supplied beside a catalog mutation. */
function mutationOwner(input, options) {
  return safeAreaResourceOwner(options.owner ?? input?.owner ?? input?.resource?.owner);
}

/** Reads a direct ID or locator ID from a mutation input. */
function mutationId(input) { return input?.id ?? input?.resource?.id; }

/** Normalizes one mutation target into a result instead of throwing. */
function normalizeMutationTarget(target, options) {
  try { return { ok: true, target: normalizeAreaResourceTarget(target, { home: options.home }) }; }
  catch (error) { return inputFailure(error.message); }
}

/** Finds an active same-kind normalized target in one direct catalog. */
function duplicateRecord(catalog, target, exceptId = null) {
  const fingerprint = areaResourceTargetFingerprint(target);
  return activeAreaResourceRecords(catalog).find((record) => record.id !== exceptId && areaResourceTargetFingerprint(record.target) === fingerprint) ?? null;
}

/** Returns the stable duplicate conflict and existing locator. */
function duplicateFailure(record, owner) {
  return {
    ok: false,
    error: {
      code: "duplicate-resource-target",
      message: "This Area already has an active Map resource with the same kind and target.",
      retryable: false,
      existing: { owner, id: record.id },
    },
  };
}

/** Returns the stable absent-or-inactive association result. */
function resourceNotFound(id) {
  return { ok: false, error: { code: "resource-not-found", message: `Map resource ${id ?? ""} was not found.`, retryable: false } };
}

/** Validates the owner, ID, and clock common to pure mutations. */
function validMutationBasics(input, options, { needOwner = true, needId = false } = {}) {
  const owner = needOwner ? mutationOwner(input, options) : null;
  if (needOwner && !owner) return inputFailure("The resource owner is unsafe.");
  const id = needId ? mutationId(input) : null;
  if (needId && !validId(id)) return inputFailure("The resource ID must be a UUID.");
  const stamp = mutationStamp(options.now);
  if (!stamp) return inputFailure("The resource mutation time is invalid.");
  return { ok: true, owner, id, stamp };
}

/** Revalidates the complete cloned result before returning it. */
function finalizeMutation(catalog, fields) {
  const validation = validateAreaResourceCatalog(catalog);
  return validation.ok ? { ok: true, catalog, ...fields } : catalogFailure(validation);
}

/** Retains additive fields while replacing one variant's known fields. */
function extraFields(value, known) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !known.includes(key)));
}

/** Replaces target authority while retaining additive target fields. */
function mergedTarget(previous, target) {
  return { ...extraFields(previous, ["kind", "path", "url"]), ...target };
}

/** Restores active membership while retaining additive membership fields. */
function activeMembership(previous) {
  return { ...extraFields(previous, ["state", "removedAt"]), state: "active" };
}

/** Creates a tombstone while retaining additive membership fields. */
function removedMembership(previous, removedAt) {
  return { ...extraFields(previous, ["state", "removedAt"]), state: "removed", removedAt };
}

/** Adds one new direct association; tombstones never donate or reuse their ID. */
export function addAreaResource(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options);
  if (!basics.ok) return basics;
  const normalized = normalizeMutationTarget(input?.target, options);
  if (!normalized.ok) return normalized;
  if (input?.label !== undefined && input.label !== null && typeof input.label !== "string") return inputFailure("The resource label must be a string or null.");
  const existing = duplicateRecord(started.catalog, normalized.target);
  if (existing) return duplicateFailure(existing, basics.owner);
  const id = (options.generateId ?? randomUUID)();
  if (!validId(id) || findAreaResourceRecord(started.catalog, id)) return inputFailure("The generated resource ID is invalid or already retired.");
  const record = {
    id,
    label: input.label ?? null,
    membership: { state: "active" },
    createdAt: basics.stamp,
    updatedAt: basics.stamp,
    target: normalized.target,
    origin: input.origin ?? null,
  };
  started.catalog.resources.push(record);
  return finalizeMutation(started.catalog, { resource: record, warnings: areaResourceWarnings(started.catalog, basics.owner, id), changed: true });
}

/** Replaces target/label fields in place while preserving identity and additive data. */
export function editAreaResource(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options, { needId: true });
  if (!basics.ok) return basics;
  const record = findAreaResourceRecord(started.catalog, basics.id);
  if (!record || record.membership.state !== "active") return resourceNotFound(basics.id);
  const normalized = normalizeMutationTarget(input?.target, options);
  if (!normalized.ok) return normalized;
  if (input?.label !== undefined && input.label !== null && typeof input.label !== "string") return inputFailure("The resource label must be a string or null.");
  const existing = duplicateRecord(started.catalog, normalized.target, record.id);
  if (existing) return duplicateFailure(existing, basics.owner);
  record.target = mergedTarget(record.target, normalized.target);
  record.label = input.label ?? null;
  record.origin = null;
  record.updatedAt = basics.stamp;
  return finalizeMutation(started.catalog, { resource: record, warnings: areaResourceWarnings(started.catalog, basics.owner, record.id), changed: true });
}

/** Turns one active association into its durable target-preserving tombstone. */
export function removeAreaResource(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options, { needId: true });
  if (!basics.ok) return basics;
  const record = findAreaResourceRecord(started.catalog, basics.id);
  if (!record || record.membership.state !== "active") return resourceNotFound(basics.id);
  record.membership = removedMembership(record.membership, basics.stamp);
  record.updatedAt = basics.stamp;
  return finalizeMutation(started.catalog, { resource: record, warnings: [], changed: true });
}

/** Reactivates the same retired ID only for an explicit immediate inverse. */
export function reactivateAreaResource(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options, { needId: true });
  if (!basics.ok) return basics;
  const record = findAreaResourceRecord(started.catalog, basics.id);
  if (!record || record.membership.state !== "removed") return resourceNotFound(basics.id);
  const existing = duplicateRecord(started.catalog, record.target, record.id);
  if (existing) return duplicateFailure(existing, basics.owner);
  record.membership = activeMembership(record.membership);
  record.updatedAt = basics.stamp;
  return finalizeMutation(started.catalog, { resource: record, warnings: areaResourceWarnings(started.catalog, basics.owner, record.id), changed: true });
}

/** Returns one stable evidence/hash/target decision identity. */
function decisionIdentity(decision) {
  return canonicalJson([decision.evidence, decision.evidenceHash, decision.targetFingerprint]);
}

/** Validates suggestion decision evidence supplied to a mutation helper. */
function validateDecisionInput(input, { allowLegacy }) {
  const errors = [];
  const unsupported = [];
  const kind = validateEvidence(input?.evidence, "suggestion.evidence", errors, unsupported);
  if (unsupported.length || errors.length) return inputFailure([...unsupported, ...errors].join("; "));
  if (!allowLegacy && kind === "legacy-area-binding") return inputFailure("Legacy Area binding evidence cannot be dismissed or added as a suggestion.");
  if (!safeString(input?.evidenceHash) || !safeString(input?.targetFingerprint)) return inputFailure("Suggestion evidence and target fingerprints are required.");
  return { ok: true, kind };
}

/** Validates the evidence-side target before a reviewed import chooses membership. */
function validateSuggestionPair(evidence, suggestedTarget, selectedTarget, options) {
  let suggested;
  try { suggested = normalizeAreaResourceTarget(suggestedTarget, { home: options.home, allowLocalPath: true }); }
  catch (error) { return inputFailure(error.message); }
  if (evidence.kind === "legacy-area-binding") {
    const expected = evidence.field === "Worktree" ? "worktree" : "repository";
    if (suggested.kind !== expected || selectedTarget.kind !== expected) return inputFailure("Legacy evidence does not match the selected target kind.");
  } else if (["attempt", "git-worktree"].includes(evidence.kind)) {
    if (suggested.kind !== "worktree" || selectedTarget.kind !== "worktree") return inputFailure("Attempt and Git worktree evidence can import only a worktree.");
  } else if (evidence.kind === "knowledge-line" && !["link", "local-path"].includes(suggested.kind)) {
    return inputFailure("Knowledge evidence must identify one Link or local path suggestion.");
  }
  if (suggested.kind === "local-path") {
    if (!["worktree", "repository"].includes(selectedTarget.kind) || suggested.path !== selectedTarget.path) {
      return inputFailure("The selected local resource must retain the suggested path.");
    }
  } else if (areaResourceTargetFingerprint(suggested) !== areaResourceTargetFingerprint(selectedTarget)) {
    return inputFailure("The selected resource must retain the suggested target.");
  }
  return { ok: true, suggested };
}

/** Replaces known evidence identity fields while retaining additive fields. */
function mergedEvidence(previous, next) {
  const known = previous?.kind === "legacy-area-binding" ? ["kind", "field"]
    : previous?.kind === "attempt" ? ["kind", "jobSlug", "run", "assignmentId", "attemptId"]
      : previous?.kind === "git-worktree" ? ["kind", "repositoryTargetFingerprint", "pathFingerprint"]
        : ["kind"];
  return { ...extraFields(previous, known), ...next };
}

/** Imports reviewed evidence, reusing an active direct match without changing its label. */
export function importAreaResource(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options);
  if (!basics.ok) return basics;
  const decisionInput = validateDecisionInput(input, { allowLegacy: true });
  if (!decisionInput.ok) return decisionInput;
  const normalized = normalizeMutationTarget(input?.target, options);
  if (!normalized.ok) return normalized;
  const inferredSuggestion = input?.suggestionTarget ?? (input.evidence.kind === "knowledge-line" && normalized.target.kind !== "link"
    ? { kind: "local-path", path: normalized.target.path }
    : normalized.target);
  const paired = validateSuggestionPair(input.evidence, inferredSuggestion, normalized.target, options);
  if (!paired.ok) return paired;
  const expectedFingerprint = areaResourceTargetFingerprint(paired.suggested, { home: options.home });
  if (!expectedFingerprint || expectedFingerprint !== input.targetFingerprint) {
    return { ok: false, error: { code: "suggestion-changed", message: "The reviewed suggestion target changed.", retryable: false } };
  }
  if (input.declaredBranch !== undefined && input.declaredBranch !== null && !safeString(input.declaredBranch)) return inputFailure("A declared branch must be a non-empty string or null.");
  if (input?.label !== null && input?.label !== undefined && typeof input.label !== "string") return inputFailure("The resource label must be a string or null.");

  let record = duplicateRecord(started.catalog, normalized.target);
  let created = false;
  if (!record) {
    const id = (options.generateId ?? randomUUID)();
    if (!validId(id) || findAreaResourceRecord(started.catalog, id)) return inputFailure("The generated resource ID is invalid or already retired.");
    record = {
      id,
      label: input.label ?? null,
      membership: { state: "active" },
      createdAt: basics.stamp,
      updatedAt: basics.stamp,
      target: normalized.target,
      origin: null,
    };
    started.catalog.resources.push(record);
    created = true;
  }

  let recordChanged = created;
  if (input.evidence.kind === "legacy-area-binding") {
    const previous = object(record.origin) ? record.origin : null;
    const origin = {
      ...extraFields(previous, ["kind", "field", "evidenceHash", "declaredBranch"]),
      kind: "legacy-area-binding",
      field: input.evidence.field,
      evidenceHash: input.evidenceHash,
      declaredBranch: input.declaredBranch ?? null,
    };
    if (canonicalJson(record.origin) !== canonicalJson(origin)) {
      record.origin = origin;
      record.updatedAt = basics.stamp;
      recordChanged = true;
    }
  }

  const identity = decisionIdentity(input);
  const index = started.catalog.suggestionDecisions.findIndex((decision) => decisionIdentity(decision) === identity);
  const prior = index >= 0 ? started.catalog.suggestionDecisions[index] : null;
  if (prior?.decision === "dismissed") {
    return { ok: false, error: { code: "suggestion-changed", message: "The reviewed suggestion decision changed.", retryable: false } };
  }
  const decision = prior?.decision === "imported" && prior.resourceId === record.id
    ? prior
    : {
        ...extraFields(prior, ["decision", "evidence", "evidenceHash", "targetFingerprint", "decidedAt", "resourceId"]),
        decision: "imported",
        evidence: mergedEvidence(prior?.evidence, input.evidence),
        evidenceHash: input.evidenceHash,
        targetFingerprint: input.targetFingerprint,
        decidedAt: basics.stamp,
        resourceId: record.id,
      };
  const decisionChanged = decision !== prior;
  if (index >= 0) started.catalog.suggestionDecisions[index] = decision;
  else started.catalog.suggestionDecisions.push(decision);
  return finalizeMutation(started.catalog, {
    resource: record,
    decision,
    warnings: areaResourceWarnings(started.catalog, basics.owner, record.id),
    changed: recordChanged || decisionChanged,
    reused: !created,
  });
}

/** Persists one non-legacy suggestion dismissal without creating membership. */
export function dismissAreaResourceSuggestion(catalog, input, options = {}) {
  const started = beginMutation(catalog);
  if (!started.ok) return started;
  const basics = validMutationBasics(input, options, { needOwner: false });
  if (!basics.ok) return basics;
  const decisionInput = validateDecisionInput(input, { allowLegacy: false });
  if (!decisionInput.ok) return decisionInput;
  const identity = decisionIdentity(input);
  const index = started.catalog.suggestionDecisions.findIndex((decision) => decisionIdentity(decision) === identity);
  const prior = index >= 0 ? started.catalog.suggestionDecisions[index] : null;
  if (prior?.decision === "imported") {
    return { ok: false, error: { code: "suggestion-changed", message: "The reviewed suggestion was already imported.", retryable: false } };
  }
  if (prior?.decision === "dismissed") return finalizeMutation(started.catalog, { decision: prior, warnings: [], changed: false, idempotent: true });
  const decision = {
    decision: "dismissed",
    evidence: structuredClone(input.evidence),
    evidenceHash: input.evidenceHash,
    targetFingerprint: input.targetFingerprint,
    decidedAt: basics.stamp,
    resourceId: null,
  };
  started.catalog.suggestionDecisions.push(decision);
  return finalizeMutation(started.catalog, { decision, warnings: [], changed: true, idempotent: false });
}
