import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { tangentHome } from "@tangent/core";

/**
 * The feedback log: feature requests and notes the user jots straight from the
 * running app (Cmd/Ctrl+/ in `tangent ui`). It exists so a coding agent can read
 * raw, in-context user feedback without the user leaving the app or copy-pasting.
 * One append-only JSONL line per note, captured with the app/route that was open
 * so the agent knows what the note is about. Read it at ~/.tangent/feedback.jsonl.
 */
export type FeedbackEntry = { ts: number; text: string; app?: string; route?: string };

/** Path to the append-only feedback log (overridable via TANGENT_HOME for tests/harnesses). */
function feedbackPath(): string {
  return path.join(tangentHome(), ".tangent", "feedback.jsonl");
}

/** Reads all feedback entries in order; empty if the log is missing. */
export async function listFeedbackEntries(): Promise<FeedbackEntry[]> {
  try {
    const raw = await readFile(feedbackPath(), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as FeedbackEntry);
  } catch {
    return [];
  }
}

/** Appends one feedback entry to the log, creating the directory on first write. */
export async function appendFeedbackEntry(entry: FeedbackEntry): Promise<FeedbackEntry> {
  const file = feedbackPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}
