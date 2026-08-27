import { createHash } from "node:crypto";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";

export const ATTEMPT_REPLACEMENT_SCHEMA = "goal-attempt-replacement.v1";
export const ATTEMPT_REPLACEMENT_STATES = new Set([
  "requested",
  "replacement-starting",
  "replacement-ready",
  "source-retiring",
  "complete",
  "failed",
  "rollback",
  "retirement-incomplete",
]);

const TERMINAL_STATES = new Set(["complete", "failed"]);
const TRANSITIONS = new Map([
  ["requested", new Set(["replacement-starting", "failed", "rollback"])],
  ["replacement-starting", new Set(["replacement-ready", "failed", "rollback"])],
  ["replacement-ready", new Set(["source-retiring", "rollback"])],
  ["source-retiring", new Set(["complete", "retirement-incomplete"])],
  ["retirement-incomplete", new Set(["source-retiring", "complete", "rollback"])],
  ["rollback", new Set(["failed"])],
]);

/** Stable storage path for one idempotent replacement operation. */
export function attemptReplacementPath(root, goal, operationId) {
  const digest = createHash("sha256").update(`${String(goal ?? "")}\0${String(operationId ?? "")}`).digest("hex");
  return path.join(root, `${digest}.json`);
}

/** Reads one replacement operation, or null when it is missing or invalid. */
export async function readAttemptReplacement(root, goal, operationId) {
  return normalizeAttemptReplacement(await readJsonObject(attemptReplacementPath(root, goal, operationId)));
}

/** Reads all durable replacement operations in stable file order. */
export async function readAllAttemptReplacements(root) {
  const records = [];
  for (const file of await walkJsonFiles(root)) {
    const record = normalizeAttemptReplacement(await readJsonObject(file));
    if (record) records.push(record);
  }
  return records;
}

/** Writes one replacement operation atomically. */
export async function writeAttemptReplacement(root, operation) {
  const record = normalizeAttemptReplacement(operation);
  if (!record) throw replacementError("invalid-operation", "the attempt replacement operation is invalid");
  Object.assign(operation, record, { updatedAt: operation.updatedAt ?? new Date().toISOString() });
  await writeJsonObject(attemptReplacementPath(root, operation.goal, operation.id), operation);
  return operation;
}

/** Returns only operations that the restarted controller must resume or surface. */
export function unsettledAttemptReplacements(records) {
  return (records ?? []).filter((record) => record && !TERMINAL_STATES.has(record.status));
}

/** True after replacement or rollback has reached a final outcome. */
export function attemptReplacementIsSettled(operation) {
  return TERMINAL_STATES.has(operation?.status);
}

/**
 * Creates one fenced replacement request from the current authoritative queue.
 * The caller persists this record before it starts a replacement process.
 */
export function newAttemptReplacement(queue, input, now = new Date().toISOString()) {
  const operationId = field(input?.operationId, 128);
  const goal = field(input?.goal, 500);
  const assignmentId = field(input?.assignmentId, 128);
  const expectedAttemptId = field(input?.expectedAttemptId, 128);
  if (!operationId) throw replacementError("operation-required", "an operation ID is required");
  if (!goal || goal !== queue?.goal) throw replacementError("goal-mismatch", "the replacement Goal does not match the authoritative queue");
  if (Number(input?.expectedRevision) !== Number(queue?.revision)) {
    throw replacementError("stale-revision", `stale-revision:${queue?.revision}`, { currentRevision: queue?.revision, pipeline: queue });
  }
  if (!assignmentId || assignmentId !== queue?.currentAssignmentId) {
    throw replacementError("stale-assignment", "the requested assignment is not the current assignment", { currentAssignmentId: queue?.currentAssignmentId ?? null });
  }
  const assignment = (queue.steps ?? queue.assignments ?? []).find((item) => item.id === assignmentId);
  if (!assignment || !["running", "waiting", "stopped"].includes(assignment.status)) {
    throw replacementError("assignment-not-replaceable", "the current assignment has no replaceable attempt");
  }
  const attempt = assignment.attempts?.findLast?.((item) => item.id === expectedAttemptId) ?? null;
  if (!attempt || assignment.attempts?.at(-1)?.id !== expectedAttemptId) {
    throw replacementError("stale-attempt", "the requested attempt is not current", { currentAttemptId: assignment.attempts?.at(-1)?.id ?? null });
  }
  const launch = normalizeLaunch(input?.launch);
  const sourceTarget = normalizeTarget(input?.sourceTarget);
  assertTargetMatches(sourceTarget, {
    area: queue.area,
    goal,
    assignmentId,
    attemptId: expectedAttemptId,
    session: attempt.session ?? assignment.session,
  }, "source");
  return {
    schema: ATTEMPT_REPLACEMENT_SCHEMA,
    id: operationId,
    goal,
    area: String(queue.area ?? ""),
    assignmentId,
    expectedRevision: Number(queue.revision),
    expectedAttemptId,
    launch,
    actor: normalizeActor(input?.actor),
    sourceTarget,
    replacementAttemptId: null,
    replacementTarget: null,
    resolvedLaunch: null,
    readiness: null,
    sourceOutcome: null,
    replacementOutcome: null,
    error: null,
    status: "requested",
    requestedAt: now,
    updatedAt: now,
    completedAt: null,
    events: [{ status: "requested", at: now }],
  };
}

