import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

export const BRAIN_PROMPT_LIMIT = 8_000;
export const BRAIN_CHECKPOINT_LIMIT = 6_000;
export const JOURNAL_LIMIT_BYTES = 256 * 1024;
export const GOAL_QUEUE_SCHEMA = "area-goal-queue.v2";
export const LEGACY_AUDIT_SCHEMA = "area-brain-legacy-audit.v1";
export const AREA_MILESTONES_SCHEMA = "area-milestones.v1";
const gzip = promisify(zlib.gzip);

/** Returns the stable content hash used in source and export manifests. */
const digest = (text) => createHash("sha256").update(text).digest("hex");
/** Normalizes an Area path without accepting empty path segments. */
const cleanArea = (area) => String(area ?? "").split("/").filter(Boolean).join("/");
const DEFAULT_MEMORY_BUDGETS = Object.freeze({
  exact: Object.freeze({ Purpose: 1_000, Current: 1_000, Knowledge: 1_600 }),
  ancestor: Object.freeze({ Purpose: 400, Knowledge: 600 }),
});

/** Returns Area paths from the root Area to the exact Area. */
export function areaLineage(area) {
  const parts = cleanArea(area).split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Finds repository instructions that apply from the root to the working folder. */
export async function inheritedInstructionFiles(repository, workingDirectory = repository) {
  if (!repository || !workingDirectory) return [];
  const root = path.resolve(repository);
  const leaf = path.resolve(workingDirectory);
  const relative = path.relative(root, leaf);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The working folder is outside the repository.");
  const folders = [root];
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    folders.push(cursor);
  }
  const files = [];
  for (const folder of folders) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(folder, name);
      if (!existsSync(file)) continue;
      const text = await readFile(file, "utf8");
      files.push({ file, hash: digest(text), bytes: Buffer.byteLength(text) });
    }
  }
  return files;
}

/** Builds a truthful prompt and rejects any section that exceeds the hard limit. */
export function boundedBrainPrompt(sections, limit = BRAIN_PROMPT_LIMIT) {
  const entries = Object.entries(sections).filter(([, value]) => String(value ?? "").trim());
  const text = entries.map(([name, value]) => `## ${name}\n\n${String(value).trim()}`).join("\n\n");
  if (text.length > limit) throw new Error(`The generated brain prompt is ${text.length} characters; the limit is ${limit}.`);
  return text;
}

/** Builds the separately bounded instruction and checkpoint activation part. */
export function brainActivationEnvelope(record, generation = Number(record?.generation) || 1) {
  const instruction = String(record?.foundingInstruction?.text ?? record?.instruction ?? "").trim();
  const checkpoint = String(record?.checkpoint?.text ?? "").trim();
  const boundedCheckpoint = checkpoint.slice(0, BRAIN_CHECKPOINT_LIMIT);
  const role = generation <= 1 ? "Current assignment" : "Standing authority";
  const omissions = checkpoint.length > boundedCheckpoint.length
    ? [`Checkpoint clipped by ${checkpoint.length - boundedCheckpoint.length} characters.`]
    : [];
  return {
    text: `# Activation material\n\n## ${role}\n\n${instruction}\n\n## Current checkpoint\n\n${boundedCheckpoint || "No checkpoint exists."}`,
    instruction: {
      source: "brain.json#foundingInstruction",
      characters: instruction.length,
      hash: digest(instruction),
    },
    checkpoint: {
      source: "brain.json#checkpoint",
      characters: boundedCheckpoint.length,
      hash: digest(boundedCheckpoint),
      omittedCharacters: checkpoint.length - boundedCheckpoint.length,
    },
    omissions,
  };
}

/** Reads one named Markdown section without including the next heading. */
function markdownSection(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = String(text ?? "");
  const heading = new RegExp(`^## ${escaped}\\s*$`, "m").exec(source);
  if (!heading) return "";
  const start = heading.index + heading[0].length;
  const remainder = source.slice(start).replace(/^\r?\n/, "");
  const next = /^## /m.exec(remainder);
  return (next ? remainder.slice(0, next.index) : remainder).trim();
}

