import { safeAreaResourceOwner as catalogAreaOwner } from "./area-resource-catalog.mjs";
import { isSafeResourceId } from "./public/area-map-entities.js";

const RECOVERY_CODES = new Set([
  "duplicate-resource-target",
  "catalog-revision-changed",
  "suggestion-changed",
  "missing-target-confirmation-required",
  "legacy-branch-choice-required",
  "resource-representation-conflict",
  "resource-source-load-failed",
  "resource-source-invalid",
  "undo-unavailable",
  "undo-stale",
]);
const SOURCE_RECOVERY_CODES = new Set(["resource-source-load-failed", "resource-source-invalid"]);
const REPRESENTATIONS = new Set(["on-map", "hidden", "never-placed"]);
const OBSERVATION_STATES = new Set(["not-checked", "checking", "current", "last-known", "unavailable"]);
const CATALOG_ERROR_CODES = new Set(["catalog-load-failed", "catalog-invalid", "catalog-unsupported"]);
const OBSERVATION_ERROR_CODES = new Set([
  "local-check-failed",
  "observation-capacity",
  "provider-access-unavailable",
  "provider-timeout",
  "provider-unavailable",
  "provider-state-unsupported",
]);
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const STRUCTURAL_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PUBLIC_MESSAGES = new Map([
  ["invalid-resource-request", "The Map resource request is invalid."],
  ["area-not-found", "The requested Area does not exist."],
  ["resource-not-found", "The requested Map resource does not exist."],
  ["catalog-revision-changed", "Map resources changed. Reload them before saving."],
  ["catalog-invalid", "Map resources are invalid and cannot be changed safely."],
  ["catalog-unsupported", "Map resources use a newer unsupported format."],
  ["duplicate-resource-target", "The target is already an active Map resource."],
  ["missing-target-confirmation-required", "The missing local target needs confirmation."],
  ["legacy-branch-choice-required", "Choose the resource that owns the legacy Branch."],
  ["suggestion-changed", "The reviewed resource evidence changed."],
  ["resource-representation-conflict", "The Map resource representation changed."],
  ["resource-source-load-failed", "A required Map resource source could not be loaded."],
  ["resource-source-invalid", "A required Map resource source is invalid."],
  ["operation-id-reused", "The operation ID was already used for different content."],
  ["undo-unavailable", "That Map resource Undo is no longer available."],
  ["undo-stale", "Map resources changed after the operation, so Undo is stale."],
  ["invalid-resource-target", "The Map resource target is unsafe or invalid."],
  ["inherited-resource-read-only", "An inherited Map resource must be changed in its owning Area."],
  ["area-resource-read-only", "Map resources for that Area are read-only."],
  ["catalog-load-failed", "Map resources could not be loaded."],
  ["resource-transaction-recovery", "Map resource transaction recovery must finish first."],
  ["resource-timeout", "The Map resource request timed out."],
  ["resource-unavailable", "Map resources are unavailable."],
  ["local-check-failed", "The local Map resource could not be inspected."],
]);

/** Reports whether one value is a plain JSON-shaped object. */
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null || value instanceof Error;
}

/** Returns one bounded text field without control bytes. */
function text(value, maximum = 4_096, { empty = false } = {}) {
  return typeof value === "string" && value.length <= maximum && (empty || value.length > 0) && !CONTROL_CHARACTER.test(value) ? value : null;
}

/** Returns one physical Area owner without control characters. */
function areaOwner(value) {
  return typeof value === "string" && !STRUCTURAL_CONTROL_CHARACTER.test(value) ? catalogAreaOwner(value) : null;
}

/** Returns one bounded array after every member validates. */
function array(value, project, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const projected = [];
  for (const item of value) {
    const current = project(item);
    if (current === null) return null;
    projected.push(current);
  }
  return projected;
}

/** Returns a safe public Area-resource locator. */
function locator(value) {
  const owner = areaOwner(value?.owner);
  return owner && isSafeResourceId(value?.id) ? { owner, id: value.id } : null;
}

