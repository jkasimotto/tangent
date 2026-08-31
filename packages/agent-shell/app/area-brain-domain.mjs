import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { queryTerms, recencyBound } from "./goal-query-filters.mjs";
import { isRootArea } from "./area-identity.mjs";
import { promisify } from "node:util";

export const MILESTONE_SUMMARY_LIMIT = 240;
export const GOAL_QUEUE_SCHEMA = "area-goal-queue.v2";
export const LEGACY_AUDIT_SCHEMA = "area-brain-legacy-audit.v1";
export const AREA_MILESTONES_SCHEMA = "area-milestones.v1";
const gzip = promisify(zlib.gzip);

/** Returns the stable content hash used in source and export manifests. */
const digest = (text) => createHash("sha256").update(text).digest("hex");
/** Normalizes an Area path without accepting empty path segments. */
const cleanArea = (area) => String(area ?? "").split("/").filter(Boolean).join("/");

/**
 * Clips one stored line to a hard length and says where the rest is. A
 * milestone summary is written by a human or a model and carries no length
 * of its own, so the index keeps one bounded line per milestone.
 */
export function clipSummary(text, limit = MILESTONE_SUMMARY_LIMIT) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}
/** Creates an ordered queue with immutable assignment identities. */
export function newGoalQueue(goal, assignments, now = new Date().toISOString(), options = {}) {
  const identity = typeof goal === "object" ? goal : { file: goal, revision: options.goalRevision, area: options.controllerArea };
  if (!identity?.file || !Array.isArray(assignments) || !assignments.length) throw new Error("A Goal queue needs one or more assignments.");
  return {
    schema: GOAL_QUEUE_SCHEMA,
    goal: identity.file,
    goalRevision: String(identity.revision ?? options.goalRevision ?? ""),
    controllerArea: cleanArea(identity.area ?? options.controllerArea),
    revision: 1,
    status: "open",
    currentAssignmentId: null,
    idempotencyKeys: [],
    createdAt: now,
    updatedAt: now,
    assignments: assignments.map((item, index) => ({
      id: item.id || randomUUID(),
      order: index + 1,
      instruction: String(item.instruction ?? "").trim(),
      kind: item.kind || "implementation",
      status: "pending",
      attempts: [],
      reports: [],
    })),
  };
}

/** Starts only the next pending assignment and makes duplicate starts harmless. */
export function startNextAssignment(queue, operationId, now = new Date().toISOString()) {
  if (queue.status !== "open") throw new Error("The Goal queue is not open.");
  if (!String(operationId ?? "").trim()) throw new Error("An idempotency key is required.");
  const repeated = queue.idempotencyKeys?.includes(operationId);
  const running = queue.assignments.find((item) => ["running", "waiting"].includes(item.status));
  if (repeated) return { assignment: running ?? null, duplicate: true };
  if (running) return { assignment: running, duplicate: true };
  const next = queue.assignments.find((item) => item.status === "pending");
  if (!next) return { assignment: null, complete: true };
  next.status = "running";
  next.attempts.push({ id: randomUUID(), operationId, kind: "managed", startedAt: now, endedAt: null, result: null });
  queue.currentAssignmentId = next.id;
  queue.idempotencyKeys = [...(queue.idempotencyKeys ?? []), operationId];
  queue.revision += 1;
  queue.updatedAt = now;
  return { assignment: next, duplicate: false };
}

/** Returns why Julian's emergency start is unavailable, or null when it is safe. */
export function emergencyStartProblem(queue, brain) {
  if (!queue || queue.status !== "open") return "recovery needs an existing open authoritative queue";
  if (queue.currentAssignmentId || queue.assignments?.some((assignment) => ["running", "waiting"].includes(assignment.status))) return "recovery needs a queue with no current attempt";
  if (!queue.assignments?.some((assignment) => assignment.status === "pending")) return "recovery needs an existing pending assignment";
  if (!brain || brain.status !== "active" || brain.health?.status !== "failed" || brain.recovery?.exhausted !== true) return "recovery is available only after the exact Area brain exhausts automatic recovery";
  return null;
}

/**
 * Validates and stores one typed worker report without advancing the queue.
 * No report closes a Goal: the brain reads the note and runs
 * `tangent goal done` itself (ADR-0041).
 */
export function submitWorkerReport(queue, assignmentId, report, { expectedRevision, idempotencyKey, now = new Date().toISOString() } = {}) {
  if (!idempotencyKey) throw new Error("An idempotency key is required.");
  const assignment = queue.assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw new Error("assignment-not-found");
  const duplicate = assignment.reports?.find((item) => item.idempotencyKey === idempotencyKey);
  if (duplicate) return { report: duplicate, duplicate: true };
  if (queue.revision !== expectedRevision) throw new Error(`stale-revision:${queue.revision}`);
  const type = String(report?.type ?? "");
  const allowed = new Set(["implementation-result", "review-result", "context-risk", "failed"]);
  if (!allowed.has(type)) throw new Error("report-type-not-allowed");
  if (type === "review-result" && !["passed", "changes-required", "blocked"].includes(report.verdict)) throw new Error("invalid-review-verdict");
  if (!String(report?.summary ?? "").trim()) throw new Error("report-summary-required");
  if (type === "implementation-result" && !["done", "complete", "blocked", "failed"].includes(report.status)) throw new Error("invalid-implementation-status");
  const criteria = Array.isArray(report.criteria) ? report.criteria : [];
  if (type === "review-result") {
    if (!String(report.goalRevision ?? "").trim()) throw new Error("review-goal-revision-required");
    if (!criteria.length) throw new Error("review-criteria-required");
    if (criteria.some((criterion) => !String(criterion?.id ?? "").trim()
      || typeof criterion.passed !== "boolean"
      || !Array.isArray(criterion.evidenceRefs)
      || criterion.evidenceRefs.length === 0)) {
      throw new Error("invalid-review-criterion");
    }
  }
  const stored = { ...structuredClone(report), idempotencyKey, reportedAt: now };
  assignment.reports = [...(assignment.reports ?? []), stored];
  const attempt = assignment.attempts.at(-1);
  if (attempt) {
    attempt.result = stored;
    attempt.report = stored;
    attempt.endedAt = now;
  }
  assignment.status = ["context-risk", "failed"].includes(type) || report.status === "blocked" || report.status === "failed" || report.verdict === "blocked" ? "waiting" : "complete";
  queue.currentAssignmentId = null;
  queue.idempotencyKeys = [...(queue.idempotencyKeys ?? []), idempotencyKey];
  queue.revision += 1;
  queue.updatedAt = now;
  if (assignment.status === "complete" && !queue.assignments.some((item) => ["pending", "running"].includes(item.status))) queue.status = "complete";
  return { report: stored, duplicate: false };
}

