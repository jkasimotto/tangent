// Job record store: one JSON file per Goal under the historical pipelines root,
// `${root}/${area}/${slug}.json`. Pure module, no tmux, no HTTP. The server
// owns session spawning and status transitions; this module owns the record
// shape, its validation, and the derived questions (which step is current,
// what comes next, what the whole pipeline's status is), so the rules are
// unit-testable without a live shell.

import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";
import { GOAL_QUEUE_SCHEMA, submitWorkerReport } from "./area-brain-domain.mjs";
import { normalizeWorkerHandoverReceipts } from "./worker-handover-receipt.mjs";

export const JOB_SCHEMA = "job.v1";
export const PIPELINE_SCHEMA = GOAL_QUEUE_SCHEMA;
const LEGACY_PIPELINE_SCHEMA = "agent-pipeline.v1";

const MAX_STEPS = 20;
const MAX_INSTRUCTION_CHARS = 2000;
const QUEUE_NORMALIZATION_CHANGED = Symbol("queueNormalizationChanged");
const JOB_FILE = Symbol("jobFile");
const JOB_MIGRATION = Symbol("jobMigration");
const MAX_OPERATION_RECEIPTS = 100;

/** One structured refusal from an atomic pending-assignment mutation. */
export class PipelineMutationError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "PipelineMutationError";
    this.code = code;
    Object.assign(this, fields);
  }
}

/** True when a read repaired a legacy record and the scheduler must persist it once. */
export function queueNormalizationChanged(record) {
  return record?.[QUEUE_NORMALIZATION_CHANGED] === true;
}

/** File path of one pipeline record. */
export function pipelinePath(root, area, slug) {
  return path.join(root, area, `${slug}.json`);
}

/** Reads one pipeline record, or null when the file is missing or unparsable. */
export async function readPipeline(root, area, slug) {
  const value = await readJsonObject(pipelinePath(root, area, slug));
  if (value?.schema === JOB_SCHEMA) return currentRunView(normalizeJobFile(value));
  return normalizeQueueRecord(value);
}

