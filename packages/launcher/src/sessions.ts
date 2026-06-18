import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { configPath } from "./config.js";

const execFileAsync = promisify(execFile);

export interface LaunchSession {
  cwd: string;
  kind: "agent" | "terminal";
  tmux: boolean;
  /** Named tmux session created for this launch. Set only when tmux is true and no existing session was active. */
  tmuxSession?: string;
  startedAt: string;
}

/** Returns a stable tmux session name derived from the cwd path. */
export function cwdSessionName(cwd: string): string {
  return `tangent-${createHash("sha1").update(cwd).digest("hex").slice(0, 8)}`;
}

/** Returns the path to the sessions file (~/.tangent/launcher/sessions.json). */
function sessionsPath(): string {
  return path.join(path.dirname(configPath()), "sessions.json");
}

/** Reads all recorded sessions from disk; returns empty array if the file is missing. */
async function readSessions(): Promise<LaunchSession[]> {
  try {
    const raw = await readFile(sessionsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LaunchSession[]) : [];
  } catch {
    return [];
  }
}

/** Writes all sessions to disk, creating the parent directory if needed. */
async function writeSessions(sessions: LaunchSession[]): Promise<void> {
  const file = sessionsPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(sessions, null, 2), "utf8");
}

/** Appends a session record to the sessions file. */
export async function recordSession(session: LaunchSession): Promise<void> {
  const existing = await readSessions();
  await writeSessions([...existing, session]);
}

/**
 * Returns sessions that are still live. Tmux sessions are checked via
 * `tmux has-session`; non-tmux sessions are returned if started within 24h.
 * Dead tmux sessions are pruned from the file.
 */
export async function listActiveSessions(): Promise<LaunchSession[]> {
  const sessions = await readSessions();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const active: LaunchSession[] = [];

  for (const session of sessions) {
    if (session.tmuxSession) {
      try {
        await execFileAsync("tmux", ["has-session", "-t", session.tmuxSession]);
        active.push(session);
      } catch {
        // dead tmux session — omit
      }
    } else if (session.startedAt >= cutoff) {
      active.push(session);
    }
  }

  if (active.length !== sessions.length) {
    const pruned = sessions.filter((s) =>
      s.tmuxSession ? active.includes(s) : s.startedAt >= cutoff
    );
    await writeSessions(pruned);
  }

  return active;
}
