import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

/**
 * One declared unit of work, captured when an agent is opened from Tangent Trees.
 * `estimateMinutes` + `startedAt` are the intent ("I'm doing this, I think it'll take X");
 * `actualMinutes` is filled in later by the user. This is the substrate every future
 * actual-measurement approach (usage active-time, rollup self-report) will consume.
 */
export interface WorklogEntry {
  id: string;
  /** Tree node path this work belongs to (the launcher "title"). */
  entityPath?: string;
  /** Working directory the agent was opened in, for correlating with launcher sessions. Absent for manually logged non-agent work. */
  cwd?: string;
  name: string;
  description?: string;
  estimateMinutes: number;
  startedAt: string;
  /** User-confirmed time spent; null until logged in the Worklog view. */
  actualMinutes: number | null;
}

/** Returns the path to the worklog file (~/.tangent/worklog.jsonl). */
function worklogPath(): string {
  return path.join(homedir(), ".tangent", "worklog.jsonl");
}

/** Reads all worklog entries; returns an empty array if the file is missing. */
async function readEntries(): Promise<WorklogEntry[]> {
  try {
    const raw = await readFile(worklogPath(), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as WorklogEntry);
  } catch {
    return [];
  }
}

/** Writes all worklog entries back to disk, creating the parent directory if needed. */
async function writeEntries(entries: WorklogEntry[]): Promise<void> {
  const file = worklogPath();
  await mkdir(path.dirname(file), { recursive: true });
  // ponytail: full-file rewrite, switch to real append/index if the log gets large
  await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

/**
 * Appends a new work entry with a fresh id. `actualMinutes` defaults to null (agent opens log it later);
 * pass it to record already-finished work (e.g. a meeting) in one shot.
 */
export async function appendWorklogEntry(
  input: Omit<WorklogEntry, "id" | "actualMinutes"> & { actualMinutes?: number | null }
): Promise<WorklogEntry> {
  const entry: WorklogEntry = { ...input, id: randomUUID(), actualMinutes: input.actualMinutes ?? null };
  const entries = await readEntries();
  await writeEntries([...entries, entry]);
  return entry;
}

/** Lists all worklog entries in insertion order. */
export async function listWorklogEntries(): Promise<WorklogEntry[]> {
  return readEntries();
}

/** Records the user-confirmed actual time for a worklog entry, optionally appending a note about what happened. */
export async function setWorklogActual(id: string, minutes: number, note?: string): Promise<void> {
  const entries = await readEntries();
  await writeEntries(entries.map((entry) => {
    if (entry.id !== id) return entry;
    const description = note ? [entry.description, note].filter(Boolean).join("\n") : entry.description;
    return { ...entry, actualMinutes: minutes, description };
  }));
}