/** Projects Program kinds into one Operation mode: a stored kind `process` is a service. */
export function operationFromProgram(program) {
  const mode = program.type === "process" ? "service" : "on-demand";
  const attention = program.runtime?.lastOutcome?.status === "attention" && program.runtime?.acknowledgedKey !== program.runtime.lastOutcome.key
    ? program.runtime.lastOutcome.message
    : null;
  const problem = program.error || program.runtime?.error || attention;
  const state = problem ? "problem" : program.session && !["shell", "stopped"].includes(program.session.state) ? "running" : "quiet";
  const outcome = program.runtime?.lastOutcome;
  const reportableResult = program.report === true && outcome?.status === "work"
    ? { key: outcome.key, revision: outcome.revision ?? outcome.key, summary: outcome.context || `${program.label ?? program.name} reported work ${outcome.key}.`, evidenceRef: program.id }
    : null;
  return { ...program, mode, state, problem: problem ? String(problem) : null, reportableResult };
}

/** Writes detached legacy records as one compressed audit file with a manifest. */
export async function exportLegacyAudit({ output, area, records, now = new Date().toISOString() }) {
  const sources = Object.entries(records).map(([name, value]) => ({ name, hash: digest(JSON.stringify(value)), records: Array.isArray(value) ? value.length : value ? 1 : 0 }));
  const payload = { schema: LEGACY_AUDIT_SCHEMA, area: cleanArea(area), exportedAt: now, sources, records };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, await gzip(`${JSON.stringify(payload)}\n`));
  return { output, manifest: payload.sources };
}

/** Returns the durable milestone index path for one Area. */
export function milestonePath(root, area) {
  return path.join(root, cleanArea(area), "milestones.json");
}

/** Reads one Area milestone index and tolerates an index that does not exist. */
export async function readMilestones(root, area) {
  try {
    const record = JSON.parse(await readFile(milestonePath(root, area), "utf8"));
    if (record?.schema === AREA_MILESTONES_SCHEMA && Array.isArray(record.items)) return record;
  } catch {}
  return { schema: AREA_MILESTONES_SCHEMA, area: cleanArea(area), items: [] };
}

/** Adds one material milestone once and writes the index atomically. */
export async function appendMilestone({ root, area, kind, summary, ref = null, idempotencyKey, now = new Date().toISOString() }) {
  const record = await readMilestones(root, area);
  const key = String(idempotencyKey ?? "").trim();
  if (!record.area || !key || !String(summary ?? "").trim()) throw new Error("Area, summary, and idempotency key are required.");
  const duplicate = record.items.find((item) => item.id === key);
  if (duplicate) return { ...duplicate, duplicate: true };
  const item = { id: key, area: record.area, kind: String(kind || "note"), summary: clipSummary(summary), ref, createdAt: now };
  record.items.push(item);
  record.items = record.items.slice(-2_000);
  const file = milestonePath(root, area);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  return { ...item, duplicate: false };
}

/**
 * Queries material milestones for an Area subtree in newest-first order.
 *
 * `since` reads a relative window (`30d`, `12h`) as well as an absolute time,
 * and `query` keeps the milestones whose summary or reference holds any of its
 * words. Those two are what let a brain ask "what happened about 24x lately"
 * in one command instead of reading the whole index.
 */
export async function querySubtreeMilestones({ root, area, areas, since = "", query = "", limit = 12, now = Date.now() }) {
  const prefix = `${cleanArea(area)}/`;
  const scope = isRootArea(area) ? areas : areas.filter((item) => item === cleanArea(area) || item.startsWith(prefix));
  const records = await Promise.all(scope.map((item) => readMilestones(root, item)));
  const bound = recencyBound(since, now);
  const after = bound === null ? "" : new Date(bound).toISOString();
  const terms = queryTerms(query);
  /** True when one milestone's summary or reference holds any query word. */
  const matches = (item) => !terms.length
    || terms.some((term) => `${item.summary ?? ""} ${item.ref ?? ""} ${item.kind ?? ""}`.toLowerCase().includes(term));
  const all = records.flatMap((record) => record.items)
    .filter((item) => (!after || item.createdAt > after) && matches(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const count = Math.max(1, Math.min(100, Number(limit) || 12));
  return { area: cleanArea(area), subtree: true, milestones: all.slice(0, count), omitted: Math.max(0, all.length - count) };
}
