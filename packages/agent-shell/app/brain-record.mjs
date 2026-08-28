// Brain record store: one JSON file per Area under a brains root,
// `${root}/${area}/brain.json`. Pure module, no tmux, no HTTP. The server
// owns session spawning and status transitions; this module owns the record
// shape, its validation, and the derived questions (which generation runs,
// which brain covers an Area), so the rules are unit-testable without a live
// shell.
//
// A brain runs until Julian restarts it (ADR-0041). Old records still carry
// `checkpoint`, `handover` text on generations, and `waitingStreak` from the
// retired handover and pacing machinery; they stay readable and nothing
// writes them.
//
// The server adds one optional field of its own, `forJulianNoticeHash`: the
// hash of the plan's `## For Julian` section at the last sweep, so a brain
// hears about the lines Tangent hides once per plan change and never again
// (impl-the-for-you-row-shows-only-direct-asks). `newBrain` does not set it.

import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";
import { boundedSessionName } from "./session-names.mjs";

export const BRAIN_SCHEMA = "area-brain.v3";
const LEGACY_BRAIN_SCHEMAS = new Set(["area-brain.v1", "area-brain.v2"]);

const MAX_INSTRUCTION_CHARS = 4000;
const SESSION_NAME_MAX = 60;

/** File path of one brain record. */
export function brainPath(root, area) {
  return path.join(root, area, "brain.json");
}

/** Reads one brain record, or null when the file is missing or unparsable. */
export async function readBrain(root, area) {
  return normalizeBrainRecord(await readJsonObject(brainPath(root, area)), area);
}

/** Reads every brain record under the root; empty when the root is missing. */
export async function readAllBrains(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = normalizeBrainRecord(await readJsonObject(file));
    if (record) records.push(record);
  }
  return records;
}

/** Writes a record with mkdir -p and an atomic tmp + rename; stamps updatedAt. */
export async function writeBrain(root, record) {
  const target = brainPath(root, record.area);
  record.schema = BRAIN_SCHEMA;
  record.updatedAt = new Date().toISOString();
  return writeJsonObject(target, record);
}

/** Converts the v1 runtime lifecycle into the v2 logical lifecycle. */
export function normalizeBrainRecord(value, area = "") {
  if (!value || typeof value !== "object" || (value.schema !== BRAIN_SCHEMA && !LEGACY_BRAIN_SCHEMAS.has(value.schema))) return null;
  const createdAt = value.createdAt ?? value.updatedAt ?? new Date(0).toISOString();
  const legacyResolvedLaunch = value.launch?.harness || value.command ? {
    ref: value.launch?.harness ? {
      harness: String(value.launch.harness), model: value.launch.model ?? null, effort: value.launch.effort ?? null,
    } : null,
    label: String(value.label ?? value.command ?? ""),
    command: String(value.command ?? ""),
    sourceArea: null,
    mode: "legacy",
  } : null;
  const currentAttemptId = value.currentAttemptId ?? value.session ?? null;
  const currentResolvedLaunch = value.resolvedLaunch ?? legacyResolvedLaunch;
  const generations = (Array.isArray(value.generations) ? value.generations : []).map((entry) => (
    !entry?.resolvedLaunch && currentResolvedLaunch && entry?.session === currentAttemptId
      ? { ...entry, resolvedLaunch: currentResolvedLaunch }
      : entry
  ));
  const latest = [...generations].reverse().find((entry) => entry?.handover);
  const legacyActive = value.status === "running";
  const status = ["active", "inactive"].includes(value.status)
    ? value.status
    : legacyActive ? "active" : "inactive";
  const foundingText = String(value.foundingInstruction?.text ?? value.instruction ?? "").trim();
  const checkpointText = String(value.checkpoint?.text ?? latest?.handover ?? "").trim();
  const { launch: _launch, command: _command, label: _label, resolvedLaunch: _resolvedLaunch, ...rest } = value;
  return {
    ...rest,
    schema: BRAIN_SCHEMA,
    area: String(value.area ?? area),
    status,
    foundingInstruction: {
      text: foundingText,
      createdAt: value.foundingInstruction?.createdAt ?? createdAt,
    },
    checkpoint: checkpointText ? {
      text: checkpointText,
      createdAt: value.checkpoint?.createdAt ?? latest?.endedAt ?? value.updatedAt ?? createdAt,
      sourceAttemptId: value.checkpoint?.sourceAttemptId ?? latest?.session ?? null,
    } : null,
    currentAttemptId,
    generations,
  };
}

