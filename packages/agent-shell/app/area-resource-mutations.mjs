import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import os from "node:os";

import { areaAncestors } from "./area-agent-command.mjs";
import {
  addAreaResource,
  areaResourceCatalogPath,
  areaResourceTargetFingerprint,
  dismissAreaResourceSuggestion,
  editAreaResource,
  emptyAreaResourceCatalog,
  importAreaResource,
  normalizeAreaResourceTarget,
  parseAreaResourceCatalog,
  projectAreaResourceCatalogs,
  removeAreaResource,
  serializeAreaResourceCatalog,
} from "./area-resource-catalog.mjs";

const MUTATION_SCHEMA = "area-map-resource-mutation.v1";
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CATALOG_ONLY_KINDS = new Set(["add", "add-suggestion", "edit", "remove", "import-legacy", "dismiss-suggestion"]);

/** A stable HTTP-safe resource mutation failure. */
export class AreaResourceMutationError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.name = "AreaResourceMutationError";
    this.status = status;
    this.code = code;
    this.retryable = fields.retryable === true;
    Object.assign(this, fields);
  }
}

/** Throws one stable resource mutation failure. */
function fail(status, code, message, fields = {}) {
  throw new AreaResourceMutationError(status, code, message, fields);
}

/** Returns true for one exact JSON-compatible structural value. */
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

/** Rehydrates one durable effect without persisting a process-local Undo token. */
function rehydrateDurable(durable) { return durable; }

/** Normalizes a form target and reports only the bounded state needed before Save. */
export async function inspectAreaResourceTarget(target, { home = os.homedir(), statPath = stat } = {}) {
  let normalized;
  try { normalized = normalizeAreaResourceTarget(target, { home }); }
  catch (error) { fail(422, "invalid-resource-target", error.message); }
  const targetFingerprint = areaResourceTargetFingerprint(normalized, { home });
  if (normalized.kind === "link") return { kind: "link", normalized, targetFingerprint, state: "valid" };
  let state = "available";
  try {
    const metadata = await statPath(normalized.path);
    if (!metadata?.isDirectory?.()) state = "missing";
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) state = "missing";
    else if (["EACCES", "EPERM"].includes(error?.code)) state = "access-denied";
    else fail(503, "local-check-failed", "Could not inspect the local resource target.", { retryable: true });
  }
  return { kind: "local", normalized, targetFingerprint, state };
}

/** Requires a caller-reviewed confirmation when a local target is currently absent. */
async function checkedMutationTarget(input, inspectTarget) {
  if (!input?.target) fail(400, "invalid-resource-request", "A resource target input is required.");
  const inspected = await inspectTarget(input.target);
  if (inspected.kind === "local" && inspected.state === "missing"
    && input.missingConfirmation?.targetFingerprint !== inspected.targetFingerprint) {
    fail(409, "missing-target-confirmation-required", "The local target is missing and needs confirmation for its exact normalized path.", {
      normalized: inspected.normalized,
      targetFingerprint: inspected.targetFingerprint,
    });
  }
  return inspected.normalized;
}

/** Returns a catalog read from exact transaction bytes, preserving the missing-file revision. */
async function readCatalog(transactions, owner) {
  const file = areaResourceCatalogPath(owner);
  if (!file) fail(422, "invalid-resource-target", "The resource owner is unsafe.");
  let exact;
  try { exact = await transactions.readExact(file); }
  catch (error) { fail(Number(error?.status ?? 503), error?.code ?? "catalog-load-failed", `Map resources for ${owner} could not be loaded.`, { retryable: error?.retryable !== false }); }
  if (exact.content === null) return { state: "current", owner, file, exists: false, revision: null, content: null, catalog: emptyAreaResourceCatalog() };
  const parsed = parseAreaResourceCatalog(exact.content);
  if (!parsed.ok) {
    fail(409, parsed.code, parsed.code === "catalog-unsupported" ? `Map resources for ${owner} use a newer format.` : `Map resources for ${owner} are invalid.`, {
      retryable: false,
      details: { errors: parsed.errors },
    });
  }
  return { state: "current", owner, file, exists: true, revision: parsed.revision, content: exact.content, catalog: parsed.catalog };
}