/** Reads every pipeline record under the root; empty when the root is missing. */
export async function readAllPipelines(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const value = await readJsonObject(file);
    const record = value?.schema === JOB_SCHEMA ? currentRunView(normalizeJobFile(value)) : normalizeQueueRecord(value);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Writes a record to its path with mkdir -p and an atomic tmp + rename, and
 * stamps updatedAt. Returns the record.
 */
export async function writePipeline(root, record) {
  const target = pipelinePath(root, record.area, record.slug);
  canonicalizeQueueInPlace(record);
  record.updatedAt = new Date().toISOString();
  const file = record[JOB_FILE] ?? jobFileFromLegacyRun(record);
  const run = file.runs.find((item) => item.run === record.run) ?? file.runs.find((item) => item.run === file.currentRun);
  if (!run) throw new Error("the Job has no current run");
  Object.assign(run, runForStorage(record));
  file.fileRevision = Math.max(0, Number(file.fileRevision) || 0) + 1;
  file.updatedAt = record.updatedAt;
  file.currentRun = record.run;
  file.nextRun = Math.max(Number(file.nextRun) || 1, record.run + 1);
  await writeJsonObject(target, jobFileForStorage(file));
  attachJobFile(record, file);
  return record;
}

/** Reads one canonical Job file with all immutable run history. */
export async function readJob(root, area, slug) {
  const value = await readJsonObject(pipelinePath(root, area, slug));
  return value?.schema === JOB_SCHEMA ? normalizeJobFile(value) : legacyJobFile(value);
}

/** Reads every canonical Job file, migrating old records in memory only. */
export async function readAllJobs(root) {
  const jobs = [];
  for (const file of await walkJsonFiles(root)) {
    const value = await readJsonObject(file);
    const job = value?.schema === JOB_SCHEMA ? normalizeJobFile(value) : legacyJobFile(value);
    if (job) jobs.push(job);
  }
  return jobs;
}

/** Returns one selected run. Older runs are immutable history. */
export function jobRun(file, run = file?.currentRun) {
  return file?.runs?.find((item) => item.run === Number(run)) ?? null;
}

/** Returns the read-old conversion facts without adding them to stored JSON. */
export function jobMigration(file) {
  return file?.[JOB_MIGRATION] ?? null;
}

/** Creates a new current run and seals the preceding terminal run. */
export function createJobRun(file, fields) {
  const current = jobRun(file);
  if (current && ["open", "paused"].includes(current.status)) throw new JobMutationError("job-open", "the current Job is still open");
  if (current && !current.sealedAt) current.sealedAt = fields?.now ?? new Date().toISOString();
  const record = newPipeline(fields);
  const run = Math.max(1, Number(file.nextRun) || 1);
  record.run = run;
  record.operations = [];
  record.stopOperation = null;
  record.startedAt = null;
  record.endedAt = null;
  record.sealedAt = null;
  file.runs.push(runForStorage(record));
  file.currentRun = run;
  file.nextRun = run + 1;
  file.fileRevision += 1;
  file.updatedAt = record.updatedAt;
  attachJobFile(record, file);
  return record;
}

/** Stores or replays one bounded idempotent operation receipt. */
export function applyOperationReceipt(target, { id, kind, input, outcome, resultRevision, at = new Date().toISOString() }) {
  const operationId = String(id ?? "").trim();
  if (!operationId) throw new JobMutationError("operation-required", "an operation ID is required");
  const inputHash = createInputHash(input);
  const found = (target.operations ?? []).find((entry) => entry.id === operationId);
  if (found) {
    if (found.inputHash !== inputHash) throw new JobMutationError("operation-conflict", `operation ${operationId} was already used with different input`);
    return { receipt: found, repeated: true };
  }
  const receipt = { id: operationId, kind: String(kind), inputHash, resultRevision: Number(resultRevision) || 0, outcome: String(outcome), at };
  target.operations = [...(target.operations ?? []), receipt].slice(-MAX_OPERATION_RECEIPTS);
  return { receipt, repeated: false };
}

/** Structured canonical Job mutation refusal. */
export class JobMutationError extends PipelineMutationError {
  constructor(code, message, fields = {}) {
    super(code, message, fields);
    this.name = "JobMutationError";
  }
}

/** Normalizes the legacy pipeline into the one production Goal queue shape. */
export function normalizeQueueRecord(value) {
  if (!value || typeof value !== "object" || ![PIPELINE_SCHEMA, LEGACY_PIPELINE_SCHEMA].includes(value.schema)) return null;
  const source = Array.isArray(value.assignments) ? value.assignments : Array.isArray(value.steps) ? value.steps : [];
  const { assignments, problem: assignmentProblem } = normalizeStoredAssignments(source);
  const revision = Math.max(1, Number(value.revision) || 1);
  const organizerArea = value.organizerArea ?? value.controllerArea ?? value.area;
  let supersededLegacyWait = false;
  for (let position = 0; position < assignments.length; position += 1) {
    const assignment = assignments[position];
    if (assignment.status !== "waiting") continue;
    const successor = assignments.slice(position + 1).find((item) => item.status !== "pending"
      || item.session
      || item.startedAt
      || item.attempts.length > 0
      || item.reports.length > 0);
    if (!successor) continue;
    assignment.status = "ended";
    assignment.endedAt ??= assignment.reports.at(-1)?.reportedAt ?? successor.startedAt ?? value.updatedAt ?? null;
    assignment.migrationResolution ??= {
      kind: "superseded-by-later-assignment",
      successorAssignmentId: successor.id,
    };
    supersededLegacyWait = true;
  }
  const running = assignments.filter((assignment) => ["running", "waiting"].includes(assignment.status));
  const generatedMultipleAttemptProblem = /^Queue has \d+ current attempts\.$/.test(String(value.migrationProblem ?? ""));
  const inheritedMigrationProblem = generatedMultipleAttemptProblem ? null : value.migrationProblem ?? null;
  const migrationProblem = running.length > 1
      ? `Queue has ${running.length} current attempts.`
      : assignmentProblem ?? inheritedMigrationProblem;
  const activeAssignment = assignments.find((item) => ["running", "waiting"].includes(item.status));
  const storedCurrent = assignments.find((item) => item.id === value.currentAssignmentId && ["running", "waiting"].includes(item.status));
  const reopenSupersededPause = supersededLegacyWait && generatedMultipleAttemptProblem && value.status === "paused";
  const normalized = {
    ...value,
    schema: PIPELINE_SCHEMA,
    organizerArea,
    goalRevision: String(value.goalRevision ?? ""),
    revision,
    status: migrationProblem ? "paused" : reopenSupersededPause ? "open" : value.status === "canceled" ? "stopped" : ["open", "complete", "paused", "stopped", "parked"].includes(value.status) ? value.status : "open",
    migrationProblem,
    currentAssignmentId: storedCurrent?.id ?? activeAssignment?.id ?? null,
    idempotencyKeys: Array.isArray(value.idempotencyKeys) ? value.idempotencyKeys : [],
    assignments,
    steps: assignments,
  };
  const storedAssignments = Array.isArray(value.assignments) ? value.assignments : Array.isArray(value.steps) ? value.steps : [];
  const normalizationChanged = value.schema !== normalized.schema
    || value.organizerArea !== normalized.organizerArea
    || String(value.goalRevision ?? "") !== normalized.goalRevision
    || Math.max(1, Number(value.revision) || 1) !== normalized.revision
    || value.status !== normalized.status
    || (value.migrationProblem ?? null) !== normalized.migrationProblem
    || (value.currentAssignmentId ?? null) !== normalized.currentAssignmentId
    || !Array.isArray(value.idempotencyKeys)
    || !Array.isArray(value.assignments)
    || !Array.isArray(value.steps)
    || JSON.stringify(storedAssignments) !== JSON.stringify(assignments.map(assignmentForStorage));
  Object.defineProperty(normalized, QUEUE_NORMALIZATION_CHANGED, { value: normalizationChanged });
  return normalized;
}

/** Deletes one pipeline record; a missing file is not an error. */
export async function deletePipeline(root, area, slug) {
  await rm(pipelinePath(root, area, slug), { force: true });
}

/**
 * Builds a fresh record with every step pending. Throws with the
 * validateSteps message when the steps are invalid.
 */
export function newPipeline({ goal, goalRevision = "", area, organizerArea = area, slug, extraFiles = [], steps, now = new Date().toISOString() }) {
  const error = validateSteps(steps);
  if (error) throw new Error(error);
  const assignments = normalizeNewAssignments(steps);
  return {
    schema: PIPELINE_SCHEMA,
    run: 1,
    goal,
    goalRevision,
    area,
    organizerArea,
    slug,
    revision: 1,
    status: "open",
    migrationProblem: null,
    currentAssignmentId: null,
    idempotencyKeys: [],
    operations: [],
    stopOperation: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    sealedAt: null,
    updatedAt: now,
    extraFiles: [...extraFiles],
    assignments,
    steps: assignments,
  };
}

/**
 * Appends steps to a record whose earlier steps may already have run. The
 * new steps are validated together with the existing ones (numbering and the
 * step cap continue from the record), normalized to pending, and pushed in
 * place. Returns the appended steps. Throws with the validation message.
 * Nothing already in the record changes: finished steps and their handovers
 * are history.
 */
export function appendSteps(record, steps) {
  if (!Array.isArray(steps) || steps.length < 1) throw new Error("append needs at least one step");
  const existing = record?.steps ?? [];
  const error = validateSteps([...existing, ...steps]);
  if (error) throw new Error(error);
  const added = normalizeNewAssignments(steps, existing);
  record.steps = [...existing, ...added];
  record.assignments = record.steps;
  if (["stopped", "parked", "paused"].includes(record.status)) throw new JobMutationError("job-not-reopenable", `a ${record.status} Job cannot reopen through append`);
  record.status = "open";
  record.endedAt = null;
  record.revision = Math.max(1, Number(record.revision) || 1) + 1;
  return added;
}

/** Stores one typed report against the current queue revision. */
export function recordTypedReport(record, step, report, idempotencyKey, now = new Date().toISOString()) {
  const result = submitWorkerReport(record, step.id, report, {
    expectedRevision: record.revision,
    idempotencyKey,
    now,
  });
  record.assignments = record.steps;
  return result;
}

/** Accepts the current Assignment's durable plain note before the next starts. */
export function acceptCurrentAssignment(record, nextIndex, now = new Date().toISOString()) {
  const current = (record?.assignments ?? record?.steps ?? []).find((assignment) => assignment.id === record.currentAssignmentId);
  if (!current) return { accepted: false, assignment: null };
  if (!["running", "waiting"].includes(current.status)) throw new JobMutationError("current-assignment-not-running", `assignment ${current.index} is ${current.status}`);
  const next = (record.assignments ?? record.steps).find((assignment) => assignment.index === Number(nextIndex));
  const expected = nextPendingStep(record, current.index);
  if (!next || next.status !== "pending" || expected?.id !== next.id) throw new JobMutationError("next-assignment-mismatch", `assignment ${nextIndex} is not the next pending Assignment`);
  const receipt = [...(current.handoverReceipts ?? [])].reverse().find((item) => item.reportType === "note" && item.queue?.result === "note" && item.notice?.id);
  if (!receipt) throw new JobMutationError("completion-note-required", `assignment ${current.index} needs a durable plain worker note before the Brain can accept it`);
  current.status = "complete";
  current.endedAt = now;
  const attempt = current.attempts?.find((item) => item.session === receipt.workerSession && !item.endedAt) ?? current.attempts?.at(-1);
  if (attempt && !attempt.endedAt) {
    attempt.endedAt = now;
    attempt.result = { type: "brain-accepted-note", status: "done", summary: "The organizing Brain accepted the worker's plain completion note." };
  }
  record.currentAssignmentId = null;
  record.revision = Math.max(1, Number(record.revision) || 1) + 1;
  record.updatedAt = now;
  record.assignments = record.steps ?? record.assignments;
  return { accepted: true, assignment: current, receipt };
}

/** Step statuses that never change again: the step ran, was skipped, or Julian ended the run. */
const FINAL_STATUSES = new Set(["complete", "skipped", "ended"]);

/**
 * Whether every step has finished (complete, skipped, or ended), so nothing
 * running or pending would carry the pipeline into a step appended now.
 */
export function pipelineFinished(record) {
  const steps = record?.steps ?? [];
  return steps.length > 0 && steps.every((step) => FINAL_STATUSES.has(step.status));
}

/**
 * Ends the run at Julian's word: every running, stopped, or pending step
 * becomes "ended" and keeps its handover, so the Goal falls back to plain
 * open work and the desk never offers Restart for it again. Steps that ran
 * to completion or were skipped are history and stay as they were. Returns
 * the indices that changed; an empty list means nothing was left to end.
 * Appending steps later starts fresh after the ended ones.
 */
export function endPipeline(record, now = new Date().toISOString()) {
  const changed = [];
  for (const step of record?.steps ?? []) {
    if (FINAL_STATUSES.has(step.status)) continue;
    step.status = "ended";
    step.endedAt = now;
    const attempt = step.attempts?.at(-1);
    if (attempt && !attempt.endedAt) {
      attempt.endedAt = now;
      attempt.result = attempt.result ?? { type: "canceled", summary: "The Goal queue was ended." };
    }
    changed.push(step.index);
  }
  if (changed.length) {
    record.status = "stopped";
    record.endedAt = now;
    record.revision = Math.max(1, Number(record.revision) || 1) + 1;
    record.updatedAt = now;
  }
  return changed;
}

/** Returns an error string naming the offending step, or null when the steps are valid. */
export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
    return `a pipeline needs 1 to ${MAX_STEPS} steps`;
  }
  for (let position = 0; position < steps.length; position += 1) {
    const step = steps[position] ?? {};
    const index = position + 1;
    const instruction = typeof step.instruction === "string" ? step.instruction.trim() : "";
    if (!instruction) return `step ${index}: instruction is empty`;
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      return `step ${index}: instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`;
    }
    if (!hasLaunch(step) && !hasCommand(step)) return `step ${index}: needs a launch or a command`;
    if (step.continueFrom !== null && step.continueFrom !== undefined) {
      const from = step.continueFrom;
      if (!Number.isInteger(from) || from < 1 || from > index - 1) {
        return `step ${index}: continueFrom must name an earlier step`;
      }
    }
    if (step.continueFromAssignmentId !== null && step.continueFromAssignmentId !== undefined) {
      const fromId = cleanAssignmentId(step.continueFromAssignmentId);
      const earlier = steps.slice(0, position).find((candidate, earlierPosition) => assignmentIdAt(candidate, earlierPosition) === fromId);
      if (!fromId || !earlier) return `step ${index}: continueFromAssignmentId must name an earlier assignment`;
      if (Number.isInteger(step.continueFrom) && assignmentIdAt(steps[step.continueFrom - 1], step.continueFrom - 1) !== fromId) {
        return `step ${index}: continuation references disagree`;
      }
    }
  }
  return null;
}