/** Returns a closed target without persisted additive fields or URL credentials. */
function target(value, { suggestions = false } = {}) {
  if (!["worktree", "repository", ...(suggestions ? ["local-path"] : [])].includes(value?.kind)) {
    if (value?.kind !== "link") return null;
    const url = text(value.url, 8_000);
    if (!url || STRUCTURAL_CONTROL_CHARACTER.test(url) || /\s/u.test(url)) return null;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    } catch { return null; }
    return { kind: "link", url };
  }
  const valuePath = text(value.path, 32_768);
  return valuePath?.startsWith("/") && !STRUCTURAL_CONTROL_CHARACTER.test(valuePath) ? { kind: value.kind, path: valuePath } : null;
}

/** Returns a bounded public error fact. */
function publicError(value, expectedCode = null) {
  if (!object(value)) return null;
  const code = text(value.code, 128);
  const message = text(value.message, 2_000);
  if (!code || !message || expectedCode && code !== expectedCode) return null;
  const result = { code, message, retryable: value.retryable === true };
  const owner = areaOwner(value.owner);
  const source = ["area-note", "source-scene"].includes(value.source) ? value.source : null;
  if (owner) result.owner = owner;
  if (source) result.source = source;
  return result;
}

/** Returns one exact catalog read error. */
function catalogError(value) {
  const result = publicError(value);
  return result && CATALOG_ERROR_CODES.has(result.code) && result.owner && !result.source ? result : null;
}

/** Returns one exact note or source-scene projection error. */
function projectionError(value, expectedSource = null, expectedCode = null) {
  const result = publicError(value, expectedCode);
  if (!result || !["area-note", "source-scene"].includes(result.source) || !result.owner || expectedSource && result.source !== expectedSource) return null;
  return SOURCE_RECOVERY_CODES.has(result.code) ? result : null;
}

/** Returns one bounded local or provider observation error. */
function observationError(value, facet) {
  const result = publicError(value);
  if (!result || !OBSERVATION_ERROR_CODES.has(result.code) || result.owner || result.source) return null;
  if (facet === "local" && !["local-check-failed", "observation-capacity"].includes(result.code)) return null;
  if (facet === "provider" && result.code === "local-check-failed") return null;
  return result;
}

/** Returns one exact catalog expectation. */
function catalogExpectation(value) {
  const owner = areaOwner(value?.owner);
  if (!owner || !(value?.revision === null || text(value?.revision, 256))) return null;
  return { owner, revision: value.revision };
}

/** Returns one source representation fact. */
function representation(value) {
  if (value?.state === "current" && REPRESENTATIONS.has(value.value)) return { state: "current", value: value.value };
  if (value?.state === "unavailable") {
    const error = projectionError(value.error, "source-scene");
    return error ? { state: "unavailable", error } : null;
  }
  return null;
}

/** Returns one observed Git checkout without accepting provider or process fields. */
function checkout(value) {
  if (value?.kind === "branch") {
    const head = text(value.head, 256);
    const branchRef = text(value.branchRef, 1_000);
    return head && branchRef ? { kind: "branch", head, branchRef } : null;
  }
  if (value?.kind === "detached") {
    const head = text(value.head, 256);
    return head ? { kind: "detached", head } : null;
  }
  if (value?.kind === "bare" && (value.head === null || text(value.head, 256))) return { kind: "bare", head: value.head };
  return null;
}

/** Returns one local-resource observation value. */
function localValue(value, kind) {
  if (!["available", "missing", "not-a-worktree", "access-denied"].includes(value?.state)) return null;
  if (kind === "repository" && value.state === "not-a-worktree") return null;
  const result = { state: value.state };
  if (value.state === "available") {
    const projectedCheckout = checkout(value.checkout);
    if (!projectedCheckout || kind === "worktree" && projectedCheckout.kind === "bare") return null;
    result.checkout = projectedCheckout;
    if (typeof value.dirty === "boolean") result.dirty = value.dirty;
    if (kind === "worktree") {
      const repositoryPath = text(value.repositoryPath, 32_768);
      if (!repositoryPath?.startsWith("/") || STRUCTURAL_CONTROL_CHARACTER.test(repositoryPath)) return null;
      result.repositoryPath = repositoryPath;
    }
  }
  return result;
}

