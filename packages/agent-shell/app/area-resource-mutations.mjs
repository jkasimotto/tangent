import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";

import { areaAncestors } from "./area-agent-command.mjs";
import { areaCanvasPath, canvasHash, parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import {
  activeAreaResourceRecords,
  addAreaResource,
  areaResourceCatalogPath,
  areaResourceTargetFingerprint,
  dismissAreaResourceSuggestion,
  editAreaResource,
  emptyAreaResourceCatalog,
  findAreaResourceRecord,
  importAreaResource,
  normalizeAreaResourceTarget,
  parseAreaResourceCatalog,
  projectAreaResourceCatalogs,
  removeAreaResource,
  safeAreaResourceOwner,
  serializeAreaResourceCatalog,
} from "./area-resource-catalog.mjs";
import { tangentOf } from "./public/area-board-core.js";
import { isSafeResourceId } from "./public/area-map-entities.js";

const MUTATION_SCHEMA = "area-map-resource-mutation.v1";
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CATALOG_ONLY_KINDS = new Set(["add", "add-suggestion", "edit", "remove", "import-legacy", "dismiss-suggestion"]);
const SCENE_COUPLED_KINDS = new Set(["associate-generic-link", "add-back-gone"]);

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
function same(left, right) { return isDeepStrictEqual(left, right); }

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

/** Decodes exact UTF-8 bytes without replacing invalid source evidence. */
function exactText(content, source) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch { fail(409, "resource-source-invalid", `${source} is not valid UTF-8.`); }
}

/** Reads and validates one exact raw Area source scene. */
async function readScene(transactions, owner) {
  const file = areaCanvasPath(owner);
  if (!file) fail(422, "invalid-resource-target", "The resource source owner is unsafe.");
  let exact;
  try { exact = await transactions.readExact(file); }
  catch (error) { fail(Number(error?.status ?? 503), error?.code ?? "resource-source-load-failed", `The Map source for ${owner} could not be loaded.`, { retryable: error?.retryable !== false }); }
  if (exact.content === null) fail(404, "resource-not-found", `The Map source for ${owner} has no matching Block.`);
  const text = exactText(exact.content, `The Map source for ${owner}`);
  const parsed = parseAreaCanvas(text);
  if (!parsed.ok) fail(409, "resource-source-invalid", `The Map source for ${owner} is invalid.`);
  return { owner, file, content: Buffer.from(exact.content), hash: exact.hash ?? canvasHash(exact.content), text, scene: parsed.scene };
}

/** Requires exactly one source hash for the semantic owning Area. */
function sceneExpectation(expected, owner) {
  if (!Array.isArray(expected) || expected.length !== 1 || expected[0]?.owner !== owner
    || !(expected[0].hash === null || typeof expected[0].hash === "string")) {
    fail(400, "invalid-resource-request", "One exact source-scene expectation must name the resource owner.");
  }
  return expected[0];
}

/** Fails when an exact source hash changed after the caller loaded it. */
function requireSceneRevision(scene, expected) {
  if (scene.hash !== expected.hash) fail(409, "resource-representation-conflict", `The Map source for ${scene.owner} changed. Reload it before saving.`, {
    owner: scene.owner,
    currentHash: scene.hash,
  });
}

/** Returns persisted resource roots, including retained hidden roots. */
function resourceBlocks(scene) {
  return (scene?.elements ?? []).filter((element) => tangentOf(element)?.kind === "resource" && !element.containerId);
}