/**
 * Applies one revision-guarded batch to the mutable pending suffix.
 *
 * The function edits a clone first. A stale revision, invalid operation, or
 * broken continuation leaves the caller's record byte-for-byte unchanged.
 * The server still owns the per-Goal lock and the one durable write.
 */
export function mutatePendingAssignments(record, {
  expectedRevision,
  operationId,
  idempotencyKey,
  operations,
  now = new Date().toISOString(),
} = {}) {
  const key = String(operationId ?? idempotencyKey ?? "").trim();
  if (!key) throw mutationError("operation-required", "an operation ID is required", record);
  if (record?.idempotencyKeys?.includes(key)) {
    return { state: "repeated", repeated: true, pipeline: record, added: [], removed: [], moved: [] };
  }
  if (Number(expectedRevision) !== Number(record?.revision)) {
    throw mutationError("stale-revision", `stale-revision:${record?.revision}`, record, { currentRevision: record?.revision });
  }
  if (!Array.isArray(operations) || operations.length < 1) {
    throw mutationError("operations-required", "one or more assignment operations are required", record);
  }
  if (record?.migrationProblem || record?.status === "paused") {
    throw mutationError("queue-paused", record.migrationProblem ?? "the Goal queue is paused", record);
  }

  const draft = normalizeQueueRecord(structuredClone({ ...record, assignments: record.steps, steps: record.steps }));
  if (!draft) throw mutationError("invalid-queue", "the Goal queue is invalid", record);
  const immutableCount = lastImmutablePosition(draft.steps) + 1;
  const added = [];
  const removed = [];
  const moved = [];

  for (const operation of operations) {
    const type = String(operation?.type ?? "");
    if (type === "add") {
      const requested = operation.assignment && typeof operation.assignment === "object" ? operation.assignment : {};
      const id = requestedAssignmentId(requested.id, draft.steps);
      const insertion = insertionPosition(draft.steps, immutableCount, operation.afterAssignmentId);
      const assignment = normalizeNewAssignments([{ ...requested, id }], draft.steps.slice(0, insertion))[0];
      draft.steps.splice(insertion, 0, assignment);
      added.push(id);
    } else if (type === "update") {
      const target = mutableAssignment(draft.steps, immutableCount, operation.assignmentId);
      applyPendingPatch(target, operation.patch);
    } else if (type === "remove") {
      const target = mutableAssignment(draft.steps, immutableCount, operation.assignmentId);
      draft.steps.splice(draft.steps.indexOf(target), 1);
      removed.push(target.id);
    } else if (type === "move") {
      const target = mutableAssignment(draft.steps, immutableCount, operation.assignmentId);
      const from = draft.steps.indexOf(target);
      draft.steps.splice(from, 1);
      const insertion = insertionPosition(draft.steps, immutableCount, operation.afterAssignmentId);
      draft.steps.splice(insertion, 0, target);
      moved.push(target.id);
    } else {
      throw mutationError("unknown-operation", `unknown assignment operation ${type || "(empty)"}`, record);
    }
  }

  reindexAssignments(draft.steps);
  if (!draft.steps.length) throw mutationError("empty-queue", "a pipeline needs 1 to 20 steps", record);
  const validation = validateSteps(draft.steps);
  if (validation) throw mutationError("invalid-assignments", validation, record);
  if (!pendingSuffixIsMutable(draft.steps, immutableCount)) {
    throw mutationError("assignment-history-immutable", "started assignment history cannot move or change", record);
  }

  draft.revision = Math.max(1, Number(draft.revision) || 1) + 1;
  draft.idempotencyKeys = [...(draft.idempotencyKeys ?? []), key];
  draft.updatedAt = now;
  draft.assignments = draft.steps;
  replaceQueueContents(record, draft);
  return { state: "updated", repeated: false, pipeline: record, added, removed, moved };
}

