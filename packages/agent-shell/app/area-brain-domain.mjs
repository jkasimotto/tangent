import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

export const BRAIN_PROMPT_LIMIT = 8_000;
export const JOURNAL_LIMIT_BYTES = 256 * 1024;
export const GOAL_QUEUE_SCHEMA = "area-goal-queue.v2";
export const LEGACY_AUDIT_SCHEMA = "area-brain-legacy-audit.v1";
export const AREA_MILESTONES_SCHEMA = "area-milestones.v1";
const gzip = promisify(zlib.gzip);

/** Returns the stable content hash used in source and export manifests. */
const digest = (text) => createHash("sha256").update(text).digest("hex");
/** Normalizes an Area path without accepting empty path segments. */
const cleanArea = (area) => String(area ?? "").split("/").filter(Boolean).join("/");

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
export function newGoalQueue(goal, assignments, now = new Date().toISOString()) {
  if (!goal || !Array.isArray(assignments) || !assignments.length) throw new Error("A Goal queue needs one or more assignments.");
  return {
    schema: GOAL_QUEUE_SCHEMA, goal, revision: 1, status: "open", createdAt: now,
    assignments: assignments.map((item, index) => ({ id: item.id || randomUUID(), order: index + 1, instruction: String(item.instruction ?? "").trim(), kind: item.kind || "work", status: "pending", attempts: [] })),
  };
}

/** Starts only the next pending assignment and makes duplicate starts harmless. */
export function startNextAssignment(queue, operationId, now = new Date().toISOString()) {
  if (queue.status !== "open") throw new Error("The Goal queue is not open.");
  const running = queue.assignments.find((item) => item.status === "running");
  if (running) return { assignment: running, duplicate: true };
  const next = queue.assignments.find((item) => item.status === "pending");
  if (!next) return { assignment: null, complete: true };
  next.status = "running";
  next.attempts.push({ operationId, startedAt: now, endedAt: null, result: null });
  return { assignment: next, duplicate: false };
}

/** Projects legacy Program kinds into one Operation mode. */
export function operationFromProgram(program) {
  const mode = program.type === "process" ? "service" : program.type === "trigger" ? "scheduled" : "on-demand";
  const state = program.error || program.runtime?.error ? "problem" : program.session && !["shell", "stopped"].includes(program.session.state) ? "running" : "quiet";
  return { ...program, mode, state, problem: state === "problem" ? String(program.error || program.runtime?.error) : null };
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
