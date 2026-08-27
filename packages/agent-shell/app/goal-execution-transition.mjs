/** One structured refusal from an exact Goal execution transition. */
export class GoalExecutionTransitionError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "GoalExecutionTransitionError";
    this.code = code;
    Object.assign(this, fields);
  }
}

/**
 * Parks only the named current attempt and leaves assignment history and the
 * pending suffix in place. Process retirement remains a server-owned effect.
 */
export function parkCurrentGoalAttempt(queue, {
  assignmentId,
  expectedAttemptId,
  expectedRevision,
  operationId,
  reason = "",
  now = new Date().toISOString(),
} = {}) {
  const repeated = repeatedTransition(queue, operationId);
  if (repeated) return { state: "repeated", repeated: true, pipeline: queue, ...repeated };
  assertRevision(queue, expectedRevision);
  const draft = structuredClone(queue);
  const { assignment, attempt } = exactCurrentAttempt(draft, assignmentId, expectedAttemptId);
  const sourceSession = attempt.session ?? assignment.session ?? null;
  const note = oneLine(reason);
  attempt.endedAt ??= now;
  attempt.disposition = { type: "parked", reason: note || null, at: now };
  assignment.status = "stopped";
  assignment.session = null;
  assignment.endedAt = now;
  draft.currentAssignmentId = null;
  draft.status = "parked";
  draft.parks = [...(draft.parks ?? []), {
    operationId: key(operationId), assignmentId: assignment.id, attemptId: attempt.id, reason: note || null, parkedAt: now, reopenedAt: null,
  }];
  finishTransition(draft, operationId, now);
  replaceQueue(queue, draft);
  return { state: "parked", repeated: false, pipeline: queue, assignment, attempt, sourceSession };
}

/** Reopens a parked queue without selecting or starting any attempt. */
export function reopenParkedGoalQueue(queue, {
  expectedRevision,
  operationId,
  now = new Date().toISOString(),
} = {}) {
  const repeated = repeatedTransition(queue, operationId);
  if (repeated) return { state: "repeated", repeated: true, pipeline: queue };
  assertRevision(queue, expectedRevision);
  if (queue?.status !== "parked") throw transitionError("queue-not-parked", `the Goal queue is ${queue?.status ?? "missing"}, not parked`, queue);
  const draft = structuredClone(queue);
  draft.status = "open";
  draft.currentAssignmentId = null;
  const lastPark = draft.parks?.findLast?.((event) => !event.reopenedAt);
  if (lastPark) lastPark.reopenedAt = now;
  finishTransition(draft, operationId, now);
  replaceQueue(queue, draft);
  return { state: "reopened", repeated: false, pipeline: queue };
}

/**
 * Promotes a proved-ready replacement into the same assignment. The old
 * attempt becomes immutable replaced history before the new attempt becomes
 * current. Later assignments and every non-launch assignment field survive.
 */
export function promoteReadyReplacement(queue, operation, now = new Date().toISOString()) {
  if (operation?.status !== "replacement-ready") {
    throw transitionError("replacement-not-ready", "only a ready replacement can become current", queue);
  }
  if (!operation.readiness || !["prompt-receipt", "julian-confirmed"].includes(operation.readiness.kind)) {
    throw transitionError("replacement-not-ready", "replacement readiness is not proved", queue);
  }
  if (operation.goal !== queue?.goal) throw transitionError("goal-mismatch", "the replacement Goal does not match the queue", queue);
  const draft = structuredClone(queue);
  const existing = (draft.steps ?? draft.assignments ?? []).flatMap((assignment) => assignment.attempts ?? [])
    .find((attempt) => attempt.id === operation.replacementAttemptId);
  if (existing?.operationId === operation.id) {
    return { state: "repeated", repeated: true, pipeline: queue, replacementAttempt: existing };
  }
  if (existing) throw transitionError("duplicate-attempt", `attempt ${operation.replacementAttemptId} already exists`, queue);
  const { assignment, attempt: sourceAttempt } = exactCurrentAttempt(draft, operation.assignmentId, operation.expectedAttemptId);
  assertReplacementTarget(operation);
  const replacementAttempt = {
    id: operation.replacementAttemptId,
    operationId: operation.id,
    kind: "replacement",
    session: operation.replacementTarget.session,
    instanceId: operation.replacementTarget.instanceId,
    target: structuredClone(operation.replacementTarget),
    resolvedLaunch: structuredClone(operation.resolvedLaunch),
    cwd: operation.replacementTarget.cwd ?? null,
    cwdSource: operation.replacementTarget.cwdSource ?? null,
    startedAt: operation.replacementStartedAt ?? now,
    endedAt: null,
    report: null,
    result: null,
    lateEvidence: [],
  };
  sourceAttempt.endedAt ??= now;
  sourceAttempt.replacedByAttemptId = replacementAttempt.id;
  sourceAttempt.disposition = { type: "replaced", replacementAttemptId: replacementAttempt.id, operationId: operation.id, at: now };
  assignment.attempts = [...(assignment.attempts ?? []), replacementAttempt];
  // Only the desired launch and current runtime fields change. Instruction,
  // kind, path, continuation, reports, and every later assignment survive.
  assignment.launch = structuredClone(operation.launch);
  assignment.command = operation.resolvedLaunch.command;
  assignment.label = operation.resolvedLaunch.label ?? operation.resolvedLaunch.command;
  assignment.launchSource = "explicit";
  assignment.status = "running";
  assignment.session = replacementAttempt.session;
  assignment.startedAt = replacementAttempt.startedAt;
  assignment.endedAt = null;
  draft.instanceId = replacementAttempt.instanceId;
  draft.currentAssignmentId = assignment.id;
  if (draft.status === "parked") draft.status = "open";
  finishTransition(draft, operation.id, now);
  replaceQueue(queue, draft);
  return { state: "replacement-promoted", repeated: false, pipeline: queue, assignment, sourceAttempt, replacementAttempt };
}