/** Resolves one assignment's stable continuation source. */
export function continuationSource(record, assignment) {
  const id = cleanAssignmentId(assignment?.continueFromAssignmentId);
  return id ? (record?.steps ?? []).find((candidate) => candidate.id === id) ?? null : null;
}

/** The step the pipeline is on: first running or stopped, else first pending, else null. */
export function currentStep(record) {
  const steps = record?.steps ?? [];
  return steps.find((step) => ["running", "waiting", "stopped"].includes(step.status))
    ?? steps.find((step) => step.status === "pending")
    ?? null;
}

/** Restores stopped steps whose exact sessions are present in the live snapshot. */
export function reclaimLiveSteps(record, liveSessions) {
  let changed = false;
  for (const step of record?.steps ?? []) {
    if (step.status !== "stopped" || !step.session || !liveSessions.has(step.session)) continue;
    step.status = "running";
    step.endedAt = null;
    const attempt = step.attempts?.findLast?.((item) => item.session === step.session);
    if (attempt?.result?.type === "runtime-stopped") {
      attempt.endedAt = null;
      attempt.result = null;
    }
    changed = true;
  }
  return changed;
}

/** First pending step after the given index, else null. */
export function nextPendingStep(record, afterIndex) {
  const steps = record?.steps ?? [];
  return steps.find((step) => step.status === "pending" && step.index > afterIndex) ?? null;
}

// A sessions snapshot the server polls tmux for can predate a step or Goal
// binding written moments earlier (spawnGoalSession creates the tmux session
// and writes the binding before the next poll can see it): a reconcile pass
// racing that stale snapshot must not treat the missing session as gone.
export const RECONCILE_GRACE_MS = 30_000;