/** Deletes one brain record; a missing file is not an error. */
export async function deleteBrain(root, area) {
  await rm(brainPath(root, area), { force: true });
}

/**
 * Returns an error string for an unusable instruction, else null. An empty
 * instruction is fine: a brain reads its Area note and AGENTS.md chain, and
 * Julian messages it when he has something to say (2026-08-28).
 */
export function validateInstruction(text) {
  const value = String(text ?? "").trim();
  if (value.length > MAX_INSTRUCTION_CHARS) return `instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`;
  return null;
}

/**
 * Builds a fresh record with no generation yet. The server calls
 * beginGeneration when it spawns the first session. Throws on an invalid
 * instruction.
 */
export function newBrain({ area, instruction, planFile, now = new Date().toISOString() }) {
  const error = validateInstruction(instruction);
  if (error) throw new Error(error);
  return {
    schema: BRAIN_SCHEMA,
    area,
    foundingInstruction: { text: String(instruction).trim(), createdAt: now },
    checkpoint: null,
    planFile,
    status: "active",
    currentAttemptId: null,
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
  if (!list.length) return null;
  // A failed handover keeps its replacement attempt as diagnostics while the
  // logical brain points back at the prior generation. Honour that durable
  // pointer before falling back to the append-only tail used by old records.
  return list.findLast?.((entry) => (
    entry?.generation === record?.generation
    && entry?.session === (record?.currentAttemptId ?? record?.session)
  )) ?? list[list.length - 1];
}

/**
 * Starts generation N+1 on the given session: appends the entry, points the
 * record at it, and keeps the logical brain active. Returns the new entry.
 */
export function beginGeneration(record, session, resolvedLaunch, now = new Date().toISOString()) {
  const generation = (record.generations?.length ?? 0) + 1;
  if (!resolvedLaunch?.ref?.harness || !resolvedLaunch.command) throw new Error("resolved brain launch is required");
  const launchSnapshot = { ...resolvedLaunch, ref: { ...resolvedLaunch.ref } };
  const entry = { generation, session, resolvedLaunch: launchSnapshot, startedAt: now, endedAt: null, handover: null };
  record.generations = [...(record.generations ?? []), entry];
  record.generation = generation;
  record.session = session;
  record.currentAttemptId = session;
  record.status = "active";
  return entry;
}

/** Makes the logical brain inactive after an explicit stop. */
export function endBrain(record, status = "inactive", now = new Date().toISOString()) {
  if (!["inactive", "ended", "stopped"].includes(status)) throw new Error(`unknown brain end status "${status}"`);
  record.status = "inactive";
  const entry = currentGeneration(record);
  if (entry && !entry.endedAt) entry.endedAt = now;
  return record;
}

/** The tmux session name for one generation of an Area's brain. */
export function brainSessionName(area, generation) {
  const leaf = String(area).split("/").filter(Boolean).pop() ?? "area";
  const base = normName(leaf) || "area";
  const suffix = generation > 1 ? `-brain-g${generation}` : "-brain";
  return boundedSessionName(base, suffix, SESSION_NAME_MAX);
}

/**
 * The active brain for one exact Area. Ancestors never gain mutation rights.
 */
export function brainForArea(records, area) {
  return records.find((item) => item.area === String(area ?? "") && item.status === "active") ?? null;
}

/** True when this brain owns the exact Area. */
export function brainOwnsArea(records, brainArea, area) {
  return brainArea === area && brainForArea(records, area)?.area === brainArea;
}

/**
 * The brain record for one exact Area, whatever its status.
 */
export function brainRecordForArea(records, area) {
  return records.find((item) => item.area === String(area ?? "")) ?? null;
}

/** The text of the latest handover an old record carries, or null. */
export function latestHandover(record) {
  const list = [...(record?.generations ?? [])].reverse();
  const entry = list.find((item) => item.handover);
  return entry ? entry.handover : null;
}

/** Lowercases and dashes a name the way tmux session names are built. */
function normName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