/**
 * Attaches a late source report only to its ended attempt. It cannot alter
 * assignment reports, status, current assignment, or the replacement attempt.
 */
export function attachLateSourceEvidence(queue, {
  assignmentId,
  attemptId,
  evidence,
  idempotencyKey,
  now = new Date().toISOString(),
} = {}) {
  const evidenceKey = key(idempotencyKey || evidence?.idempotencyKey || evidence?.id);
  if (!evidenceKey) throw transitionError("evidence-id-required", "late evidence needs an idempotency key", queue);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw transitionError("invalid-evidence", "late evidence must be one object", queue);
  }
  const draft = structuredClone(queue);
  const assignment = assignmentById(draft, assignmentId);
  const attempt = assignment.attempts?.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw transitionError("attempt-not-found", `no attempt ${attemptId}`, queue);
  if (!attempt.endedAt || attempt.disposition?.type !== "replaced") {
    throw transitionError("attempt-not-replaced", "late source evidence belongs only to an ended replaced attempt", queue);
  }
  if (assignment.id === draft.currentAssignmentId && assignment.attempts?.at(-1)?.id === attempt.id) {
    throw transitionError("attempt-current", "late evidence cannot target the current attempt", queue);
  }
  const duplicate = attempt.lateEvidence?.find((item) => item.idempotencyKey === evidenceKey);
  if (duplicate) return { state: "repeated", repeated: true, pipeline: queue, evidence: duplicate };
  const stored = { ...structuredClone(evidence), idempotencyKey: evidenceKey, reportedAt: evidence.reportedAt ?? now };
  attempt.lateEvidence = [...(attempt.lateEvidence ?? []), stored];
  draft.revision = Math.max(1, Number(draft.revision) || 1) + 1;
  draft.updatedAt = now;
  replaceQueue(queue, draft);
  return { state: "late-evidence-attached", repeated: false, pipeline: queue, evidence: stored, attempt };
}

/** Returns and validates the exact current assignment and latest attempt. */
function exactCurrentAttempt(queue, assignmentId, expectedAttemptId) {
  const assignment = assignmentById(queue, assignmentId);
  if (queue.currentAssignmentId !== assignment.id) {
    throw transitionError("stale-assignment", "the named assignment is not current", queue, { currentAssignmentId: queue.currentAssignmentId ?? null });
  }
  const attempt = assignment.attempts?.at(-1) ?? null;
  if (!attempt || attempt.id !== key(expectedAttemptId)) {
    throw transitionError("stale-attempt", "the named attempt is not current", queue, { currentAttemptId: attempt?.id ?? null });
  }
  return { assignment, attempt };
}

/** Finds one stable assignment without using its display position. */
function assignmentById(queue, assignmentId) {
  const id = key(assignmentId);
  const assignment = (queue?.steps ?? queue?.assignments ?? []).find((candidate) => candidate.id === id);
  if (!assignment) throw transitionError("assignment-not-found", `no assignment ${id || "(empty)"}`, queue);
  return assignment;
}

/** Proves the ready replacement target against operation identity. */
function assertReplacementTarget(operation) {
  const target = operation.replacementTarget;
  if (!operation.replacementAttemptId || !target || !operation.resolvedLaunch?.command || !operation.launch?.harness) {
    throw transitionError("replacement-incomplete", "the ready replacement lacks immutable launch or target facts");
  }
  for (const [field, expected] of Object.entries({
    area: operation.area,
    goal: operation.goal,
    assignmentId: operation.assignmentId,
    attemptId: operation.replacementAttemptId,
  })) {
    if (target[field] !== expected) throw transitionError("target-mismatch", `replacement target ${field} does not match its operation`);
  }
}

/** Applies one queue revision and idempotency record after a valid transition. */
function finishTransition(queue, operationId, now) {
  const operation = key(operationId);
  if (!operation) throw transitionError("operation-required", "an operation ID is required", queue);
  queue.revision = Math.max(1, Number(queue.revision) || 1) + 1;
  queue.idempotencyKeys = [...(queue.idempotencyKeys ?? []), operation];
  queue.updatedAt = now;
  queue.assignments = queue.steps;
}

/** Finds the original transition result for an exact retry. */
function repeatedTransition(queue, operationId) {
  const operation = key(operationId);
  if (!operation || !queue?.idempotencyKeys?.includes(operation)) return null;
  const park = queue.parks?.find((event) => event.operationId === operation) ?? null;
  return park ? { assignment: assignmentById(queue, park.assignmentId), attempt: assignmentById(queue, park.assignmentId).attempts?.find((item) => item.id === park.attemptId) ?? null } : {};
}

/** Enforces a supplied expected revision before any clone is committed. */
function assertRevision(queue, expectedRevision) {
  if (Number(expectedRevision) !== Number(queue?.revision)) {
    throw transitionError("stale-revision", `stale-revision:${queue?.revision}`, queue, { currentRevision: queue?.revision });
  }
}

/** Replaces one queue only after its cloned transition succeeds. */
function replaceQueue(target, source) {
  for (const property of Object.keys(target)) delete target[property];
  Object.assign(target, source);
  target.assignments = target.steps;
  return target;
}

/** Collapses one optional lifecycle reason to a bounded line. */
function oneLine(value) {
  return String(value ?? "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Returns one bounded identifier. */
function key(value) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

/** Creates one transition-domain refusal with the authoritative queue. */
function transitionError(code, message, pipeline = null, fields = {}) {
  return new GoalExecutionTransitionError(code, message, { pipeline, ...fields });
}