/** Validates the exact expected-owner set without widening a transaction. */
function catalogExpectations(expected, owners) {
  if (!Array.isArray(expected) || !expected.length) fail(400, "invalid-resource-request", "Catalog revisions are required.");
  const values = new Map();
  for (const item of expected) {
    if (!item || typeof item.owner !== "string" || !(item.revision === null || typeof item.revision === "string") || values.has(item.owner)) {
      fail(400, "invalid-resource-request", "Catalog revisions must name each affected owner exactly once.");
    }
    values.set(item.owner, item.revision);
  }
  const required = [...new Set(owners)].sort();
  if (!same([...values.keys()].sort(), required)) fail(400, "invalid-resource-request", "Catalog revisions do not match the affected resource owners.");
  return values;
}

/** Returns the catalog owners that one closed mutation is allowed to change. */
function mutationOwners(mutation) {
  if (mutation?.kind === "add") return [mutation.owner];
  if (["edit", "remove"].includes(mutation?.kind)) return [mutation.resource?.owner];
  if (mutation?.kind === "add-suggestion") return [mutation.selection?.suggestion?.owner];
  if (mutation?.kind === "dismiss-suggestion") return [mutation.suggestion?.owner];
  if (mutation?.kind === "import-legacy") return (mutation.selections ?? []).map((selection) => selection?.candidate?.owner);
  return [];
}

/** Requires one supplied suggestion to still exist in the current derived evidence. */
function currentSuggestion(evidence, supplied, legacy = false) {
  const candidates = legacy ? evidence?.legacyReview ?? [] : evidence?.suggestions ?? [];
  const found = candidates.find((candidate) => candidate?.owner === supplied?.owner
    && candidate?.evidenceHash === supplied?.evidenceHash
    && candidate?.targetFingerprint === supplied?.targetFingerprint
    && same(candidate?.evidence, supplied?.evidence)
    && same(candidate?.target, supplied?.target));
  if (!found) fail(409, "suggestion-changed", "The reviewed resource evidence changed or is no longer available.");
  return found;
}

/** Maps catalog helper failures to the stable HTTP contract. */
function requireMutation(result) {
  if (result?.ok) return result;
  const code = result?.error?.code ?? "invalid-resource-request";
  const status = code === "duplicate-resource-target" ? 409
    : ["catalog-invalid", "catalog-unsupported", "suggestion-changed"].includes(code) ? 409
      : code === "resource-not-found" ? 404 : 422;
  fail(status, code, result?.error?.message ?? "The Map resource mutation is invalid.", {
    retryable: result?.error?.retryable === true,
    ...(result?.error?.existing ? { existing: result.error.existing } : {}),
    ...(result?.error?.details ? { details: result.error.details } : {}),
  });
}