/** Returns a closed observation with either local or provider lifecycle values. */
function observation(value, projectValue, facet) {
  if (!OBSERVATION_STATES.has(value?.state)) return null;
  const checkedAt = value.checkedAt === null ? null : text(value.checkedAt, 128);
  if (checkedAt !== null && !Number.isFinite(Date.parse(checkedAt))) return null;
  if (value.state === "not-checked") return value.value === null && value.checkedAt === null ? { state: "not-checked", value: null, checkedAt: null } : null;
  if (value.state === "checking") {
    const projected = value.value === null ? null : projectValue(value.value);
    return projected !== null || value.value === null ? { state: "checking", value: projected, checkedAt } : null;
  }
  if (value.state === "current") {
    const projected = projectValue(value.value);
    return projected && checkedAt ? { state: "current", value: projected, checkedAt } : null;
  }
  const error = observationError(value.error, facet);
  if (!error) return null;
  if (value.state === "unavailable") return value.value === null && value.checkedAt === null ? { state: "unavailable", value: null, checkedAt: null, error } : null;
  const projected = projectValue(value.value);
  return projected && checkedAt ? { state: "last-known", value: projected, checkedAt, error } : null;
}

/** Returns one provider lifecycle value without adapter response fields. */
function lifecycleValue(value) {
  const stateLabel = text(value?.stateLabel, 100);
  const providerUpdatedAt = text(value?.providerUpdatedAt, 128);
  if (!stateLabel || !["neutral", "success", "muted"].includes(value?.treatment) || !providerUpdatedAt || !Number.isFinite(Date.parse(providerUpdatedAt))) return null;
  return { stateLabel, treatment: value.treatment, providerUpdatedAt };
}

/** Returns one closed Link facet. */
function linkFacet(value) {
  if (value === null) return null;
  if (value?.kind === "generic") return { kind: "generic" };
  const lifecycle = observation(value?.lifecycle, lifecycleValue, "provider");
  if (!lifecycle) return null;
  if (value.kind === "github-pr") {
    const owner = text(value.owner, 256);
    const repository = text(value.repository, 256);
    return owner && repository && Number.isSafeInteger(value.number) && value.number > 0
      ? { kind: "github-pr", owner, repository, number: value.number, lifecycle }
      : null;
  }
  if (value.kind === "phabricator-revision") {
    const baseUrl = text(value.baseUrl, 8_000);
    const revisionId = text(value.revisionId, 256);
    if (!baseUrl || STRUCTURAL_CONTROL_CHARACTER.test(baseUrl) || /\s/u.test(baseUrl) || !revisionId) return null;
    try {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    } catch { return null; }
    return { kind: "phabricator-revision", baseUrl, revisionId, lifecycle };
  }
  return null;
}

/** Returns one legacy origin. */
function origin(value) {
  if (value === null || value === undefined) return null;
  const evidenceHash = text(value?.evidenceHash, 256);
  if (value?.kind !== "legacy-area-binding" || !["Repository", "Worktree"].includes(value.field) || !evidenceHash) return null;
  if (!(value.declaredBranch === null || text(value.declaredBranch, 1_000))) return null;
  return { kind: "legacy-area-binding", field: value.field, evidenceHash, declaredBranch: value.declaredBranch };
}

/** Returns one cross-kind target warning. */
function warning(value) {
  const other = locator(value?.other);
  return ["path-alias", "cross-kind-target"].includes(value?.kind) && other ? { kind: value.kind, other } : null;
}

/** Returns one current or gone panel entity. */
function entity(value) {
  const projectedLocator = locator(value?.locator);
  if (!projectedLocator) return null;
  const warnings = array(value.warnings ?? [], warning, 100);
  if (!warnings) return null;
  if (Object.hasOwn(value, "target")) {
    const projectedTarget = target(value.target);
    const label = text(value.label, 2_000, { empty: true });
    const projectedRepresentation = representation(value.representation);
    if (!projectedTarget || label === null || !projectedRepresentation) return null;
    const projectedOrigin = origin(value.origin);
    if (value.origin !== null && value.origin !== undefined && !projectedOrigin) return null;
    if ((projectedTarget.kind === "link" && projectedOrigin)
      || (projectedOrigin?.field === "Worktree" && projectedTarget.kind !== "worktree")
      || (projectedOrigin?.field === "Repository" && projectedTarget.kind !== "repository")) return null;
    const result = {
      locator: projectedLocator,
      label,
      target: projectedTarget,
      representation: projectedRepresentation,
      origin: projectedOrigin,
      warnings,
      local: null,
      link: null,
    };
    if (projectedTarget.kind === "link") {
      const link = linkFacet(value.link);
      if (!link) return null;
      result.link = link;
    } else {
      const local = observation(value.local, (fact) => localValue(fact, projectedTarget.kind), "local");
      if (!local) return null;
      result.local = local;
    }
    return result;
  }
  if (!["removed", "missing-record"].includes(value?.reason) || !["on-map", "hidden"].includes(value?.representation)) return null;
  let lastKnown = null;
  if (value.lastKnown !== null && value.lastKnown !== undefined) {
    const label = text(value.lastKnown?.label, 2_000, { empty: true });
    const projectedTarget = target(value.lastKnown?.target);
    if (label === null || !projectedTarget) return null;
    lastKnown = { label, target: projectedTarget };
  }
  if (value.reason === "removed" && !lastKnown) return null;
  return { locator: projectedLocator, reason: value.reason, lastKnown, representation: value.representation, warnings };
}