/**
 * Whether a sessions snapshot can testify that a specific session ended. An
 * empty snapshot cannot: every wrong-world failure (a test's isolated tmux
 * socket, a sandbox that cannot reach the socket, a dead tmux server) shows
 * zero sessions at once, while a genuinely ended session disappears from a
 * world that still holds the others. Absence-based transitions (stopping
 * steps, reopening Goals, ending brains, clearing armed prompts) must never
 * run on a snapshot this function rejects; on 2026-08-24 a test-spawned
 * server did exactly that against the real records and repeatedly reported
 * live workers as stopped.
 */
export function snapshotCanJudgeAbsence(sessions) {
  return Array.isArray(sessions) && sessions.length > 0;
}

/**
 * True while `at` (an epoch ms, or NaN/undefined) is recent enough that a
 * sessions snapshot taken around `now` cannot be trusted to include
 * whatever tmux session it caused.
 */
export function withinReconcileGrace(at, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  return typeof at === "number" && !Number.isNaN(at) && now - at < graceMs;
}

/**
 * True while a running step started too recently for a stale sessions
 * snapshot to be trusted about it being gone. A continuation moves
 * `step.session` to a fresh tmux session that may not exist yet in the
 * snapshot while `startedAt` stays old, so the grace also covers the newest
 * continuation's `at` time: the later of the two, NaN-safe (the finite
 * maximum, NaN when neither parses).
 */
export function stepStartedWithinGrace(step, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  const startedAt = step?.startedAt ? Date.parse(step.startedAt) : NaN;
  const continuedAt = step?.continuations?.at(-1)?.at ? Date.parse(step.continuations.at(-1).at) : NaN;
  const candidates = [startedAt, continuedAt].filter(Number.isFinite);
  const at = candidates.length ? Math.max(...candidates) : NaN;
  return withinReconcileGrace(at, now, graceMs);
}

/**
 * True when a running step's session is missing from a sessions snapshot and
 * the step is old enough that the snapshot can be trusted: this is the only
 * condition under which reconcile marks a step stopped. `liveNames` is any
 * collection with `has(name)` (a Set of names or a Map keyed by name).
 * Pass the snapshot's capture time as `now`: a snapshot only testifies
 * about the moment it was taken, so a step started after that moment is
 * inside the grace however old the wall clock says the pass is.
 */
export function stepGoneFromSnapshot(step, liveNames, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  if (!step?.session || liveNames.has(step.session)) return false;
  return !stepStartedWithinGrace(step, now, graceMs);
}

/**
 * True when an active Goal's bound session is missing from a sessions
 * snapshot and the binding (the Goal file's mtime, epoch ms) is old enough
 * that the snapshot can be trusted: the only condition under which
 * reconcile flips the Goal back to open. Pass the snapshot's capture time
 * as `now`, same as stepGoneFromSnapshot.
 */
export function goalBindingGoneFromSnapshot(goal, liveNames, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  if (goal?.status !== "active" || !goal.session || liveNames.has(goal.session)) return false;
  return !withinReconcileGrace(goal.mtime, now, graceMs);
}

/**
 * Derived pipeline status. isLive(sessionName) tells whether a running
 * step's session still exists; a running step whose session is gone counts
 * as stopped.
 */
export function pipelineStatus(record, isLive) {
  const steps = record?.steps ?? [];
  if (pipelineFinished(record)) return "complete";
  if (steps.some((step) => step.status === "stopped")) return "stopped";
  const running = steps.filter((step) => ["running", "waiting"].includes(step.status));
  if (running.some((step) => !isLive(step.session))) return "stopped";
  if (running.length > 0) return "running";
  return "pending";
}

/** Whether a step carries a usable launch reference. */
function hasLaunch(step) {
  return Boolean(step.launch && typeof step.launch === "object" && typeof step.launch.harness === "string" && step.launch.harness.trim());
}

/** Whether a step carries a hand-typed command. */
function hasCommand(step) {
  return typeof step.command === "string" && step.command.trim().length > 0;
}

/** Normalizes one validated assignment into its stored pending shape. */
function normalizeStep(step, index, continueFromAssignmentId = null) {
  const launch = hasLaunch(step)
    ? {
      harness: step.launch.harness.trim(),
      model: typeof step.launch.model === "string" && step.launch.model ? step.launch.model : null,
      effort: typeof step.launch.effort === "string" && step.launch.effort ? step.launch.effort : null
    }
    : null;
  return {
    id: step.id || `assignment-${index}`,
    index,
    instruction: step.instruction.trim(),
    launch,
    command: launch ? "" : step.command.trim(),
    label: "",
    // Where the harness came from. The server fills this in when the calling
    // brain lent the assignment its own launch; it is never inferred later
    // from a record that may have changed since.
    launchSource: step.launchSource === "brain-default" ? "brain-default" : "explicit",
    path: typeof step.path === "string" && step.path.trim() ? step.path.trim() : null,
    continueFromAssignmentId,
    continueFrom: null,
    kind: step.kind === "review" ? "review" : "implementation",
    status: "pending",
    session: null,
    startedAt: null,
    endedAt: null,
    handover: null,
    handoverSource: null,
    attempts: [],
    reports: [],
    handoverReceipts: [],
  };
}

/** Adds queue fields to one stored assignment without changing its history. */
function normalizeStoredAssignment(step, index, id) {
  const normalized = {
    ...step,
    id,
    index,
    kind: step.kind === "review" ? "review" : "implementation",
    attempts: Array.isArray(step.attempts) ? step.attempts : [],
    reports: Array.isArray(step.reports) ? step.reports : [],
    handoverReceipts: normalizeWorkerHandoverReceipts(step.handoverReceipts),
  };
  normalizeLegacyWorkerQuestions(normalized);
  return normalized;
}