/** Projects approved Area sections with deterministic per-section budgets. */
export function projectAreaMemory(sources, budgets = DEFAULT_MEMORY_BUDGETS) {
  const cleanSources = Array.isArray(sources) ? sources.filter((source) => source?.area && source?.file) : [];
  const exactArea = cleanSources.at(-1)?.area ?? "";
  const entries = [];
  const omissions = [];
  const exactSource = cleanSources.at(-1);
  const orderedSources = exactSource ? [exactSource, ...cleanSources.slice(0, -1).reverse()] : [];
  for (const source of orderedSources) {
    const exact = source.area === exactArea;
    const sectionBudgets = exact ? budgets.exact : budgets.ancestor;
    for (const [section, limit] of Object.entries(sectionBudgets)) {
      const original = markdownSection(source.text, section);
      if (!original) {
        omissions.push({ area: source.area, file: source.file, section, reason: "missing", omittedCharacters: 0 });
        continue;
      }
      const text = original.slice(0, limit);
      entries.push({ area: source.area, file: source.file, section, text, hash: digest(original), characters: text.length });
      if (text.length < original.length) omissions.push({ area: source.area, file: source.file, section, reason: "clipped", omittedCharacters: original.length - text.length });
    }
  }
  return {
    text: entries.map((entry) => `### ${entry.area} · ${entry.section}\n\n${entry.text}\n\nSource: ${entry.file} sha256:${entry.hash}`).join("\n\n"),
    entries,
    omissions,
  };
}

/** Selects explicit current Document references and never uses recency. */
export function selectCurrentDocuments({ goals = [], requests = [], sourceInstruction = [], resolve }) {
  const reasons = new Map();
  /** Adds one resolved Document with its strongest structural reason. */
  const add = (reference, reason, priority) => {
    const document = typeof resolve === "function" ? resolve(reference) : reference;
    if (!document?.file) return;
    const current = reasons.get(document.file) ?? { ...document, reasons: [], priority };
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    current.priority = Math.min(current.priority, priority);
    reasons.set(document.file, current);
  };
  for (const reference of sourceInstruction) add(reference, "current source instruction", 0);
  for (const goal of goals.filter((item) => !["done", "dropped"].includes(item.status))) {
    for (const reference of goal.documents ?? []) add(reference, `current assignment ${goal.file ?? goal.slug}`, 1);
  }
  for (const request of requests.filter((item) => item.status === "open")) {
    for (const reference of request.documents ?? []) add(reference, `open Question ${request.id}`, 2);
  }
  return [...reasons.values()]
    .sort((left, right) => left.priority - right.priority || left.file.localeCompare(right.file))
    .slice(0, 8)
    .map(({ priority, ...document }) => document);
}

/** Resolves the active Journal path for an Area. */
export function journalPath(treesRoot, area) {
  return path.join(treesRoot, cleanArea(area), "journal.md");
}

/** Saves exact capture text once, then returns its stable entry. */
export async function appendJournalEntry({ treesRoot, area, text, idempotencyKey, source = "capture", now = new Date().toISOString() }) {
  const clean = cleanArea(area);
  const value = String(text ?? "").trim();
  const key = String(idempotencyKey ?? "").trim();
  if (!clean || !value || !key) throw new Error("Area, text, and idempotency key are required.");
  const file = journalPath(treesRoot, clean);
  await mkdir(path.dirname(file), { recursive: true });
  let current = "";
  try { current = await readFile(file, "utf8"); } catch {}
  const marker = `<!-- tangent-journal:${key} -->`;
  if (current.includes(marker)) return { area: clean, file, id: key, duplicate: true };
  if (Buffer.byteLength(current) >= JOURNAL_LIMIT_BYTES) await archiveJournal(file, current, now);
  const heading = current ? "" : "# Journal\n\n";
  const entry = `${heading}${marker}\n## ${now}\n\nSource: ${source}.\n\n${value}\n\n`;
  await appendFile(file, entry, "utf8");
  return { area: clean, file, id: key, duplicate: false, text: value, createdAt: now };
}