/** Reports whether an owner is visible from one selected Area. */
function ownerVisibleFrom(owner, viewedFrom) { return owner === viewedFrom || viewedFrom.startsWith(`${owner}/`); }

/** Returns one closed panel row and rejects targets outside its selected Area. */
function row(value, expectedViewedFrom) {
  const viewedFrom = areaOwner(value?.viewedFrom);
  const projectedEntity = entity(value?.entity);
  if (!viewedFrom || viewedFrom !== expectedViewedFrom || !projectedEntity || !ownerVisibleFrom(projectedEntity.locator.owner, viewedFrom)) return null;
  let relation;
  if (value.relation?.kind === "direct" && projectedEntity.locator.owner === viewedFrom) relation = { kind: "direct" };
  else if (value.relation?.kind === "inherited" && areaOwner(value.relation.sourceArea) === projectedEntity.locator.owner) relation = { kind: "inherited", sourceArea: projectedEntity.locator.owner };
  else return null;
  const alsoFrom = array(value.alsoFrom ?? [], (owner) => {
    const safe = areaOwner(owner);
    return safe && ownerVisibleFrom(safe, viewedFrom) ? safe : null;
  }, 100);
  if (!alsoFrom || relation.kind === "inherited" && alsoFrom.length) return null;
  if (projectedEntity.reason && (relation.kind !== "direct" || projectedEntity.representation !== "on-map" || alsoFrom.length)) return null;
  let launchMatch;
  if (value.launchMatch?.state === "current" && typeof value.launchMatch.value === "boolean") launchMatch = { state: "current", value: value.launchMatch.value };
  else if (value.launchMatch?.state === "unavailable") {
    const error = projectionError(value.launchMatch.error, "area-note");
    if (!error) return null;
    launchMatch = { state: "unavailable", error };
  } else return null;
  return { viewedFrom, relation, alsoFrom, launchMatch, entity: projectedEntity };
}

/** Returns one closed discovery or legacy evidence identity. */
function evidence(value) {
  if (value?.kind === "knowledge-line") return { kind: "knowledge-line" };
  if (value?.kind === "legacy-area-binding" && ["Repository", "Worktree"].includes(value.field)) return { kind: "legacy-area-binding", field: value.field };
  if (value?.kind === "attempt") {
    const jobSlug = text(value.jobSlug, 512);
    const assignmentId = text(value.assignmentId, 512);
    const attemptId = text(value.attemptId, 512);
    return jobSlug && assignmentId && attemptId && Number.isSafeInteger(value.run) && value.run > 0
      ? { kind: "attempt", jobSlug, run: value.run, assignmentId, attemptId }
      : null;
  }
  if (value?.kind === "git-worktree") {
    const repositoryTargetFingerprint = text(value.repositoryTargetFingerprint, 256);
    const pathFingerprint = text(value.pathFingerprint, 256);
    return repositoryTargetFingerprint && pathFingerprint ? { kind: "git-worktree", repositoryTargetFingerprint, pathFingerprint } : null;
  }
  return null;
}

