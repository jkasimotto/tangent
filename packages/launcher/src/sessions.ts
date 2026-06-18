import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { configPath } from "./config.js";
import { listIterm2Sessions } from "./drivers/iterm2.js";

const execFileAsync = promisify(execFile);

export interface LaunchSession {
  cwd: string;
  kind: "agent" | "terminal";
  tmux: boolean;
  /** Named tmux session created for this launch. Set only when tmux is true and no existing session was active. */
  tmuxSession?: string;
  /** iTerm2 tab name set when the session was opened, used for liveness detection. */
  title?: string;
  /** iTerm2 session unique ID captured at open time, used for close/focus by ID. */
  iterm2SessionId?: string;
  startedAt: string;
  /** Work intent captured at open time. */
  name?: string;
  estimateMinutes?: number;
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
 * `tmux has-session`. Non-tmux sessions with an iterm2SessionId are checked
 * by unique ID (reliable even after the tab title changes); those with only a
 * title fall back to name-matching with a 30s grace period for newly opened
 * sessions; those with neither fall back to a 24h window.
 * Dead sessions are pruned from the file.
 */
export async function listActiveSessions(): Promise<LaunchSession[]> {
  const sessions = await readSessions();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Query iTerm2 once if any non-tmux sessions need checking.
  let iterm2Ids: Set<string> | undefined;
  let iterm2Names: Set<string> | undefined;
  if (sessions.some((s) => !s.tmuxSession && (s.iterm2SessionId || s.title))) {
    try {
      const open = await listIterm2Sessions();
      iterm2Ids = new Set(open.map((s) => s.id));
      iterm2Names = new Set(open.map((s) => s.name).filter(Boolean));
    } catch {
      // iTerm2 unavailable — fall through to time-based for all non-tmux sessions
    }
  }

  // Grace period only needed for legacy (name-based) sessions where the name
  // may not be registered yet immediately after opening.
  const graceCutoff = new Date(Date.now() - 30_000).toISOString();

  const active: LaunchSession[] = [];
  for (const session of sessions) {
    if (session.tmuxSession) {
      try {
        await execFileAsync("tmux", ["has-session", "-t", session.tmuxSession]);
        active.push(session);
      } catch {
        // dead tmux session — omit
      }
    } else if (session.iterm2SessionId && iterm2Ids !== undefined) {
      // ID-based: no grace period needed — ID is stable from the moment the tab opens
      if (iterm2Ids.has(session.iterm2SessionId)) active.push(session);
    } else if (session.title && iterm2Names !== undefined) {
      // Name-based (legacy): tab title may have changed, so include grace period
      if (iterm2Names.has(session.title) || session.startedAt >= graceCutoff) active.push(session);
    } else if (session.startedAt >= cutoff) {
      active.push(session);
    }
  }

  if (active.length !== sessions.length) await writeSessions(active);

  return active;
}

/** Removes the session record identified by cwd and startedAt from the sessions file. */
export async function removeSession(cwd: string, startedAt: string): Promise<void> {
  const sessions = await readSessions();
  await writeSessions(sessions.filter((s) => !(s.cwd === cwd && s.startedAt === startedAt)));
}
