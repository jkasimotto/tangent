// Continuation record store for solo Goal sessions: one JSON file per Goal
// under a continuations root, `${root}/${area}/${slug}.json`. Pure module, no
// tmux, no HTTP, mirroring pipeline-record.mjs. A pipeline step keeps its own
// continuations and contextReminders inline on the step
// (design-worker-context-handover D6); a solo Goal session has no such
// record, so this is the small store for that half of the same mechanism.

import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";

export const CONTINUATION_SCHEMA = "goal-continuation.v1";

/** File path of one continuation record. */
export function continuationPath(root, area, slug) {
  return path.join(root, area, `${slug}.json`);
}

/** Reads one continuation record, or null when the file is missing or unparsable. */
export async function readContinuation(root, area, slug) {
  return readJsonObject(continuationPath(root, area, slug));
}

/** Reads every continuation record under the root; empty when the root is missing. */
export async function readAllContinuations(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = await readJsonObject(file);
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
  return writeJsonObject(target, record);
}

/**
 * Builds a fresh record with no continuations yet. command and label are the
 * launch the session runs; a fresh copy continues on that exact launch rather
 * than on whatever the Area declares at the time of the handover.
 */
export function newContinuationRecord({ goal, area, slug, session, command = "", label = "", now = new Date().toISOString() }) {
  return {
    schema: CONTINUATION_SCHEMA,
    goal,
    area,
    slug,
    session,
    command,
    label,
    createdAt: now,
    updatedAt: now,
    continuations: [],
    contextReminders: {}
  };
}