/** Returns one selectable suggestion or explicit invalid legacy declaration. */
function suggestion(value, viewedFrom, { legacy = false } = {}) {
  const owner = areaOwner(value?.owner);
  if (!owner || !ownerVisibleFrom(owner, viewedFrom)) return null;
  if (value.state === "invalid") {
    const message = text(value.message, 2_000);
    return legacy && ["Repository", "Worktree", "Branch"].includes(value.field) && message ? { state: "invalid", owner, field: value.field, message } : null;
  }
  const projectedTarget = target(value.target, { suggestions: true });
  const projectedEvidence = evidence(value.evidence);
  const evidenceHash = text(value.evidenceHash, 256);
  const targetFingerprint = text(value.targetFingerprint, 256);
  const proposedLabel = value.proposedLabel === null ? null : text(value.proposedLabel, 2_000, { empty: true });
  const provenanceLabel = text(value.provenanceLabel, 2_000, { empty: true });
  if (!projectedTarget || !projectedEvidence || !evidenceHash || !targetFingerprint
    || (value.proposedLabel !== null && proposedLabel === null) || provenanceLabel === null) return null;
  const legacyEvidence = projectedEvidence.kind === "legacy-area-binding";
  if (legacy !== legacyEvidence) return null;
  if (legacyEvidence && (projectedEvidence.field === "Repository" && projectedTarget.kind !== "repository"
    || projectedEvidence.field === "Worktree" && projectedTarget.kind !== "worktree")) return null;
  if (!legacyEvidence && projectedEvidence.kind === "knowledge-line" && !["link", "local-path"].includes(projectedTarget.kind)) return null;
  if (["attempt", "git-worktree"].includes(projectedEvidence.kind) && projectedTarget.kind !== "worktree") return null;
  const result = { owner, target: projectedTarget, evidence: projectedEvidence, evidenceHash, targetFingerprint, proposedLabel, provenanceLabel };
  if (legacy && value.state === "candidate") result.state = "candidate";
  else if (value.state !== undefined) return null;
  if (value.declaredBranch === null || text(value.declaredBranch, 1_000)) result.declaredBranch = value.declaredBranch;
  else if (value.declaredBranch !== undefined) return null;
  return result;
}

/** Returns one projection problem. */
function problem(value, viewedFrom) {
  if (!["catalog", "projection"].includes(value?.kind)) return null;
  const error = value.kind === "catalog" ? catalogError(value.error) : projectionError(value.error);
  return error && ownerVisibleFrom(error.owner, viewedFrom) ? { kind: value.kind, error } : null;
}

/** Returns the closed current or lower-bound count fact. */
function counts(value) {
  if (value?.state === "current" && ["confirmedAssociations", "suggestions", "legacyReview"].every((field) => Number.isSafeInteger(value[field]) && value[field] >= 0)) {
    return { state: "current", confirmedAssociations: value.confirmedAssociations, suggestions: value.suggestions, legacyReview: value.legacyReview };
  }
  if (value?.state === "lower-bound" && ["confirmedAssociationsAtLeast", "suggestionsAtLeast", "legacyReviewAtLeast"].every((field) => Number.isSafeInteger(value[field]) && value[field] >= 0)) {
    return { state: "lower-bound", confirmedAssociationsAtLeast: value.confirmedAssociationsAtLeast, suggestionsAtLeast: value.suggestionsAtLeast, legacyReviewAtLeast: value.legacyReviewAtLeast };
  }
  return null;
}

/** Reconstructs one panel projection instead of copying opaque nested data. */
function panelProjection(value) {
  if (!object(value)) return null;
  if (value.state === "unavailable") {
    const error = catalogError(value.error);
    return error ? { state: "unavailable", error } : null;
  }
  if (!["current", "partial"].includes(value.state)) return null;
  const catalogs = array(value.catalogs, catalogExpectation, 100);
  const viewedFrom = catalogs?.[0]?.owner;
  if (!viewedFrom || catalogs.some((item) => !ownerVisibleFrom(item.owner, viewedFrom))) return null;
  const rows = array(value.rows, (item) => row(item, viewedFrom));
  const legacyReview = array(value.legacyReview, (item) => suggestion(item, viewedFrom, { legacy: true }), 500);
  const suggestions = array(value.suggestions, (item) => suggestion(item, viewedFrom), 500);
  const projectedCounts = counts(value.counts);
  if (!rows || !catalogs || !legacyReview || !suggestions || !projectedCounts) return null;
  if (value.state === "current" && projectedCounts.state !== "current" || value.state === "partial" && projectedCounts.state !== "lower-bound") return null;
  const result = { state: value.state, rows, catalogs, legacyReview, suggestions, counts: projectedCounts };
  if (value.state === "partial") {
    const problems = array(value.problems, (item) => problem(item, viewedFrom), 500);
    if (!problems) return null;
    result.problems = problems;
  }
  return result;
}