/** Rejects duplicate resource representations and split root-label deletion state. */
function requireConsistentResourceBlocks(scene, owner) {
  const byRef = new Map();
  const byId = new Map((scene.elements ?? []).map((element) => [element.id, element]));
  for (const block of resourceBlocks(scene)) {
    const ref = tangentOf(block).ref;
    const roots = byRef.get(ref) ?? [];
    roots.push(block);
    byRef.set(ref, roots);
    const split = (block.boundElements ?? []).filter((binding) => binding?.type === "text")
      .map((binding) => byId.get(binding.id)).filter(Boolean)
      .some((label) => Boolean(label.isDeleted) !== Boolean(block.isDeleted));
    if (split) fail(409, "resource-source-invalid", `Map resource ${ref} has inconsistent retained source records in ${owner}.`);
  }
  for (const [ref, roots] of byRef) if (roots.length > 1) fail(409, "resource-representation-conflict", `Map resource ${ref} has more than one source representation in ${owner}.`, {
    resource: { owner, id: ref },
  });
}

/** Returns the one source root with exact Tangent semantic metadata. */
function semanticRoot(scene, { id = null, kind, ref = null, visible = true } = {}) {
  return (scene.elements ?? []).find((element) => {
    const tangent = tangentOf(element);
    return (!id || element.id === id) && !element.containerId && tangent?.kind === kind && (ref === null || tangent.ref === ref) && (!visible || !element.isDeleted);
  }) ?? null;
}

/** Replaces only one root's Tangent metadata on a cloned current scene. */
function replaceSemanticTangent(scene, elementId, tangent) {
  const changed = structuredClone(scene);
  const element = changed.elements.find((candidate) => candidate.id === elementId);
  element.customData = { ...(element.customData ?? {}), tangent: structuredClone(tangent) };
  return changed;
}

/** Returns the active direct association with one exact normalized target. */
function activeTarget(catalog, target) {
  const fingerprint = areaResourceTargetFingerprint(target);
  return activeAreaResourceRecords(catalog).find((record) => areaResourceTargetFingerprint(record.target) === fingerprint) ?? null;
}

/** Generates one association identity that cannot revive a gone Block identity. */
function generateFreshResourceId(generateId, formerId) {
  const generated = generateId();
  if (generated === formerId) fail(422, "invalid-resource-target", "Add back must create a new resource identity.");
  return generated;
}

