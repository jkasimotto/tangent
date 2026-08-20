// Study session records: one JSON file per session under a study root,
// `${root}/${id}.json`. Pure module, no HTTP and no child processes. The
// server owns the tutor call and snippet grounding; this module owns the
// record shape and its transitions, so the rules stay unit-testable without
// a live shell. Design: impl-learning-ai-written-code Piece 2 on otto/tangent.
//
// The record is shell state, not vault knowledge, so it lives beside
// map-state, pipelines, and brains, outside the vault (design-area-map
// Decision 7). It persists so a later spacing Goal can schedule revisits
// (design-learning-ai-written-code Decision 6).

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const STUDY_SCHEMA_VERSION = 1;

const SLUG_MAX_CHARS = 40;

/** File path of one study record. */
export function studyPath(root, id) {
  return path.join(root, `${id}.json`);
}

/** The id slug of a subsystem: lowercase, non-alphanumerics to single hyphens, capped. */
function subsystemSlug(subsystem) {
  const slug = String(subsystem)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, "");
  return slug || "session";
}

/** One date part as two digits, so the id sorts and reads the same every time. */
function pad(value) {
  return String(value).padStart(2, "0");
}

/** The `yyyy-mm-dd-hhmmss` stamp of one instant, in local time, for a readable id. */
function idStamp(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * A fresh open study record, pending its first tutor turn. Throws on an empty
 * subsystem or an empty repo: the tutor needs both to run at all.
 */
export function newStudyRecord({ area = "", repo, subsystem, now = new Date().toISOString(), promptVersion = 1 }) {
  const named = String(subsystem ?? "").trim();
  if (!named) throw new Error("subsystem is empty");
  const directory = String(repo ?? "").trim();
  if (!directory) throw new Error("repo is empty");
  return {
    version: STUDY_SCHEMA_VERSION,
    id: `${idStamp(now)}-${subsystemSlug(named)}`,
    area: String(area ?? ""),
    repo: directory,
    subsystem: named,
    status: "open",
    mode: "calibration",
    promptVersion,
    startedAt: now,
    closedAt: null,
    claudeSessionId: null,
    pending: true,
    error: null,
    record: null,
    turns: []
  };
}

/** Appends Julian's answer turn and marks the record pending on the next tutor turn. */
export function applyAnswer(record, text, now = new Date().toISOString()) {
  return {
    ...record,
    pending: true,
    error: null,
    turns: [...record.turns, { role: "julian", at: now, text: String(text) }]
  };
}

/**
 * Appends one parsed tutor reply, with its snippets already grounded by the
 * server, and clears pending. A reply with done true closes the study and
 * stores the one-line record; the tutor's `say` is the fallback when it sent
 * no record line, so an End press always ends with something to read.
 */
export function applyTutorReply(record, reply, now = new Date().toISOString()) {
  const turn = {
    role: "tutor",
    at: now,
    say: reply.say ?? "",
    verdict: reply.verdict ?? null,
    reveal: reply.reveal ?? null,
    question: reply.question ?? null,
    mode: reply.mode,
    done: Boolean(reply.done)
  };
  const next = {
    ...record,
    mode: reply.mode ?? record.mode,
    pending: false,
    error: null,
    turns: [...record.turns, turn]
  };
  if (turn.done) {
    next.status = "closed";
    next.closedAt = now;
    next.record = reply.record || turn.say || "session ended";
  }
  return next;
}

/** Marks a failed tutor turn: pending off, the reason set for the screen to show. */
export function applyTutorFailure(record, message, now = new Date().toISOString()) {
  return { ...record, pending: false, error: String(message), erroredAt: now };
}

/** Closes a study that could not reach the tutor, so an End press always ends. */
export function closeStudy(record, line, now = new Date().toISOString()) {
  return { ...record, status: "closed", pending: false, closedAt: now, record: record.record || String(line) };
}

/** Writes one record with mkdir -p and an atomic tmp + rename. */
export async function writeStudy(root, record) {
  const target = studyPath(root, record.id);
  await mkdir(root, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return record;
}

/** Reads one record by id, or null when the file is missing or unparsable. */
export async function readStudy(root, id) {
  if (!id || id.includes("/") || id.includes("..")) return null;
  try {
    const record = JSON.parse(await readFile(studyPath(root, id), "utf8"));
    return record && record.version === STUDY_SCHEMA_VERSION ? record : null;
  } catch {
    return null;
  }
}

/** Every record under the root, newest startedAt first; empty when the root is missing. */
export async function readAllStudies(root) {
  let names = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await readStudy(root, name.slice(0, -".json".length));
    if (record) records.push(record);
  }
  return records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** The newest study of one Area, or of any Area when the path is empty; null when there is none. */
export function latestStudy(records, area) {
  return records.find((record) => !area || record.area === area) ?? null;
}