/** True when an existing operation is the exact retry of one request. */
export function sameAttemptReplacementRequest(operation, input) {
  if (!operation) return false;
  const launch = normalizeLaunch(input?.launch);
  return operation.id === field(input?.operationId, 128)
    && operation.goal === field(input?.goal, 500)
    && operation.assignmentId === field(input?.assignmentId, 128)
    && operation.expectedRevision === Number(input?.expectedRevision)
    && operation.expectedAttemptId === field(input?.expectedAttemptId, 128)
    && JSON.stringify(operation.launch) === JSON.stringify(launch);
}

/**
 * Advances one persisted operation after validating the no-loss order.
 * The transition edits a clone first, so a refused transition is atomic.
 */
export function transitionAttemptReplacement(operation, status, patch = {}, now = new Date().toISOString()) {
  const next = String(status ?? "");
  if (!ATTEMPT_REPLACEMENT_STATES.has(next)) throw replacementError("invalid-state", `unknown replacement state ${next}`);
  if (operation?.status === next) return operation;
  if (!TRANSITIONS.get(operation?.status)?.has(next)) {
    throw replacementError("invalid-transition", `attempt replacement cannot move from ${operation?.status} to ${next}`);
  }
  const draft = structuredClone(operation);
  if (next === "replacement-starting") applyReplacementStart(draft, patch);
  else if (next === "replacement-ready") applyReplacementReadiness(draft, patch, now);
  else if (next === "source-retiring") assertReplacementReady(draft);
  else if (next === "complete") applySourceOutcome(draft, patch, now);
  else if (["failed", "rollback", "retirement-incomplete"].includes(next)) applyFailure(draft, patch);
  draft.status = next;
  draft.updatedAt = now;
  if (TERMINAL_STATES.has(next)) draft.completedAt = now;
  draft.events = [...(draft.events ?? []), { status: next, at: now, ...(draft.error ? { error: draft.error } : {}) }];
  Object.assign(operation, draft);
  return operation;
}

/** Returns null for unrelated data and a normalized durable operation otherwise. */
export function normalizeAttemptReplacement(value) {
  if (!value || typeof value !== "object" || value.schema !== ATTEMPT_REPLACEMENT_SCHEMA) return null;
  if (!field(value.id, 128) || !field(value.goal, 500) || !field(value.assignmentId, 128) || !ATTEMPT_REPLACEMENT_STATES.has(value.status)) return null;
  try {
    return {
      ...value,
      schema: ATTEMPT_REPLACEMENT_SCHEMA,
      id: field(value.id, 128),
      goal: field(value.goal, 500),
      area: String(value.area ?? ""),
      assignmentId: field(value.assignmentId, 128),
      expectedRevision: Number(value.expectedRevision),
      expectedAttemptId: field(value.expectedAttemptId, 128),
      launch: normalizeLaunch(value.launch),
      actor: normalizeActor(value.actor),
      sourceTarget: normalizeTarget(value.sourceTarget),
      replacementTarget: value.replacementTarget ? normalizeTarget(value.replacementTarget) : null,
      events: Array.isArray(value.events) ? value.events : [],
    };
  } catch {
    return null;
  }
}

/** Stores immutable replacement attempt and target facts before readiness. */
function applyReplacementStart(operation, patch) {
  const attemptId = field(patch?.replacementAttemptId, 128);
  if (!attemptId || attemptId === operation.expectedAttemptId) {
    throw replacementError("replacement-attempt-required", "a fresh replacement attempt ID is required");
  }
  const target = normalizeTarget(patch?.replacementTarget);
  assertTargetMatches(target, {
    area: operation.area,
    goal: operation.goal,
    assignmentId: operation.assignmentId,
    attemptId,
  }, "replacement");
  const resolvedLaunch = normalizeResolvedLaunch(patch?.resolvedLaunch, operation.launch);
  operation.replacementAttemptId = attemptId;
  operation.replacementTarget = target;
  operation.resolvedLaunch = resolvedLaunch;
  operation.replacementStartedAt = String(patch?.startedAt ?? new Date().toISOString());
  operation.error = null;
}