/** Applies one mutation to cloned owner catalogs and returns its durable effect. */
async function mutateCatalogs({ mutation, catalogs, inspectTarget, evidence, viewedFrom, now, generateId }) {
  const changed = new Set();
  const warnings = [];
  let resource = null;
  /** Applies one catalog helper result to its exact owner accumulator. */
  const apply = (owner, operation) => {
    const prior = catalogs.get(owner);
    const result = requireMutation(operation(prior.catalog));
    catalogs.set(owner, { ...prior, catalog: result.catalog });
    if (result.changed) changed.add(owner);
    warnings.push(...(result.warnings ?? []));
    if (result.resource) resource = { locator: { owner, id: result.resource.id }, ...result.resource };
    return result;
  };

  if (mutation.kind === "add") {
    const target = await checkedMutationTarget(mutation.input, inspectTarget);
    apply(mutation.owner, (catalog) => addAreaResource(catalog, { owner: mutation.owner, target, label: mutation.label ?? null }, { owner: mutation.owner, now, generateId }));
  } else if (mutation.kind === "edit") {
    if (mutation.resource?.owner !== viewedFrom) fail(422, "inherited-resource-read-only", "An inherited Map resource must be edited in its owning Area.");
    const target = await checkedMutationTarget(mutation.input, inspectTarget);
    apply(mutation.resource.owner, (catalog) => editAreaResource(catalog, { resource: mutation.resource, target, label: mutation.label ?? null }, { owner: mutation.resource.owner, now }));
  } else if (mutation.kind === "remove") {
    if (mutation.resource?.owner !== viewedFrom) fail(422, "inherited-resource-read-only", "An inherited Map resource must be removed in its owning Area.");
    apply(mutation.resource.owner, (catalog) => removeAreaResource(catalog, { resource: mutation.resource }, { owner: mutation.resource.owner, now }));
  } else if (mutation.kind === "add-suggestion") {
    const supplied = mutation.selection?.suggestion;
    currentSuggestion(evidence, supplied, false);
    if (supplied.owner !== viewedFrom) fail(422, "inherited-resource-read-only", "A resource Suggestion belongs to another Area.");
    const target = await checkedMutationTarget(mutation.selection?.input, inspectTarget);
    if (supplied.target?.kind === "local-path") {
      if (!["worktree", "repository"].includes(target.kind) || target.path !== supplied.target.path) fail(409, "suggestion-changed", "The reviewed local-path Suggestion no longer matches the selected target.");
    } else if (!same(target, supplied.target)) fail(409, "suggestion-changed", "The reviewed Suggestion target changed.");
    apply(supplied.owner, (catalog) => importAreaResource(catalog, {
      owner: supplied.owner,
      target,
      label: mutation.labelForNewRecord ?? null,
      evidence: supplied.evidence,
      evidenceHash: supplied.evidenceHash,
      targetFingerprint: supplied.targetFingerprint,
      suggestionTarget: supplied.target,
    }, { owner: supplied.owner, now, generateId }));
  } else if (mutation.kind === "dismiss-suggestion") {
    const supplied = mutation.suggestion;
    currentSuggestion(evidence, supplied, false);
    if (supplied.owner !== viewedFrom) fail(422, "inherited-resource-read-only", "A resource Suggestion belongs to another Area.");
    apply(supplied.owner, (catalog) => dismissAreaResourceSuggestion(catalog, supplied, { now }));
  } else if (mutation.kind === "import-legacy") {
    if (!Array.isArray(mutation.selections) || !mutation.selections.length) fail(400, "invalid-resource-request", "Legacy import requires at least one selection.");
    const identities = new Set();
    for (const selection of mutation.selections) {
      const supplied = selection?.candidate;
      const identity = JSON.stringify([supplied?.owner, supplied?.evidence, supplied?.evidenceHash, supplied?.targetFingerprint]);
      if (identities.has(identity)) fail(400, "invalid-resource-request", "A legacy resource was selected more than once.");
      identities.add(identity);
      const candidate = currentSuggestion(evidence, supplied, true);
      if (candidate.state === "invalid") fail(409, "suggestion-changed", "An invalid legacy declaration cannot be imported.");
      apply(supplied.owner, (catalog) => importAreaResource(catalog, {
        owner: supplied.owner,
        target: supplied.target,
        label: candidate.proposedLabel ?? null,
        evidence: supplied.evidence,
        evidenceHash: supplied.evidenceHash,
        targetFingerprint: supplied.targetFingerprint,
        suggestionTarget: supplied.target,
        declaredBranch: selection.attachDeclaredBranch ? candidate.declaredBranch ?? null : null,
      }, { owner: supplied.owner, now, generateId }));
    }
  } else fail(400, "invalid-resource-request", "The Map resource mutation kind is unsupported.");
  return { changed, warnings, resource };
}