/** Converts the removed worker-question protocol into blocked work or continuation facts. */
function normalizeLegacyWorkerQuestions(assignment) {
  const legacyType = ["question", "needed"].join("-");
  const legacyReports = assignment.reports.filter((report) => report?.type === legacyType);
  if (!legacyReports.length) return assignment;
  assignment.continuations = Array.isArray(assignment.continuations) ? assignment.continuations : [];
  const kept = [];
  for (const report of assignment.reports) {
    if (report?.type !== legacyType) { kept.push(stripLegacyQuestionState(report)); continue; }
    const answer = report.questionState?.answer?.text;
    const summary = String(report.summary ?? report.question ?? "Worker could not continue.").trim();
    if (answer) {
      const facts = `The earlier worker needed this fact: ${summary}\nRecorded answer: ${String(answer).trim()}`;
      if (!assignment.continuations.some((entry) => entry?.facts === facts)) {
        assignment.continuations.push({ session: report.questionState?.askedSession ?? assignment.session ?? "earlier worker", next: null, facts, at: report.questionState?.answer?.answeredAt ?? report.reportedAt ?? null });
      }
    } else {
      const blocked = stripLegacyQuestionState({ ...report, type: "failed", summary });
      delete blocked.question;
      kept.push(blocked);
      assignment.status = "waiting";
    }
  }
  assignment.reports = kept;
  assignment.attempts = assignment.attempts.map((attempt) => ({
    ...attempt,
    result: stripLegacyAttemptCopy(attempt.result, legacyType),
    report: stripLegacyAttemptCopy(attempt.report, legacyType),
  }));
  assignment.handoverReceipts = assignment.handoverReceipts.map((receipt) => {
    if (receipt.reportType !== legacyType) return receipt;
    const open = kept.some((report) => report.type === "failed" && report.idempotencyKey && report.idempotencyKey === receipt.idempotencyKey)
      || legacyReports.some((report) => !report.questionState?.answer && receipt.notice?.text?.includes(report.summary ?? report.question ?? ""));
    const answer = legacyReports.find((report) => report.questionState?.answer)?.questionState.answer.text;
    return {
      ...receipt,
      reportType: open ? "failed" : "note",
      notice: { ...receipt.notice, text: open ? receipt.notice.text.replace(/^question:/, "blocked:") : `note: Recorded continuation fact. ${String(answer ?? "").trim()}`.trim() },
    };
  });
  return assignment;
}

/** Removes an obsolete report copy from one attempt projection. */
function stripLegacyAttemptCopy(value, legacyType) {
  if (!value || typeof value !== "object") return value;
  if (value.type === legacyType) return null;
  return stripLegacyQuestionState(value);
}

/** Drops the obsolete nested state while preserving ordinary report fields. */
function stripLegacyQuestionState(value) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...value };
  delete copy.questionState;
  return copy;
}

/** Gives new assignments unique stable identities and resolves legacy numeric continuations. */
function normalizeNewAssignments(steps, existing = []) {
  const used = new Set(existing.map((assignment) => assignment.id));
  const assignments = steps.map((step, position) => {
    const index = existing.length + position + 1;
    const requested = cleanAssignmentId(step?.id);
    const id = requested && !used.has(requested) ? requested : nextAssignmentId([...existing, ...steps], used, index);
    used.add(id);
    return normalizeStep({ ...step, id }, index, null);
  });
  const all = [...existing, ...assignments];
  for (const [position, assignment] of assignments.entries()) {
    const input = steps[position] ?? {};
    const numeric = Number.isInteger(input.continueFrom) ? all[input.continueFrom - 1]?.id ?? null : null;
    assignment.continueFromAssignmentId = cleanAssignmentId(input.continueFromAssignmentId) || numeric;
  }
  reindexAssignments(all);
  return assignments;
}

/** Normalizes stored identities and continuation references in two passes. */
function normalizeStoredAssignments(source) {
  const used = new Set();
  let problem = null;
  const assignments = source.map((step, position) => {
    const requested = cleanAssignmentId(step?.id);
    let id = requested;
    if (!id || used.has(id)) {
      if (id && !problem) problem = `Queue has duplicate assignment id ${id}.`;
      id = nextAssignmentId(source, used, position + 1);
    }
    used.add(id);
    return normalizeStoredAssignment(step ?? {}, position + 1, id);
  });
  for (let position = 0; position < assignments.length; position += 1) {
    const input = source[position] ?? {};
    const stable = cleanAssignmentId(input.continueFromAssignmentId);
    const numericSpecified = Object.hasOwn(input, "continueFrom");
    const numeric = Number.isInteger(input.continueFrom) ? assignments[input.continueFrom - 1]?.id ?? null : null;
    // A dual-field in-memory compatibility projection can be changed by an
    // older caller. When the fields disagree, the changed numeric value wins.
    const continuationId = numericSpecified && numeric !== stable ? numeric : stable || numeric;
    assignments[position].continueFromAssignmentId = continuationId || null;
    const earlier = continuationId ? assignments.slice(0, position).findIndex((item) => item.id === continuationId) : -1;
    assignments[position].continueFrom = earlier >= 0 ? earlier + 1 : null;
    if (!problem && (stable || (numericSpecified && input.continueFrom !== null && input.continueFrom !== undefined)) && earlier < 0) {
      problem = `Assignment ${assignments[position].id} continuation must name an earlier assignment.`;
    }
  }
  return { assignments, problem };
}

/** Rebuilds display indices and numeric compatibility projections after an edit. */
function reindexAssignments(assignments) {
  const byId = new Map(assignments.map((assignment, position) => [assignment.id, position]));
  for (const [position, assignment] of assignments.entries()) {
    assignment.index = position + 1;
    const source = byId.get(cleanAssignmentId(assignment.continueFromAssignmentId));
    assignment.continueFrom = Number.isInteger(source) && source < position ? source + 1 : null;
  }
  return assignments;
}