/** Builds one response update from current exact source bytes and optional world revision authority. */
function sourceUpdate(owner, serializedSource, hash = canvasHash(serializedSource), revisions = null) {
  const complete = typeof revisions?.treeRevision === "string" && revisions.treeRevision
    && typeof revisions?.worldRevision === "string" && revisions.worldRevision;
  return {
    owner,
    serializedSource,
    hash,
    ...(complete ? { treeRevision: revisions.treeRevision, worldRevision: revisions.worldRevision } : {}),
  };
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
  if (mutation?.kind === "associate-generic-link") return [mutation.owner];
  if (mutation?.kind === "add-back-gone") return [mutation.oldResource?.owner];
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

/** Revalidates one complete legacy batch and its single Branch attachment choices. */
function legacySelections(selections, evidence) {
  if (!Array.isArray(selections) || !selections.length) fail(400, "invalid-resource-request", "Legacy import requires at least one selection.");
  const identities = [];
  const selected = selections.map((selection) => {
    if (typeof selection?.attachDeclaredBranch !== "boolean") fail(400, "invalid-resource-request", "Every legacy selection must state whether it attaches the declared Branch.");
    const supplied = selection?.candidate;
    const identity = { owner: supplied?.owner, evidence: supplied?.evidence, evidenceHash: supplied?.evidenceHash, targetFingerprint: supplied?.targetFingerprint };
    if (identities.some((candidate) => same(candidate, identity))) fail(400, "invalid-resource-request", "A legacy resource was selected more than once.");
    identities.push(identity);
    const candidate = currentSuggestion(evidence, supplied, true);
    return { selection, supplied, candidate };
  });
  const branchGroups = new Map();
  for (const item of selected) {
    if (!item.candidate.declaredBranch) {
      if (item.selection.attachDeclaredBranch) fail(409, "legacy-branch-choice-required", "A legacy Branch can attach only to a declaration that supplies it.");
      continue;
    }
    const key = `${item.supplied.owner}\0${item.candidate.declaredBranch}`;
    const group = branchGroups.get(key) ?? [];
    group.push(item);
    branchGroups.set(key, group);
  }
  for (const group of branchGroups.values()) if (group.filter((item) => item.selection.attachDeclaredBranch).length !== 1) {
    fail(409, "legacy-branch-choice-required", "Choose exactly one selected local resource for the declared Branch.");
  }
  return selected;
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
    for (const { selection, supplied, candidate } of legacySelections(mutation.selections, evidence)) {
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

/** Applies association or Add-back to one cloned catalog and raw source scene. */
async function mutateSceneCoupled({ mutation, catalog, scene, viewedFrom, inspectTarget, now, generateId }) {
  const owner = mutation.kind === "associate-generic-link" ? mutation.owner : mutation.oldResource?.owner;
  if (owner !== viewedFrom) fail(422, "inherited-resource-read-only", "A source-coupled Map resource change must use its owning Area.");
  requireConsistentResourceBlocks(scene.scene, owner);

  if (mutation.kind === "associate-generic-link") {
    if (mutation.labelForNewRecord !== null && typeof mutation.labelForNewRecord !== "string") fail(400, "invalid-resource-request", "A new associated resource label must be a string or null.");
    if (typeof mutation.sourceElementId !== "string" || !mutation.sourceElementId || mutation.sourceElementId.includes("\0")) fail(422, "invalid-resource-target", "A generic Link association needs one safe source element ID.");
    const root = semanticRoot(scene.scene, { id: mutation.sourceElementId, kind: "link" });
    if (!root) fail(404, "resource-not-found", "The selected generic Link Block no longer exists in that Area.");
    let target;
    try { target = normalizeAreaResourceTarget({ kind: "link", url: tangentOf(root).ref }); }
    catch (error) { fail(422, "invalid-resource-target", error.message); }
    const existing = activeTarget(catalog.catalog, target);
    if (existing && resourceBlocks(scene.scene).some((block) => tangentOf(block).ref === existing.id)) {
      fail(409, "duplicate-resource-target", "This Area resource already has a visible or hidden Map Block.", {
        existing: { owner, id: existing.id },
      });
    }
    const added = existing ? null : requireMutation(addAreaResource(catalog.catalog, {
      owner,
      target,
      label: mutation.labelForNewRecord,
    }, { owner, now, generateId }));
    const record = existing ?? added.resource;
    const changedCatalog = added?.catalog ?? catalog.catalog;
    const previousTangent = structuredClone(root.customData.tangent);
    const changedScene = replaceSemanticTangent(scene.scene, root.id, { ...previousTangent, kind: "resource", ref: record.id });
    return {
      catalog: changedCatalog,
      catalogChanged: Boolean(added),
      catalogUndo: added ? "tombstone" : "none",
      resource: { locator: { owner, id: record.id }, ...record },
      warnings: added?.warnings ?? [],
      scene: changedScene,
      semanticInverse: { owner, file: scene.file, sourceElementId: root.id, expected: { kind: "resource", ref: record.id }, restore: previousTangent },
    };
  }

  const old = mutation.oldResource;
  if (!old || !isSafeResourceId(old.id)) fail(422, "invalid-resource-target", "Add back needs one exact gone resource locator.");
  const roots = resourceBlocks(scene.scene).filter((block) => tangentOf(block).ref === old.id);
  if (roots.length !== 1 || roots[0].isDeleted) fail(404, "resource-not-found", "The visible gone resource Block no longer exists in that Area.");
  const prior = findAreaResourceRecord(catalog.catalog, old.id);
  let target;
  let label;
  if (mutation.source?.kind === "tombstone") {
    if (prior?.membership?.state !== "removed") fail(404, "resource-not-found", "The gone resource tombstone no longer exists.");
    target = prior.target;
    label = prior.label;
  } else if (mutation.source?.kind === "confirmed-last-known") {
    if (prior) fail(409, "resource-representation-conflict", "The gone Block now has catalog authority; reload before adding it back.");
    if (typeof mutation.source.label !== "string") fail(400, "invalid-resource-request", "Confirmed Last-known Add back needs its exact label.");
    target = await checkedMutationTarget(mutation.source.input, inspectTarget);
    label = mutation.source.label;
  } else fail(400, "invalid-resource-request", "Add back needs tombstone or confirmed Last-known authority.");
  /** Generates a new ID without permitting the gone reference to become current again. */
  const generateFreshId = () => generateFreshResourceId(generateId, old.id);
  const added = requireMutation(addAreaResource(catalog.catalog, { owner, target, label }, {
    owner,
    now,
    generateId: generateFreshId,
  }));
  const root = roots[0];
  const previousTangent = structuredClone(root.customData.tangent);
  const changedScene = replaceSemanticTangent(scene.scene, root.id, { ...previousTangent, ref: added.resource.id });
  return {
    catalog: added.catalog,
    catalogChanged: true,
    catalogUndo: "exact",
    resource: { locator: { owner, id: added.resource.id }, ...added.resource },
    warnings: added.warnings ?? [],
    scene: changedScene,
    semanticInverse: { owner, file: scene.file, sourceElementId: root.id, expected: { kind: "resource", ref: added.resource.id }, restore: previousTangent },
  };
}

/**
 * Creates the crash-safe catalog mutation and process-local immediate Undo coordinator.
 * `guardReader` runs inside every exact plan. It receives
 * `{request, viewedFrom, owners, needsEvidence, readEvidence}` and returns either
 * guards or `{guards, evidence}`. Each guard is exact `{file, oldContent,
 * kind: "evidence" | "status"}` authority. `sourceRevisionReader` may attach the
 * current `{treeRevision, worldRevision}` after a committed source is reread.
 */
export function createAreaResourceMutationCoordinator({
  transactions,
  projectionReader = null,
  evidenceReader = async () => ({ suggestions: [], legacyReview: [] }),
  areaExists = async () => true,
  areaReadOnly = async () => false,
  guardReader = async () => [],
  sourceRevisionReader = null,
  inspectTarget = inspectAreaResourceTarget,
  now = () => new Date().toISOString(),
  generateId = randomUUID,
  generateUndoToken = randomUUID,
  onCommitted = () => {},
} = {}) {
  if (!transactions?.readExact || !transactions?.saveExact) throw new Error("resource mutations require exact transaction authority");
  let undoReceipt = null;
  const operationReceipts = new Map();

  /** Rebuilds response-only source bytes instead of persisting them in an operation receipt. */
  async function hydrateDurable(durable) {
    if (!Array.isArray(durable?.sourceOwners)) return { ...durable, sourceUpdates: durable?.sourceUpdates ?? [] };
    const sourceUpdates = await Promise.all(durable.sourceOwners.map(async (owner) => {
      const source = await readScene(transactions, owner);
      const revisions = typeof sourceRevisionReader === "function"
        ? await sourceRevisionReader(owner, { hash: source.hash, serializedSource: source.text })
        : null;
      return sourceUpdate(owner, source.text, source.hash, revisions);
    }));
    const { sourceOwners: _privateSourceOwners, ...result } = durable;
    return { ...result, sourceUpdates };
  }

  /** Prepares exact evidence/status guards and optional co-snapshotted suggestion evidence. */
  async function prepareAuthority(request, owners) {
    const needsEvidence = ["add-suggestion", "dismiss-suggestion", "import-legacy"].includes(request.mutation.kind);
    /** Rederives current mutation evidence only when the command needs it. */
    const readEvidence = () => needsEvidence ? evidenceReader(request.viewedFrom, { owners }) : null;
    const prepared = await guardReader({ request, viewedFrom: request.viewedFrom, owners, needsEvidence, readEvidence });
    const values = Array.isArray(prepared) ? prepared : prepared?.guards ?? [];
    if (!Array.isArray(values)) fail(503, "resource-source-load-failed", "Mutation authority guards could not be loaded.", { retryable: true });
    const guards = values.map((guard) => {
      if (typeof guard?.file !== "string" || !guard.file || !(guard.oldContent === null || typeof guard.oldContent === "string" || Buffer.isBuffer(guard.oldContent) || guard.oldContent instanceof Uint8Array)) {
        fail(503, "resource-source-load-failed", "Mutation authority guards are invalid.", { retryable: true });
      }
      return { file: guard.file, oldContent: guard.oldContent, kind: guard.kind === "status" ? "status" : "evidence" };
    });
    const evidence = needsEvidence ? prepared?.evidence ?? await readEvidence() : null;
    return { evidence, guards };
  }

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
    const hydrated = await hydrateDurable(durable);
    return {
      ...hydrated,
      catalogRevisions: await revisions(hydrated.catalogOwners ?? []),
      projection: await projection(viewedFrom),
      sourceUpdates: hydrated.sourceUpdates ?? [],
      warnings: hydrated.warnings ?? [],
      undo,
    };
  }

  /** Applies the one retained process-local inverse under the same exact transaction lock. */
  async function applyUndo(request) {
    const receipt = undoReceipt;
    if (!receipt || request.mutation?.token !== receipt.token) fail(409, "undo-unavailable", "That Map resource Undo is no longer available.");
    /** Builds and submits one plan; safe head/guard conflicts can invoke it once more. */
    const save = () => transactions.saveExact(async () => {
      const currentCatalogs = new Map();
      for (const inverse of receipt.catalogs) {
        const current = await readCatalog(transactions, inverse.owner);
        if (current.revision !== inverse.postRevision) fail(409, "undo-stale", "Map resources changed after the operation; Undo cannot replace them.");
        currentCatalogs.set(inverse.owner, current);
      }
      const targets = [];
      for (const inverse of receipt.catalogs) {
        const current = currentCatalogs.get(inverse.owner);
        if (inverse.undo === "none") continue;
        if (inverse.undo === "exact") {
          targets.push({ file: inverse.file, oldContent: current.content, newContent: inverse.beforeContent });
          continue;
        }
        const removed = requireMutation(removeAreaResource(current.catalog, { resource: { owner: inverse.owner, id: inverse.resourceId } }, { owner: inverse.owner, now }));
        targets.push({ file: inverse.file, oldContent: current.content, newContent: Buffer.from(serializeAreaResourceCatalog(removed.catalog)) });
      }
      if (receipt.semantic) {
        const source = await readScene(transactions, receipt.semantic.owner);
        requireConsistentResourceBlocks(source.scene, receipt.semantic.owner);
        const root = semanticRoot(source.scene, {
          id: receipt.semantic.sourceElementId,
          kind: receipt.semantic.expected.kind,
          ref: receipt.semantic.expected.ref,
          visible: false,
        });
        if (!root) fail(409, "resource-representation-conflict", "The Map resource Block changed after the operation; Undo cannot rewrite it.");
        const changed = replaceSemanticTangent(source.scene, root.id, receipt.semantic.restore);
        targets.push({ area: source.owner, file: source.file, oldContent: source.content, newContent: Buffer.from(serializeAreaCanvas(changed)) });
      }
      return {
        targets,
        message: `update: ${request.viewedFrom} undo Map resource`,
        result: {
          effect: "undone",
          catalogOwners: receipt.catalogs.map((item) => item.owner),
          warnings: [],
          ...(receipt.semantic ? { sourceOwners: [receipt.semantic.owner] } : { sourceUpdates: [] }),
        },
      };
    }, {
      operationId: request.operationId,
      worldId: "area-resources",
      area: request.viewedFrom,
      intent: request,
      rehydrate: hydrateDurable,
    });
    let result = await save();
    if (["head-race", "guard-race"].includes(result?.code)) result = await save();
    if (Number(result?.status ?? 200) >= 400) {
      if (result.code === "target-race" && receipt.semantic) return { ...result, code: "resource-representation-conflict", error: "The Map resource Block changed while Undo was saving." };
      return result;
    }
    if (undoReceipt?.token === receipt.token) undoReceipt = null;
    const decorated = await decorate(request.viewedFrom, result, { state: "unavailable" });
    operationReceipts.set(request.operationId, decorated);
    await onCommitted({ kind: "undo", request, result: decorated });
    return decorated;
  }

  /** Applies one closed catalog mutation and returns current projection evidence. */
  async function apply(request) {
    if (!request || request.schema !== MUTATION_SCHEMA || !OPERATION_ID.test(String(request.operationId ?? "")) || !safeAreaResourceOwner(request.viewedFrom)) {
      fail(400, "invalid-resource-request", "A valid resource mutation schema, operation ID, and viewed Area are required.");
    }
    if (!await areaExists(request.viewedFrom)) fail(404, "area-not-found", `No Area ${request.viewedFrom}.`);
    if (request.mutation?.kind === "undo") return applyUndo(request);
    const catalogOnly = CATALOG_ONLY_KINDS.has(request.mutation?.kind);
    const sceneCoupled = SCENE_COUPLED_KINDS.has(request.mutation?.kind);
    if (!catalogOnly && !sceneCoupled) fail(400, "invalid-resource-request", "The Map resource mutation kind is unsupported.");
    const owners = mutationOwners(request.mutation);
    if (!owners.length || owners.some((owner) => !safeAreaResourceOwner(owner))) fail(422, "invalid-resource-target", "The resource owner is unsafe.");
    const uniqueOwners = [...new Set(owners)].sort();
    for (const owner of uniqueOwners) {
      if (!await areaExists(owner)) fail(404, "area-not-found", `No Area ${owner}.`);
      if (await areaReadOnly(owner)) fail(423, "area-resource-read-only", `Map resources for ${owner} are read-only because that Area is done or archived.`);
    }
    const expected = catalogExpectations(request.expectedCatalogs, owners);
    const expectedScene = sceneCoupled ? sceneExpectation(request.expectedScenes, uniqueOwners[0]) : null;
    if (catalogOnly && request.expectedScenes !== undefined) fail(400, "invalid-resource-request", "Catalog-only resource changes cannot name source-scene expectations.");
    const replay = operationReceipts.get(request.operationId);
    let inverse = null;
    const guardKinds = new Map();
    /** Builds and submits one plan; safe head/guard conflicts can invoke it once more. */
    const save = () => transactions.saveExact(async () => {
      inverse = null;
      guardKinds.clear();
      for (const owner of uniqueOwners) if (await areaReadOnly(owner)) {
        fail(423, "area-resource-read-only", `Map resources for ${owner} became read-only before the change could be saved.`);
      }
      const catalogRows = await Promise.all(uniqueOwners.map((owner) => readCatalog(transactions, owner)));
      for (const current of catalogRows) if (expected.get(current.owner) !== current.revision) {
        fail(409, "catalog-revision-changed", `Map resources for ${current.owner} changed. Reload them before saving.`, { owner: current.owner, currentRevision: current.revision });
      }
      const authority = await prepareAuthority(request, uniqueOwners);
      for (const guard of authority.guards) guardKinds.set(guard.file, guard.kind);
      const guards = authority.guards.map(({ kind: _kind, ...guard }) => guard);
      const catalogs = new Map(catalogRows.map((entry) => [entry.owner, entry]));
      if (sceneCoupled) {
        const owner = uniqueOwners[0];
        const currentCatalog = catalogs.get(owner);
        const scene = await readScene(transactions, owner);
        requireSceneRevision(scene, expectedScene);
        const effect = await mutateSceneCoupled({ mutation: request.mutation, catalog: currentCatalog, scene, viewedFrom: request.viewedFrom, inspectTarget, now, generateId });
        const newCatalog = effect.catalogChanged ? Buffer.from(serializeAreaResourceCatalog(effect.catalog)) : currentCatalog.content;
        const newSource = Buffer.from(serializeAreaCanvas(effect.scene));
        inverse = {
          catalogs: [{
            owner,
            file: currentCatalog.file,
            beforeContent: currentCatalog.content,
            postContent: newCatalog,
            undo: effect.catalogUndo,
            resourceId: effect.resource.locator.id,
          }],
          semantic: effect.semanticInverse,
        };
        return {
          targets: [
            ...(effect.catalogChanged ? [{ file: currentCatalog.file, oldContent: currentCatalog.content, newContent: newCatalog }] : []),
            { area: owner, file: scene.file, oldContent: scene.content, newContent: newSource },
          ],
          guards,
          message: `update: ${request.viewedFrom} ${request.mutation.kind === "associate-generic-link" ? "associate Link as" : "add back"} Map resource`,
          result: {
            effect: request.mutation.kind,
            catalogOwners: uniqueOwners,
            warnings: effect.warnings,
            resource: effect.resource,
            sourceOwners: [owner],
          },
        };
      }

      const effect = await mutateCatalogs({ mutation: request.mutation, catalogs, inspectTarget, evidence: authority.evidence, viewedFrom: request.viewedFrom, now, generateId });
      const changed = catalogRows.filter((entry) => effect.changed.has(entry.owner)).map((before) => {
        const after = catalogs.get(before.owner);
        const newContent = Buffer.from(serializeAreaResourceCatalog(after.catalog));
        return { ...before, newContent };
      });
      inverse = {
        catalogs: changed.map((entry) => ({ owner: entry.owner, file: entry.file, beforeContent: entry.content, postContent: entry.newContent, undo: "exact", resourceId: effect.resource?.locator?.id ?? null })),
        semantic: null,
      };
      return {
        targets: changed.map((entry) => ({ file: entry.file, oldContent: entry.content, newContent: entry.newContent })),
        guards,
        message: `${request.mutation.kind === "remove" ? "remove" : changed.some((entry) => entry.exists) ? "update" : "add"}: ${request.viewedFrom} Map resource${changed.length === 1 ? "" : "s"}`,
        result: {
          effect: request.mutation.kind,
          catalogOwners: uniqueOwners,
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
      rehydrate: hydrateDurable,
    });
    let result = await save();
    if (["head-race", "guard-race"].includes(result?.code)) result = await save();
    if (Number(result?.status ?? 200) >= 400) {
      if (result.code === "guard-race") {
        const statusChanged = (result.changedPaths ?? []).some((file) => guardKinds.get(file) === "status");
        return statusChanged
          ? { ...result, code: "area-resource-read-only", status: 423, error: "Area status changed while the resource was saving." }
          : { ...result, code: "suggestion-changed", error: "Resource evidence changed while the operation was saving." };
      }
      if (result.code === "target-race") return sceneCoupled
        ? { ...result, code: "resource-representation-conflict", error: "The catalog or Map Block changed while the resource was saving." }
        : { ...result, code: "catalog-revision-changed", error: "Map resources changed while the operation was saving." };
      return result;
    }
    if (replay) {
      const replayUndo = undoReceipt?.operationId === request.operationId ? replay.undo : { state: "unavailable" };
      const decorated = await decorate(request.viewedFrom, result, replayUndo);
      operationReceipts.set(request.operationId, decorated);
      return decorated;
    }
    const eligible = Boolean(inverse && (["add", "add-suggestion", "edit", "remove"].includes(request.mutation.kind) && inverse.catalogs.length || sceneCoupled && inverse.semantic));
    let undo = { state: "unavailable" };
    if (eligible) {
      const post = await Promise.all(inverse.catalogs.map(async (entry) => ({ ...entry, postRevision: (await readCatalog(transactions, entry.owner)).revision })));
      const token = generateUndoToken();
      undoReceipt = { token, operationId: request.operationId, catalogs: post, semantic: inverse.semantic };
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