/** Creates the crash-safe catalog mutation and process-local immediate Undo coordinator. */
export function createAreaResourceMutationCoordinator({
  transactions,
  projectionReader = null,
  evidenceReader = async () => ({ suggestions: [], legacyReview: [] }),
  areaExists = async () => true,
  areaReadOnly = async () => false,
  inspectTarget = inspectAreaResourceTarget,
  now = () => new Date().toISOString(),
  generateId = randomUUID,
  generateUndoToken = randomUUID,
  onCommitted = () => {},
} = {}) {
  if (!transactions?.readExact || !transactions?.saveExact) throw new Error("resource mutations require exact transaction authority");
  let undoReceipt = null;
  const operationReceipts = new Map();

  /** Reads the current active direct/inherited catalog projection by default. */
  async function projection(viewedFrom) {
    if (projectionReader) return projectionReader(viewedFrom);
    const reads = await Promise.all(areaAncestors(viewedFrom).map((owner) => readCatalog(transactions, owner)));
    return projectAreaResourceCatalogs(viewedFrom, reads);
  }

  /** Returns current revisions for exactly the requested owners. */
  async function revisions(owners) {
    return Promise.all([...new Set(owners)].sort().map(async (owner) => {
      const current = await readCatalog(transactions, owner);
      return { owner, revision: current.revision };
    }));
  }

  /** Decorates a durable transaction effect with current read authority. */
  async function decorate(viewedFrom, durable, undo) {
    return {
      ...durable,
      catalogRevisions: await revisions(durable.catalogOwners ?? []),
      projection: await projection(viewedFrom),
      sourceUpdates: durable.sourceUpdates ?? [],
      warnings: durable.warnings ?? [],
      undo,
    };
  }

  /** Applies the one retained process-local inverse under the same exact transaction lock. */
  async function applyUndo(request) {
    const receipt = undoReceipt;
    if (!receipt || request.mutation?.token !== receipt.token) fail(409, "undo-unavailable", "That Map resource Undo is no longer available.");
    const result = await transactions.saveExact(async () => {
      for (const inverse of receipt.catalogs) {
        const current = await readCatalog(transactions, inverse.owner);
        if (current.revision !== inverse.postRevision) fail(409, "undo-stale", "Map resources changed after the operation; Undo cannot replace them.");
      }
      return {
        targets: receipt.catalogs.map((inverse) => ({ file: inverse.file, oldContent: inverse.postContent, newContent: inverse.beforeContent })),
        message: `update: ${request.viewedFrom} undo Map resource`,
        result: { effect: "undone", catalogOwners: receipt.catalogs.map((item) => item.owner), warnings: [], sourceUpdates: [] },
      };
    }, {
      operationId: request.operationId,
      worldId: "area-resources",
      area: request.viewedFrom,
      intent: request,
      rehydrate: rehydrateDurable,
    });
    if (Number(result?.status ?? 200) >= 400) return result;
    if (undoReceipt?.token === receipt.token) undoReceipt = null;
    const decorated = await decorate(request.viewedFrom, result, { state: "unavailable" });
    operationReceipts.set(request.operationId, decorated);
    await onCommitted({ kind: "undo", request, result: decorated });
    return decorated;
  }

  /** Applies one closed catalog mutation and returns current projection evidence. */
  async function apply(request) {
    if (!request || request.schema !== MUTATION_SCHEMA || !OPERATION_ID.test(String(request.operationId ?? "")) || typeof request.viewedFrom !== "string") {
      fail(400, "invalid-resource-request", "A valid resource mutation schema, operation ID, and viewed Area are required.");
    }
    if (!await areaExists(request.viewedFrom)) fail(404, "area-not-found", `No Area ${request.viewedFrom}.`);
    if (request.mutation?.kind === "undo") return applyUndo(request);
    if (!CATALOG_ONLY_KINDS.has(request.mutation?.kind)) fail(400, "invalid-resource-request", "The Map resource mutation kind is unsupported.");
    const owners = mutationOwners(request.mutation);
    if (!owners.length || owners.some((owner) => typeof owner !== "string" || !owner || owner === "@root")) fail(422, "invalid-resource-target", "The resource owner is unsafe.");
    for (const owner of new Set(owners)) {
      if (!await areaExists(owner)) fail(404, "area-not-found", `No Area ${owner}.`);
      if (await areaReadOnly(owner)) fail(423, "area-resource-read-only", `Map resources for ${owner} are read-only because that Area is done or archived.`);
    }
    const expected = catalogExpectations(request.expectedCatalogs, owners);
    const replay = operationReceipts.get(request.operationId);
    let inverse = null;
    const result = await transactions.saveExact(async () => {
      const catalogRows = await Promise.all([...new Set(owners)].sort().map((owner) => readCatalog(transactions, owner)));
      for (const current of catalogRows) if (expected.get(current.owner) !== current.revision) {
        fail(409, "catalog-revision-changed", `Map resources for ${current.owner} changed. Reload them before saving.`, { owner: current.owner, currentRevision: current.revision });
      }
      const catalogs = new Map(catalogRows.map((entry) => [entry.owner, entry]));
      const evidence = ["add-suggestion", "dismiss-suggestion", "import-legacy"].includes(request.mutation.kind)
        ? await evidenceReader(request.viewedFrom, { owners: [...new Set(owners)] }) : null;
      const effect = await mutateCatalogs({ mutation: request.mutation, catalogs, inspectTarget, evidence, viewedFrom: request.viewedFrom, now, generateId });
      const changed = catalogRows.filter((entry) => effect.changed.has(entry.owner)).map((before) => {
        const after = catalogs.get(before.owner);
        const newContent = Buffer.from(serializeAreaResourceCatalog(after.catalog));
        return { ...before, newContent };
      });
      inverse = changed.map((entry) => ({ owner: entry.owner, file: entry.file, beforeContent: entry.content, postContent: entry.newContent }));
      return {
        targets: changed.map((entry) => ({ file: entry.file, oldContent: entry.content, newContent: entry.newContent })),
        message: `${request.mutation.kind === "remove" ? "remove" : changed.some((entry) => entry.exists) ? "update" : "add"}: ${request.viewedFrom} Map resource${changed.length === 1 ? "" : "s"}`,
        result: {
          effect: request.mutation.kind,
          catalogOwners: [...new Set(owners)].sort(),
          warnings: effect.warnings,
          ...(effect.resource ? { resource: effect.resource } : {}),
          sourceUpdates: [],
        },
      };
    }, {
      operationId: request.operationId,
      worldId: "area-resources",
      area: request.viewedFrom,
      intent: request,
      rehydrate: rehydrateDurable,
    });
    if (Number(result?.status ?? 200) >= 400) {
      if (result.code === "target-race") return { ...result, code: "catalog-revision-changed", error: "Map resources changed while the operation was saving." };
      return result;
    }
    if (replay) return replay;
    const eligible = ["add", "add-suggestion", "edit", "remove"].includes(request.mutation.kind) && inverse?.length;
    let undo = { state: "unavailable" };
    if (eligible) {
      const post = await Promise.all(inverse.map(async (entry) => ({ ...entry, postRevision: (await readCatalog(transactions, entry.owner)).revision })));
      const token = generateUndoToken();
      undoReceipt = { token, operationId: request.operationId, catalogs: post };
      undo = { state: "available", token };
    } else undoReceipt = null;
    const decorated = await decorate(request.viewedFrom, result, undo);
    operationReceipts.set(request.operationId, decorated);
    await onCommitted({ kind: request.mutation.kind, request, result: decorated });
    return decorated;
  }

  /** Clears the one immediate Undo receipt after an Area move or external authority change. */
  function clearUndo() { undoReceipt = null; }

  return { apply, clearUndo, inspectTarget, projection };
}

export default { AreaResourceMutationError, createAreaResourceMutationCoordinator, inspectAreaResourceTarget };
