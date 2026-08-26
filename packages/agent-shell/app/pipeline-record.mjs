// Pipeline record store: one JSON file per Goal under a pipelines root,
// `${root}/${area}/${slug}.json`. Pure module, no tmux, no HTTP. The server
// owns session spawning and status transitions; this module owns the record
// shape, its validation, and the derived questions (which step is current,
// what comes next, what the whole pipeline's status is), so the rules are
// unit-testable without a live shell.

import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";
import { GOAL_QUEUE_SCHEMA, submitWorkerReport } from "./area-brain-domain.mjs";

export const PIPELINE_SCHEMA = GOAL_QUEUE_SCHEMA;
const LEGACY_PIPELINE_SCHEMA = "agent-pipeline.v1";

const MAX_STEPS = 20;
const MAX_INSTRUCTION_CHARS = 2000;
const QUEUE_NORMALIZATION_CHANGED = Symbol("queueNormalizationChanged");

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
  return normalizeQueueRecord(await readJsonObject(pipelinePath(root, area, slug)));
}

/** Reads every pipeline record under the root; empty when the root is missing. */
export async function readAllPipelines(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = normalizeQueueRecord(await readJsonObject(file));
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
  record.schema = PIPELINE_SCHEMA;
  record.assignments = record.steps;
  record.updatedAt = new Date().toISOString();
  return writeJsonObject(target, record);
}

/** Normalizes the legacy pipeline into the one production Goal queue shape. */
export function normalizeQueueRecord(value) {
  if (!value || typeof value !== "object" || ![PIPELINE_SCHEMA, LEGACY_PIPELINE_SCHEMA].includes(value.schema)) return null;
  const source = Array.isArray(value.assignments) ? value.assignments : Array.isArray(value.steps) ? value.steps : [];
  const assignments = source.map((step, position) => normalizeStoredAssignment(step, position + 1));
  const revision = Math.max(1, Number(value.revision) || 1);
  const controllerArea = value.controllerArea ?? value.area;
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
  const migrationProblem = controllerArea !== value.area
    ? `Queue controller ${controllerArea} does not match exact Area ${value.area}.`
    : running.length > 1
      ? `Queue has ${running.length} current attempts.`
      : inheritedMigrationProblem;
  const activeAssignment = assignments.find((item) => ["running", "waiting"].includes(item.status));
  const storedCurrent = assignments.find((item) => item.id === value.currentAssignmentId && ["running", "waiting"].includes(item.status));
  const reopenSupersededPause = supersededLegacyWait && generatedMultipleAttemptProblem && value.status === "paused";
  const normalized = {
    ...value,
    schema: PIPELINE_SCHEMA,
    controllerArea,
    goalRevision: String(value.goalRevision ?? ""),
    revision,
    status: migrationProblem ? "paused" : reopenSupersededPause ? "open" : ["open", "complete", "paused", "canceled"].includes(value.status) ? value.status : "open",
    migrationProblem,
    completionPolicy: value.completionPolicy ?? "review-pass",
    currentAssignmentId: storedCurrent?.id ?? activeAssignment?.id ?? null,
    idempotencyKeys: Array.isArray(value.idempotencyKeys) ? value.idempotencyKeys : [],
    assignments,
    steps: assignments,
  };
  const storedAssignments = Array.isArray(value.assignments) ? value.assignments : Array.isArray(value.steps) ? value.steps : [];
  const normalizationChanged = value.schema !== normalized.schema
    || value.controllerArea !== normalized.controllerArea
    || String(value.goalRevision ?? "") !== normalized.goalRevision
    || Math.max(1, Number(value.revision) || 1) !== normalized.revision
    || value.status !== normalized.status
    || (value.migrationProblem ?? null) !== normalized.migrationProblem
    || (value.currentAssignmentId ?? null) !== normalized.currentAssignmentId
    || (value.completionPolicy ?? null) !== normalized.completionPolicy
    || !Array.isArray(value.idempotencyKeys)
    || !Array.isArray(value.assignments)
    || !Array.isArray(value.steps)
    || JSON.stringify(storedAssignments) !== JSON.stringify(assignments);
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
export function newPipeline({ goal, goalRevision = "", area, slug, extraFiles = [], steps, completionPolicy = "review-pass", now = new Date().toISOString() }) {
  const error = validateSteps(steps);
  if (error) throw new Error(error);
  const assignments = steps.map((step, position) => normalizeStep(step, position + 1));
  return {
    schema: PIPELINE_SCHEMA,
    goal,
    goalRevision,
    area,
    controllerArea: area,
    slug,
    revision: 1,
    status: "open",
    migrationProblem: null,
    completionPolicy,
    currentAssignmentId: null,
    idempotencyKeys: [],
    createdAt: now,
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
  const added = steps.map((step, position) => normalizeStep(step, existing.length + position + 1));
  record.steps = [...existing, ...added];
  record.assignments = record.steps;
  if (record.status !== "paused") record.status = "open";
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
    record.status = "canceled";
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
  }
  return null;
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

/** Normalizes one validated step into its stored pending shape. */
function normalizeStep(step, index) {
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
    continueFrom: Number.isInteger(step.continueFrom) ? step.continueFrom : null,
    kind: step.kind === "review" ? "review" : "implementation",
    designatedReview: step.kind === "review" || step.designatedReview === true,
    status: "pending",
    session: null,
    startedAt: null,
    endedAt: null,
    handover: null,
    handoverSource: null,
    attempts: [],
    reports: [],
  };
}

/** Adds queue fields to one stored assignment without changing its history. */
function normalizeStoredAssignment(step, index) {
  return {
    ...step,
    id: step.id || `assignment-${index}`,
    index,
    kind: step.kind === "review" ? "review" : "implementation",
    designatedReview: step.designatedReview === true || step.kind === "review",
    attempts: Array.isArray(step.attempts) ? step.attempts : [],
    reports: Array.isArray(step.reports) ? step.reports : [],
  };
}
