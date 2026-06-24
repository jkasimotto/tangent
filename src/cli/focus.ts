import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The command-and-control event log. Every task, focus segment, note, check-in,
 * agent dispatch, and completion is one append-only event. Tasks, the daily
 * timeline, switch counts, and estimate-vs-actual are all projections over this
 * single log (see docs/design/command-and-control.md). No other store is needed.
 */
export type FocusEvent =
  // `outcomes` is the session's deliverable checklist; `intent`/`outcome` are legacy single-string fields kept
  // optional so the old log still parses. See packages/trees-ui/src/focus-client.ts for the projection.
  | { type: "task_started"; ts: number; taskId: string; entity: string; intent?: string; outcome?: string; outcomes?: { id: string; text: string }[]; estimateMin: number }
  | { type: "focus_on"; ts: number; taskId: string }
  | { type: "outcome_checked"; ts: number; taskId: string; outcomeId: string; done: boolean }
  | { type: "focus_off"; ts: number; taskId: string }
  | { type: "note_added"; ts: number; taskId: string; text: string }
  | { type: "checkin_set"; ts: number; taskId: string; dueAt: number }
  | { type: "agent_dispatched"; ts: number; taskId: string; adapter: string; cwd: string; transcriptDir?: string }
  // `actualUnknown` is a dead legacy field kept optional so old logs still parse; a forgotten finish is now
  // repaired with `session_retimed` instead. The projection ignores it.
  | { type: "task_done"; ts: number; taskId: string; note?: string; actualUnknown?: boolean }
  | { type: "task_dropped"; ts: number; taskId: string; note?: string }
  // Retroactively corrects a finished session's boundaries. See packages/trees-ui/src/focus-client.ts for how
  // actualMin and the session's day re-derive from the corrected bounds.
  | { type: "session_retimed"; ts: number; taskId: string; startedAt?: number; doneAt?: number }
  | { type: "rest_started"; ts: number; durationMin: number }
  | { type: "rest_ended"; ts: number };

/** Root of the focus data (overridable via TANGENT_HOME so tests/harnesses can use a temp dir). */
function focusDir(): string {
  return path.join(process.env.TANGENT_HOME || homedir(), ".tangent", "focus");
}

/** Path to the append-only focus event log. */
function eventsPath(): string {
  return path.join(focusDir(), "events.jsonl");
}

/** Reads all focus events in order; empty if the log is missing. */
export async function listFocusEvents(): Promise<FocusEvent[]> {
  try {
    const raw = await readFile(eventsPath(), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as FocusEvent);
  } catch {
    return [];
  }
}

/** Appends one event to the log, creating the directory on first write. */
export async function appendFocusEvent(event: FocusEvent): Promise<FocusEvent> {
  const file = eventsPath();
  await mkdir(path.dirname(file), { recursive: true });
  // ponytail: line append; the log is one human's day, it will not get large
  await writeFile(file, `${JSON.stringify(event)}\n`, { flag: "a" });
  return event;
}

/**
 * Lists every Claude profile data dir (`~/.claude`, `~/.claude-otto`, ...). A
 * dispatched agent's transcript can land under any profile the user runs, so
 * status resolution has to look across all of them.
 *
 * This duplicates the smaller half of @tangent/usage-providers' `claudeHomes()`
 * on purpose: command-and-control must not take a vertical dependency on the
 * usage package (see the root AGENTS.md boundary rule), and this is a few lines.
 */
function claudeProfileHomes(): string[] {
  const home = homedir();
  try {
    return readdirSync(home)
      .filter((name) => name.startsWith(".claude"))
      .map((name) => path.join(home, name))
      .filter((dir) => existsSync(path.join(dir, "projects")))
      .sort();
  } catch {
    return [path.join(home, ".claude")];
  }
}

/** Mirrors Claude Code's transcript layout: <profile>/projects/<cwd with / and . as ->. */
function transcriptDirForCwd(cwd: string): string {
  const encoded = cwd.replace(/[/.]/g, "-");
  const homes = claudeProfileHomes();
  const existing = homes.find((home) => existsSync(path.join(home, "projects", encoded)));
  return path.join(existing ?? path.join(homedir(), ".claude"), "projects", encoded);
}

/** Resolves the transcript directory to record at dispatch time, preferring the profile that already holds it. */
export function transcriptDirFor(cwd: string): string {
  return transcriptDirForCwd(cwd);
}

export type AgentStatus = "running" | "waiting" | "done" | "unknown";

/**
 * Derives a dispatched agent's status from its transcript directory: the newest
 * .jsonl is the live session. Fresh writes mean running; a stale file means the
 * turn is done. "waiting" is read from a trailing permission/tool marker.
 * ponytail: mtime + tail heuristic. Swap for a structured @tangent/usage reader
 * if waiting/done detection proves unreliable.
 */
export async function readAgentStatus(transcriptDir: string, now = Date.now()): Promise<AgentStatus> {
  let newest: { file: string; mtimeMs: number } | undefined;
  try {
    for (const name of await readdir(transcriptDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const info = await stat(path.join(transcriptDir, name));
      if (!newest || info.mtimeMs > newest.mtimeMs) newest = { file: path.join(transcriptDir, name), mtimeMs: info.mtimeMs };
    }
  } catch {
    return "unknown";
  }
  if (!newest) return "unknown";
  const idleMs = now - newest.mtimeMs;
  try {
    const raw = await readFile(newest.file, "utf8");
    const last = raw.split("\n").filter(Boolean).at(-1) || "";
    if (/permission|tool_use|awaiting|needs_input/i.test(last)) return "waiting";
  } catch {
    // fall through to time-based status
  }
  return idleMs < 60_000 ? "running" : "done";
}