/** Moves a full active Journal to a dated archive. */
async function archiveJournal(file, text, now) {
  const headings = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((match) => match[1]);
  const from = headings[0] ?? "unknown";
  const to = headings.at(-1) ?? now.slice(0, 10);
  let archive = path.join(path.dirname(file), `journal-${from}-${to}.md`);
  for (let index = 2; existsSync(archive); index += 1) archive = path.join(path.dirname(file), `journal-${from}-${to}-${index}.md`);
  await rename(file, archive);
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
    completionPolicy: options.completionPolicy ?? "review-pass",
    currentAssignmentId: null,
    idempotencyKeys: [],
    createdAt: now,
    updatedAt: now,
    assignments: assignments.map((item, index) => ({
      id: item.id || randomUUID(),
      order: index + 1,
      instruction: String(item.instruction ?? "").trim(),
      kind: item.kind || "implementation",
      designatedReview: item.designatedReview === true || item.kind === "review",
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
  const running = queue.assignments.find((item) => item.status === "running");
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
  if (queue.currentAssignmentId || queue.assignments?.some((assignment) => assignment.status === "running")) return "recovery needs a queue with no current attempt";
  if (!queue.assignments?.some((assignment) => assignment.status === "pending")) return "recovery needs an existing pending assignment";
  if (!brain || brain.status !== "active" || brain.health?.status !== "failed" || brain.recovery?.exhausted !== true) return "recovery is available only after the exact Area brain exhausts automatic recovery";
  return null;
}

/** Validates and stores one typed worker report without advancing the queue. */
export function submitWorkerReport(queue, assignmentId, report, { expectedRevision, idempotencyKey, now = new Date().toISOString() } = {}) {
  if (queue.revision !== expectedRevision) throw new Error(`stale-revision:${queue.revision}`);
  if (!idempotencyKey) throw new Error("An idempotency key is required.");
  const assignment = queue.assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw new Error("assignment-not-found");
  const duplicate = assignment.reports?.find((item) => item.idempotencyKey === idempotencyKey);
  if (duplicate) return { report: duplicate, duplicate: true, closeGoal: false };
  const type = String(report?.type ?? "");
  const allowed = assignment.designatedReview ? new Set(["review-result", "question-needed", "context-risk", "failed"]) : new Set(["implementation-result", "question-needed", "context-risk", "failed"]);
  if (!allowed.has(type)) throw new Error("report-type-not-allowed");
  if (type === "review-result" && !["passed", "changes-required", "blocked"].includes(report.verdict)) throw new Error("invalid-review-verdict");
  if (!String(report?.summary ?? "").trim()) throw new Error("report-summary-required");
  if (type === "implementation-result" && !["complete", "blocked", "failed"].includes(report.status)) throw new Error("invalid-implementation-status");
  if (type === "question-needed" && !String(report.question ?? "").trim()) throw new Error("report-question-required");
  const stored = { ...structuredClone(report), idempotencyKey, reportedAt: now };
  assignment.reports = [...(assignment.reports ?? []), stored];
  const attempt = assignment.attempts.at(-1);
  if (attempt) {
    attempt.result = stored;
    attempt.endedAt = now;
  }
  assignment.status = ["question-needed", "context-risk", "failed"].includes(type) || report.status === "blocked" || report.status === "failed" || report.verdict === "blocked" ? "waiting" : "complete";
  queue.currentAssignmentId = null;
  queue.idempotencyKeys = [...(queue.idempotencyKeys ?? []), idempotencyKey];
  queue.revision += 1;
  queue.updatedAt = now;
  const criteria = Array.isArray(report.criteria) ? report.criteria : [];
  const closeGoal = type === "review-result"
    && assignment.designatedReview
    && queue.completionPolicy === "review-pass"
    && report.verdict === "passed"
    && report.goalRevision === queue.goalRevision
    && criteria.length > 0
    && criteria.every((criterion) => criterion?.id && criterion.passed === true && Array.isArray(criterion.evidenceRefs) && criterion.evidenceRefs.length > 0);
  if (closeGoal) queue.status = "complete";
  return { report: stored, duplicate: false, closeGoal };
}

/** Projects legacy Program kinds into one Operation mode. */
export function operationFromProgram(program) {
  const mode = program.type === "process" ? "service" : program.type === "trigger" ? "scheduled" : "on-demand";
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

/** Lists archived and active Journal files in continuous order. */
export async function journalFiles(treesRoot, area) {
  const directory = path.dirname(journalPath(treesRoot, area));
  let names = [];
  try { names = await readdir(directory); } catch { return []; }
  return names.filter((name) => /^journal(?:-.*)?\.md$/.test(name)).sort((left, right) => left === "journal.md" ? 1 : right === "journal.md" ? -1 : left.localeCompare(right)).map((name) => path.join(directory, name));
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
  const item = { id: key, area: record.area, kind: String(kind || "note"), summary: String(summary).trim(), ref, createdAt: now };
  record.items.push(item);
  record.items = record.items.slice(-2_000);
  const file = milestonePath(root, area);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  return { ...item, duplicate: false };
}

/** Queries material milestones for an Area subtree in newest-first order. */
export async function querySubtreeMilestones({ root, area, areas, since = "", limit = 12 }) {
  const prefix = `${cleanArea(area)}/`;
  const scope = areas.filter((item) => item === cleanArea(area) || item.startsWith(prefix));
  const records = await Promise.all(scope.map((item) => readMilestones(root, item)));
  const all = records.flatMap((record) => record.items)
    .filter((item) => !since || item.createdAt > since)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const count = Math.max(1, Math.min(100, Number(limit) || 12));
  return { area: cleanArea(area), subtree: true, milestones: all.slice(0, count), omitted: Math.max(0, all.length - count) };
}