/** Records proof that permits the logical current-attempt swap. */
function applyReplacementReadiness(operation, patch, now) {
  if (!operation.replacementTarget || !operation.replacementAttemptId || !operation.resolvedLaunch) {
    throw replacementError("replacement-not-started", "the replacement target is not durable");
  }
  const kind = String(patch?.readiness?.kind ?? "");
  if (!["prompt-receipt", "julian-confirmed"].includes(kind)) {
    throw replacementError("replacement-not-ready", "source retirement needs a durable prompt receipt or Julian's explicit confirmation");
  }
  operation.readiness = {
    kind,
    at: String(patch.readiness.at ?? now),
    receiptId: field(patch.readiness.receiptId, 128) || null,
  };
  operation.error = null;
}

/** Refuses source retirement until the replacement has acceptable proof. */
function assertReplacementReady(operation) {
  if (!operation.replacementTarget || !["prompt-receipt", "julian-confirmed"].includes(operation.readiness?.kind)) {
    throw replacementError("replacement-not-ready", "the source stays alive until replacement readiness is proved");
  }
  operation.error = null;
}

/** Records exact source retirement or safe detachment as the final success. */
function applySourceOutcome(operation, patch, now) {
  assertReplacementReady(operation);
  const kind = String(patch?.sourceOutcome?.kind ?? "");
  if (!["retired", "detached"].includes(kind)) {
    throw replacementError("source-outcome-required", "completion needs an exact retired or detached source outcome");
  }
  operation.sourceOutcome = { kind, at: String(patch.sourceOutcome.at ?? now), detail: field(patch.sourceOutcome.detail, 500) || null };
  operation.error = null;
}

/** Stores one actionable failure without changing either immutable target. */
function applyFailure(operation, patch) {
  const message = field(patch?.error, 1000);
  if (!message) throw replacementError("failure-required", "a failed replacement state needs an error");
  operation.error = message;
  if (patch?.replacementOutcome) operation.replacementOutcome = structuredClone(patch.replacementOutcome);
}

/** Validates the exact tmux ownership fence for one source or replacement. */
function normalizeTarget(target) {
  const value = target && typeof target === "object" ? target : {};
  const normalized = {
    instanceId: field(value.instanceId, 128),
    area: field(value.area, 500),
    goal: field(value.goal, 500),
    assignmentId: field(value.assignmentId, 128),
    attemptId: field(value.attemptId, 128),
    session: field(value.session, 128),
    target: field(value.target, 128),
    generation: value.generation == null ? null : Number(value.generation),
  };
  for (const key of ["instanceId", "area", "goal", "assignmentId", "attemptId", "session", "target"]) {
    if (!normalized[key]) throw replacementError("target-incomplete", `the exact tmux target is missing ${key}`);
  }
  return normalized;
}

/** Proves a target against the immutable queue and attempt identity. */
function assertTargetMatches(target, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && target[key] !== value) throw replacementError("target-mismatch", `${label} target ${key} does not match the current attempt`);
  }
}

/** Normalizes one requested launch reference. */
function normalizeLaunch(launch) {
  const harness = field(launch?.harness, 128);
  if (!harness) throw replacementError("launch-required", "replacement launch needs a harness");
  return { harness, model: field(launch?.model, 128) || null, effort: field(launch?.effort, 128) || null };
}

/** Stores the exact immutable launch snapshot that a replacement process uses. */
function normalizeResolvedLaunch(resolved, requested) {
  const ref = normalizeLaunch(resolved?.ref ?? requested);
  if (JSON.stringify(ref) !== JSON.stringify(requested)) {
    throw replacementError("launch-mismatch", "the resolved replacement launch does not match the requested launch");
  }
  const command = field(resolved?.command, 2000);
  if (!command) throw replacementError("resolved-launch-required", "the replacement command is required");
  return { ref, command, label: field(resolved?.label, 500) || command };
}

/** Keeps actor identity as audit provenance only. */
function normalizeActor(actor) {
  if (!actor || typeof actor !== "object") return { session: null, area: null };
  return { session: field(actor.session, 128) || null, area: field(actor.area, 500) || null };
}

/** Normalizes one bounded record field. */
function field(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/** Creates one replacement-domain refusal with a stable code. */
function replacementError(code, message, fields = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, fields);
  return error;
}
