// Brain record store: one JSON file per Area under a brains root,
// `${root}/${area}/brain.json`. Pure module, no tmux, no HTTP. The server
// owns session spawning and status transitions; this module owns the record
// shape, its validation, and the derived questions (which generation runs,
// which brain covers an Area, what the latest handover says), so the rules
// are unit-testable without a live shell. Design: the vault Document
// impl-area-brain.md on otto/tangent.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const BRAIN_SCHEMA = "area-brain.v1";

const MAX_INSTRUCTION_CHARS = 4000;
const SESSION_NAME_MAX = 60;

/** File path of one brain record. */
export function brainPath(root, area) {
  return path.join(root, area, "brain.json");
}

/** Reads one brain record, or null when the file is missing or unparsable. */
export async function readBrain(root, area) {
  return readRecordFile(brainPath(root, area));
}

/** Reads every brain record under the root; empty when the root is missing. */
export async function readAllBrains(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = await readRecordFile(file);
    if (record && record.schema === BRAIN_SCHEMA) records.push(record);
  }
  return records;
}

/** Writes a record with mkdir -p and an atomic tmp + rename; stamps updatedAt. */
export async function writeBrain(root, record) {
  const target = brainPath(root, record.area);
  record.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return record;
}

/** Deletes one brain record; a missing file is not an error. */
export async function deleteBrain(root, area) {
  await rm(brainPath(root, area), { force: true });
}

/** Returns an error string for an unusable instruction, else null. */
export function validateInstruction(text) {
  const value = String(text ?? "").trim();
  if (!value) return "instruction is empty";
  if (value.length > MAX_INSTRUCTION_CHARS) return `instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`;
  return null;
}

/**
 * Builds a fresh record with no generation yet. The server calls
 * beginGeneration when it spawns the first session. Throws on an invalid
 * instruction.
 */
export function newBrain({ area, instruction, launch = null, command, label = "", planFile, now = new Date().toISOString() }) {
  const error = validateInstruction(instruction);
  if (error) throw new Error(error);
  if (!command || typeof command !== "string") throw new Error("command is required");
  return {
    schema: BRAIN_SCHEMA,
    area,
    instruction: String(instruction).trim(),
    launch: launch && typeof launch === "object" && launch.harness
      ? { harness: String(launch.harness), model: launch.model ?? null, effort: launch.effort ?? null }
      : null,
    command,
    label: label || (launch ? "" : "Edited command"),
    planFile,
    status: "running",
    generation: 0,
    session: null,
    createdAt: now,
    updatedAt: now,
    generations: []
  };
}

/** The current (last) generation entry, or null before the first spawn. */
export function currentGeneration(record) {
  const list = record?.generations ?? [];
  return list.length ? list[list.length - 1] : null;
}

/**
 * Starts generation N+1 on the given session: appends the entry, points the
 * record at it, and sets status running. Returns the new entry.
 */
export function beginGeneration(record, session, now = new Date().toISOString()) {
  const generation = (record.generations?.length ?? 0) + 1;
  const entry = { generation, session, startedAt: now, endedAt: null, handover: null, remindedAt: null };
  record.generations = [...(record.generations ?? []), entry];
  record.generation = generation;
  record.session = session;
  record.status = "running";
  return entry;
}

/** Records the current generation's self-handover text and end time. */
export function recordHandover(record, text, now = new Date().toISOString()) {
  const entry = currentGeneration(record);
  if (!entry) throw new Error("no generation to hand over from");
  entry.handover = entry.handover ? `${entry.handover}\n\n${text}` : String(text);
  entry.endedAt = now;
  return entry;
}

/** Ends the brain: "ended" on Julian's stop, "stopped" when its session died. */
export function endBrain(record, status, now = new Date().toISOString()) {
  if (!["ended", "stopped"].includes(status)) throw new Error(`unknown brain end status "${status}"`);
  record.status = status;
  const entry = currentGeneration(record);
  if (entry && !entry.endedAt) entry.endedAt = now;
  return record;
}

/** The tmux session name for one generation of an Area's brain. */
export function brainSessionName(area, generation) {
  const leaf = String(area).split("/").filter(Boolean).pop() ?? "area";
  const base = generation > 1 ? `${leaf}--brain--g${generation}` : `${leaf}--brain`;
  return normName(base).slice(0, SESSION_NAME_MAX);
}

/**
 * The running brain that covers an Area: the record on the Area itself or
 * on its nearest ancestor. Ended and stopped brains do not cover anything.
 */
export function brainForArea(records, area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("/");
    const record = records.find((item) => item.area === candidate && item.status === "running");
    if (record) return record;
  }
  return null;
}

/**
 * The nearest brain record for an Area, whatever its status: the record on
 * the Area itself or on its closest ancestor. A stopped or ended brain still
 * owns its Area, so notices for it are kept until a generation reads them.
 */
export function brainRecordForArea(records, area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("/");
    const record = records.find((item) => item.area === candidate);
    if (record) return record;
  }
  return null;
}

/** The text of the latest non-null handover, or null. */
export function latestHandover(record) {
  const list = [...(record?.generations ?? [])].reverse();
  const entry = list.find((item) => item.handover);
  return entry ? entry.handover : null;
}

/** Lowercases and dashes a name the way tmux session names are built. */
function normName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Reads one JSON file, or null when missing or unparsable. */
async function readRecordFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Lists every brain.json under a directory, sorted for stable output. */
async function walkJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(full));
    else if (entry.isFile() && entry.name === "brain.json") files.push(full);
  }
  return files;
}