/** Returns one closed local missing inspection. */
function missingInspection(value) {
  const normalized = target(value?.normalized);
  const targetFingerprint = text(value?.targetFingerprint, 256);
  return value?.kind === "local" && value.state === "missing" && normalized && normalized.kind !== "link" && targetFingerprint
    ? { kind: "local", normalized, targetFingerprint, state: "missing" }
    : null;
}

/** Returns one safe legacy Branch attachment choice. */
function branchChoice(value) {
  const owner = areaOwner(value?.owner);
  const targetFingerprint = text(value?.targetFingerprint, 256);
  const label = text(value?.label, 2_000, { empty: true });
  return owner && ["Repository", "Worktree"].includes(value?.field) && targetFingerprint && label !== null
    ? { owner, field: value.field, targetFingerprint, label }
    : null;
}

/** Returns one exact scene expectation. */
function sceneExpectation(value) {
  const owner = areaOwner(value?.owner);
  return owner && (value.hash === null || text(value.hash, 256)) ? { owner, hash: value.hash } : null;
}

/** Reconstructs only the accepted ResourceMutationRecovery union. */
export function sanitizeAreaResourceRecovery(value) {
  const code = text(value?.code, 128);
  if (!RECOVERY_CODES.has(code)) return null;
  const candidate = object(value.recovery) && value.recovery.code === code ? value.recovery : value;
  const projection = panelProjection(candidate.projection);
  if (!projection) return null;
  const viewedFrom = projection.state === "unavailable" ? projection.error.owner : projection.catalogs[0].owner;
  if (code === "duplicate-resource-target") {
    const existing = locator(candidate.existing);
    return existing && ownerVisibleFrom(existing.owner, viewedFrom) ? { code, existing, projection } : null;
  }
  if (["catalog-revision-changed", "suggestion-changed", "undo-unavailable", "undo-stale"].includes(code)) return { code, projection };
  if (code === "missing-target-confirmation-required") {
    const inspection = missingInspection(candidate.inspection ?? {
      kind: "local", state: "missing", normalized: candidate.normalized, targetFingerprint: candidate.targetFingerprint,
    });
    return inspection ? { code, inspection, projection } : null;
  }
  if (code === "legacy-branch-choice-required") {
    const choices = array(candidate.choices, branchChoice, 100);
    return choices?.length && choices.every((item) => ownerVisibleFrom(item.owner, viewedFrom)) ? { code, choices, projection } : null;
  }
  if (code === "resource-representation-conflict") {
    const currentScenes = array(candidate.currentScenes ?? (candidate.owner ? [{ owner: candidate.owner, hash: candidate.currentHash ?? null }] : null), sceneExpectation, 100);
    return currentScenes?.length && currentScenes.every((item) => ownerVisibleFrom(item.owner, viewedFrom)) ? { code, currentScenes, projection } : null;
  }
  if (SOURCE_RECOVERY_CODES.has(code)) {
    const sourceProblem = projectionError(candidate.problem, null, code);
    return sourceProblem && ownerVisibleFrom(sourceProblem.owner, viewedFrom) ? { code, problem: sourceProblem, projection } : null;
  }
  return null;
}

/** Returns only the additive recovery field accepted by generic transactions. */
export function areaResourceRecoveryFields(value) {
  const recovery = sanitizeAreaResourceRecovery(value);
  return recovery ? { recovery } : {};
}

/** Serializes one resource failure through a closed public allowlist. */
export function publicAreaResourceFailure(value) {
  const rawStatus = Number(value?.status ?? 500);
  const status = Number.isSafeInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const code = text(value?.code, 128) ?? "resource-operation-failed";
  const message = text(value?.publicMessage, 2_000) ?? PUBLIC_MESSAGES.get(code) ?? "The Map resource operation failed.";
  const result = { status, code, error: message, retryable: value?.retryable === true };
  const operationId = text(value?.operationId, 256);
  if (operationId) result.operationId = operationId;
  Object.assign(result, areaResourceRecoveryFields({ ...value, code }));
  return result;
}

export default { areaResourceRecoveryFields, publicAreaResourceFailure, sanitizeAreaResourceRecovery };
