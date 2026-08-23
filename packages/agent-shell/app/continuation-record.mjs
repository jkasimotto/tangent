// Continuation record store for solo Goal sessions: one JSON file per Goal
// under a continuations root, `${root}/${area}/${slug}.json`. Pure module, no
// tmux, no HTTP, mirroring pipeline-record.mjs. A pipeline step keeps its own
// continuations and contextReminders inline on the step
// (design-worker-context-handover D6); a solo Goal session has no such
// record, so this is the small store for that half of the same mechanism.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONTINUATION_SCHEMA = "goal-continuation.v1";

/** File path of one continuation record. */
export function continuationPath(root, area, slug) {
  return path.join(root, area, `${slug}.json`);
}

/** Reads one continuation record, or null when the file is missing or unparsable. */
export async function readContinuation(root, area, slug) {
  return readRecordFile(continuationPath(root, area, slug));
}

/** Reads every continuation record under the root; empty when the root is missing. */
export async function readAllContinuations(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = await readRecordFile(file);
    if (record && record.schema === CONTINUATION_SCHEMA) records.push(record);
  }
  return records;
}

/**
 * Writes a record to its path with mkdir -p and an atomic tmp + rename, and
 * stamps updatedAt. Returns the record.
 */
export async function writeContinuation(root, record) {
  const target = continuationPath(root, record.area, record.slug);
  record.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return record;
}

/** Builds a fresh record with no continuations yet. */
export function newContinuationRecord({ goal, area, slug, session, now = new Date().toISOString() }) {
  return {
    schema: CONTINUATION_SCHEMA,
    goal,
    area,
    slug,
    session,
    createdAt: now,
    updatedAt: now,
    continuations: [],
    contextReminders: {}
  };
}

/** Parses one record file, or null when it is missing or not valid JSON. */
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

/** Lists every .json file under a directory, sorted; empty when it is missing. */
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
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}
