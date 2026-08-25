import { rm } from "node:fs/promises";
import path from "node:path";
import { readJsonObject, walkJsonFiles, writeJsonObject } from "./json-store.mjs";

export const GOAL_CLEANUP_SCHEMA = "goal-cleanup.v1";

/** Gives one Goal a stable cleanup-record path without trusting its filename as a directory. */
export function goalCleanupPath(root, goalFile) {
  return path.join(root, `${Buffer.from(goalFile).toString("base64url")}.json`);
}

/** Reads one cleanup record, or null when no valid record exists. */
export async function readGoalCleanup(root, goalFile) {
  const record = await readJsonObject(goalCleanupPath(root, goalFile));
  return record?.schema === GOAL_CLEANUP_SCHEMA && record.goal === goalFile ? record : null;
}

/** Reads every valid cleanup record. */
export async function readAllGoalCleanups(root) {
  const records = [];
  for (const file of await walkJsonFiles(root)) {
    const record = await readJsonObject(file);
    if (record?.schema === GOAL_CLEANUP_SCHEMA && record.goal) records.push(record);
  }
  return records;
}

/** Starts or updates one durable cleanup attempt. */
export async function writeGoalCleanup(root, goalFile, fields = {}) {
  const prior = await readGoalCleanup(root, goalFile);
  const record = {
    schema: GOAL_CLEANUP_SCHEMA,
    goal: goalFile,
    targetStatus: fields.targetStatus ?? prior?.targetStatus ?? null,
    lastAttemptAt: new Date().toISOString(),
    retryCount: (prior?.retryCount ?? 0) + 1,
    removed: fields.removed ?? prior?.removed ?? [],
    failures: fields.failures ?? prior?.failures ?? [],
  };
  await writeJsonObject(goalCleanupPath(root, goalFile), record);
  return record;
}

/** Removes a successful cleanup record. */
export async function clearGoalCleanup(root, goalFile) {
  await rm(goalCleanupPath(root, goalFile), { force: true });
}