/** Returns one deterministic unused identity for migrated or newly added assignments. */
function nextAssignmentId(_source, used, seed = 1) {
  for (let number = Math.max(1, Number(seed) || 1); ; number += 1) {
    const id = `assignment-${number}`;
    if (!used.has(id)) return id;
  }
}

/** Returns a cleaned stable assignment identity. */
function cleanAssignmentId(value) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

/** Returns the identity validateSteps projects for one input row. */
function assignmentIdAt(step, position) {
  return cleanAssignmentId(step?.id) || `assignment-${position + 1}`;
}

/** Converts an in-memory compatibility queue into its stable persisted shape. */
function runForStorage(record) {
  const stored = structuredClone(record);
  stored.run = Math.max(1, Number(record.run) || 1);
  stored.revision = Math.max(1, Number(record.revision) || 1);
  stored.assignments = (stored.steps ?? stored.assignments ?? []).map(assignmentForStorage);
  delete stored.steps;
  delete stored.schema;
  delete stored.goal;
  delete stored.area;
  delete stored.slug;
  delete stored.fileRevision;
  delete stored.currentRun;
  delete stored.nextRun;
  return stored;
}

/** Canonical stored shape: assignments only, with all runs in one file. */
function jobFileForStorage(file) {
  return {
    schema: JOB_SCHEMA,
    goal: file.goal,
    area: file.area,
    slug: file.slug,
    fileRevision: Math.max(1, Number(file.fileRevision) || 1),
    currentRun: file.currentRun == null ? null : Number(file.currentRun),
    nextRun: Math.max(1, Number(file.nextRun) || 1),
    runs: (file.runs ?? []).map(runForStorage),
    operations: [...(file.operations ?? [])].slice(-MAX_OPERATION_RECEIPTS),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

/** Converts one legacy queue record into an in-memory Job file. */
function legacyJobFile(value) {
  const run = normalizeQueueRecord(value);
  if (!run) return null;
  const file = jobFileFromLegacyRun(run);
  Object.defineProperty(file, JOB_MIGRATION, { value: { source: value.schema, paused: run.status === "paused", problem: run.migrationProblem ?? null } });
  return file;
}

/** Wraps one normalized legacy run in a Job file. */
function jobFileFromLegacyRun(run) {
  const normalized = normalizeQueueRecord({ ...run, schema: run.schema === LEGACY_PIPELINE_SCHEMA ? LEGACY_PIPELINE_SCHEMA : PIPELINE_SCHEMA });
  if (!normalized) throw new Error("the Job record is invalid");
  normalized.run = Math.max(1, Number(run.run) || 1);
  normalized.status = normalized.status === "canceled" ? "stopped" : normalized.status;
  normalized.operations = [...(run.operations ?? [])].slice(-MAX_OPERATION_RECEIPTS);
  normalized.stopOperation = run.stopOperation ?? null;
  normalized.startedAt = run.startedAt ?? normalized.assignments.find((item) => item.startedAt)?.startedAt ?? null;
  normalized.endedAt = run.endedAt ?? (["complete", "stopped", "parked"].includes(normalized.status) ? run.updatedAt ?? null : null);
  normalized.sealedAt = run.sealedAt ?? null;
  return {
    schema: JOB_SCHEMA,
    goal: normalized.goal,
    area: normalized.area,
    slug: normalized.slug,
    fileRevision: Math.max(1, Number(run.fileRevision) || Number(normalized.revision) || 1),
    currentRun: normalized.run,
    nextRun: normalized.run + 1,
    runs: [runForStorage(normalized)],
    operations: [],
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

/** Normalizes one persisted job.v1 file for in-memory use. */
function normalizeJobFile(value) {
  if (!value || value.schema !== JOB_SCHEMA || !Array.isArray(value.runs)) return null;
  const runs = value.runs.map((raw) => {
    const queue = normalizeQueueRecord({
      ...raw,
      schema: PIPELINE_SCHEMA,
      goal: value.goal,
      area: value.area,
      slug: value.slug,
      assignments: raw.assignments,
      steps: raw.assignments,
    });
    if (!queue) return null;
    queue.run = Math.max(1, Number(raw.run) || 1);
    queue.status = queue.status === "canceled" ? "stopped" : queue.status;
    queue.operations = [...(raw.operations ?? [])].slice(-MAX_OPERATION_RECEIPTS);
    queue.stopOperation = raw.stopOperation ?? null;
    queue.startedAt = raw.startedAt ?? null;
    queue.endedAt = raw.endedAt ?? null;
    queue.sealedAt = raw.sealedAt ?? null;
    return queue;
  }).filter(Boolean);
  if (!runs.length) return null;
  const file = {
    schema: JOB_SCHEMA,
    goal: String(value.goal ?? ""),
    area: String(value.area ?? ""),
    slug: String(value.slug ?? ""),
    fileRevision: Math.max(1, Number(value.fileRevision) || 1),
    currentRun: value.currentRun == null ? null : Number(value.currentRun),
    nextRun: Math.max(Math.max(...runs.map((run) => run.run)) + 1, Number(value.nextRun) || 1),
    runs,
    operations: [...(value.operations ?? [])].slice(-MAX_OPERATION_RECEIPTS),
    createdAt: value.createdAt ?? runs[0].createdAt,
    updatedAt: value.updatedAt ?? runs.at(-1).updatedAt,
  };
  for (const run of runs) attachJobFile(run, file);
  return file;
}

/** Returns the compatibility view of a Job file's current run. */
function currentRunView(file) {
  if (!file) return null;
  const run = jobRun(file);
  if (!run) return null;
  attachJobFile(run, file);
  return run;
}

/** Attaches a non-persisted parent Job file to one run view. */
function attachJobFile(run, file) {
  Object.defineProperty(run, JOB_FILE, { value: file, writable: true, configurable: true });
  return run;
}

/** Hashes operation input for idempotent receipt comparison. */
function createInputHash(input) {
  return createHash("sha256").update(JSON.stringify(input ?? null)).digest("hex");
}

/** Removes the numeric continuation projection from one persisted assignment. */
function assignmentForStorage(assignment) {
  const canonical = { ...assignment, continueFromAssignmentId: cleanAssignmentId(assignment.continueFromAssignmentId) || null };
  delete canonical.continueFrom;
  return canonical;
}

/** Applies compatibility input changes and restores one canonical in-memory queue. */
function canonicalizeQueueInPlace(record) {
  const normalized = normalizeQueueRecord({ ...record, schema: PIPELINE_SCHEMA, assignments: record.steps, steps: record.steps });
  if (!normalized) throw new Error("the Goal queue is invalid");
  const currentAssignments = Array.isArray(record.steps) ? record.steps : [];
  if (currentAssignments.length === normalized.steps.length) {
    for (const [position, assignment] of currentAssignments.entries()) {
      for (const key of Object.keys(assignment)) delete assignment[key];
      Object.assign(assignment, normalized.steps[position]);
    }
    normalized.steps = currentAssignments;
    normalized.assignments = currentAssignments;
  }
  replaceQueueContents(record, normalized);
  return record;
}

/** Replaces one queue object's own fields while preserving its caller-held identity. */
function replaceQueueContents(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
  target.assignments = target.steps;
  return target;
}

/** Creates one structured mutation refusal with the current queue attached. */
function mutationError(code, message, pipeline, fields = {}) {
  return new PipelineMutationError(code, message, { pipeline, ...fields });
}

/** The zero-based position of the last assignment that is immutable history. */
function lastImmutablePosition(assignments) {
  for (let position = assignments.length - 1; position >= 0; position -= 1) {
    if (assignments[position].status !== "pending") return position;
  }
  return -1;
}

/** Returns one pending suffix assignment or rejects a history edit. */
function mutableAssignment(assignments, immutableCount, assignmentId) {
  const id = cleanAssignmentId(assignmentId);
  const position = assignments.findIndex((assignment) => assignment.id === id);
  if (position < 0) throw new PipelineMutationError("assignment-not-found", `no assignment ${id || "(empty)"}`);
  if (position < immutableCount || assignments[position].status !== "pending") {
    throw new PipelineMutationError("assignment-history-immutable", `assignment ${id} has started and cannot change`);
  }
  return assignments[position];
}

/** Resolves an insertion anchor without allowing a write inside history. */
function insertionPosition(assignments, immutableCount, afterAssignmentId) {
  const after = cleanAssignmentId(afterAssignmentId);
  if (!after) return immutableCount;
  const position = assignments.findIndex((assignment) => assignment.id === after);
  if (position < 0) throw new PipelineMutationError("assignment-not-found", `no assignment ${after}`);
  if (position + 1 < immutableCount) {
    throw new PipelineMutationError("assignment-history-immutable", `cannot insert after historical assignment ${after}`);
  }
  return position + 1;
}

/** Chooses or creates a unique identity for one added assignment. */
function requestedAssignmentId(value, assignments) {
  const used = new Set(assignments.map((assignment) => assignment.id));
  const requested = cleanAssignmentId(value);
  if (requested && used.has(requested)) throw new PipelineMutationError("duplicate-assignment", `assignment ${requested} already exists`);
  return requested || `assignment-${randomUUID()}`;
}

/** Applies the fields that remain mutable before an assignment starts. */
function applyPendingPatch(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new PipelineMutationError("invalid-patch", "an assignment update needs one patch object");
  }
  if (typeof patch.instruction === "string") target.instruction = patch.instruction.trim();
  if (Object.hasOwn(patch, "path")) target.path = typeof patch.path === "string" && patch.path.trim() ? patch.path.trim() : null;
  if (Object.hasOwn(patch, "kind")) {
    target.kind = patch.kind === "review" ? "review" : "implementation";
  }
  if (Object.hasOwn(patch, "launch") && Object.hasOwn(patch, "command")) {
    throw new PipelineMutationError("ambiguous-launch", "an assignment cannot set a launch and command together");
  }
  if (Object.hasOwn(patch, "launch")) {
    if (!hasLaunch(patch)) throw new PipelineMutationError("invalid-launch", "an assignment launch needs a harness");
    target.launch = {
      harness: patch.launch.harness.trim(),
      model: typeof patch.launch.model === "string" && patch.launch.model ? patch.launch.model : null,
      effort: typeof patch.launch.effort === "string" && patch.launch.effort ? patch.launch.effort : null,
    };
    target.command = "";
    target.launchSource = "explicit";
  }
  if (Object.hasOwn(patch, "command")) {
    target.command = typeof patch.command === "string" ? patch.command.trim() : "";
    target.launch = null;
    target.launchSource = "explicit";
  }
  if (Object.hasOwn(patch, "continueFromAssignmentId")) {
    target.continueFromAssignmentId = cleanAssignmentId(patch.continueFromAssignmentId) || null;
  }
}

/** True when operations left the immutable prefix and mutable suffix intact. */
function pendingSuffixIsMutable(assignments, immutableCount) {
  return assignments.slice(0, immutableCount).every((assignment) => assignment.status !== "pending")
    && assignments.slice(immutableCount).every((assignment) => assignment.status === "pending");
}
