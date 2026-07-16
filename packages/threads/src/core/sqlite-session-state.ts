import path from "node:path";
import { openUsageFromSqlite, type UsageClient } from "@tangent/usage-index-sqlite";
import type { SessionState, SessionStateReader, SessionStepKind } from "./types.js";

type UsageSessionData = Awaited<ReturnType<UsageClient["sessions"]["get"]>>["data"];
type UsageTimelineStep = Awaited<ReturnType<UsageClient["sessions"]["timeline"]>>["data"]["items"][number];

const questionWaitingKinds = new Set(["permission", "assistant_response"]);
const recentSessionsLimit = 200;
/** Slack subtracted from `notBefore` before gating candidate sessions, absorbing the small clock skew between when a dispatch records `registeredAt` and when the launched session's first event lands in the Usage index. */
const misattributionSlackMs = 2 * 60 * 1000;

/** Minimal shape `selectSessionIdByCwd` needs from a session record: enough to match a cwd and gate by observed start, independent of the full `UsageSession` shape. */
type CandidateSession = {
  id: string;
  cwd?: string;
  repo?: { cwd?: string; worktree?: string; root?: string };
  startedAt?: string;
  lastActivityAt?: string;
};

/**
 * Default SessionStateReader, backed by the global Usage SQLite index (`scope: "all"`, matching how
 * the root Usage panel stays cross-repo): the same index the sweep needs to see sessions dispatched
 * from other repos and worktrees. Opens the index client lazily and caches it for the lifetime of one
 * reader instance, so one sweep pays the open cost once regardless of how many threads are registered.
 */
export class SqliteSessionStateReader implements SessionStateReader {
  private clientPromise?: Promise<UsageClient>;

  /** Reads a session by id from the SQLite index and reduces it to the narrow SessionState shape derive.ts needs. */
  async read(sessionId: string, now: Date): Promise<SessionState | undefined> {
    const client = await this.client();
    const session = await getSession(client, sessionId);
    if (!session) return undefined;
    const lastStepKind = await lastStepKindFor(client, sessionId);
    return toSessionState(session, lastStepKind, now);
  }

  /**
   * Backfills a missing registry session id by matching the most recently active session whose
   * cwd/repo path equals the registered worktree, gated by `notBefore` (see `selectSessionIdByCwd`)
   * so a long-lived, reused worktree cannot latch onto a session that predates this dispatch.
   */
  async resolveSessionIdByCwd(worktree: string, now: Date, notBefore?: string): Promise<string | undefined> {
    void now;
    const client = await this.client();
    // UsageWhere has no cwd filter, so the match happens in code over the most recently active
    // sessions rather than as a SQL predicate.
    const recent = await client.sessions.list({ orderBy: [{ field: "lastActivityAt", direction: "desc" }], limit: recentSessionsLimit });
    return selectSessionIdByCwd(recent.data, worktree, notBefore);
  }

  /** Opens the SQLite-backed Usage client on first use and caches it, so repeated read/resolve calls in one sweep share a single open index. */
  private client(): Promise<UsageClient> {
    if (!this.clientPromise) this.clientPromise = openUsageFromSqlite({ scope: "all" });
    return this.clientPromise;
  }
}

/** Looks up a session by id, treating "not found" (and any other lookup failure) as undefined rather than throwing. */
async function getSession(client: UsageClient, sessionId: string): Promise<UsageSessionData | undefined> {
  try {
    const result = await client.sessions.get(sessionId);
    return result.data;
  } catch {
    return undefined;
  }
}

/** Returns the kind of the most recent recorded step for a session, collapsed to whether it signals a pending question/permission prompt. Any failure (unsupported timeline, etc.) is treated as "no signal", never as an error. */
async function lastStepKindFor(client: UsageClient, sessionId: string): Promise<SessionStepKind | undefined> {
  try {
    const timeline = await client.sessions.timeline(sessionId);
    const last: UsageTimelineStep | undefined = timeline.data.items.at(-1);
    if (!last) return undefined;
    return questionWaitingKinds.has(last.kind) ? (last.kind as SessionStepKind) : "other";
  } catch {
    return undefined;
  }
}

/**
 * Picks the most recently active session (input is expected pre-sorted by `lastActivityAt`
 * descending, matching `resolveSessionIdByCwd`'s query) whose cwd matches `worktree` and, when
 * `notBefore` is given, whose observed start (`startedAt`, falling back to `lastActivityAt` when
 * `startedAt` is missing) is at or after `notBefore` minus a 2-minute slack. A session with neither
 * timestamp is never eligible once `notBefore` is given, since there is nothing to gate on. Exported
 * standalone (pure, no SQLite) so the session-misattribution guard is unit-testable without a real
 * Usage index.
 */
export function selectSessionIdByCwd(sessions: CandidateSession[], worktree: string, notBefore?: string): string | undefined {
  const threshold = notBefore === undefined ? undefined : new Date(notBefore).getTime() - misattributionSlackMs;
  const match = sessions.find((session) => sessionMatchesWorktree(session, worktree) && isEligibleByStart(session, threshold));
  return match?.id;
}

/** True when a session's observed start is at or after `threshold`, or when there is no threshold to enforce (no `notBefore` was given). */
function isEligibleByStart(session: CandidateSession, threshold: number | undefined): boolean {
  if (threshold === undefined) return true;
  const observedStart = session.startedAt || session.lastActivityAt;
  if (!observedStart) return false;
  return new Date(observedStart).getTime() >= threshold;
}

/** True when any of a session's recorded cwd/repo path fields resolves to the same path as the given worktree. */
function sessionMatchesWorktree(session: CandidateSession, worktree: string): boolean {
  const candidates = [session.cwd, session.repo?.cwd, session.repo?.worktree, session.repo?.root];
  return candidates.some((candidate) => candidate && samePath(candidate, worktree));
}

/** Compares two paths after resolving both to absolute form, so relative vs. absolute spellings of the same worktree still match. */
function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/** Maps a raw Usage session record and its last step kind into the SessionState shape derive.ts consumes, computing idle time from lastActivityAt. */
function toSessionState(session: UsageSessionData, lastStepKind: SessionStepKind | undefined, now: Date): SessionState {
  const status = session.status === "active" ? "active" : session.status === "unknown" ? "unknown" : "ended";
  const idleMs = session.lastActivityAt ? Math.max(0, now.getTime() - new Date(session.lastActivityAt).getTime()) : 0;
  return { status, idleMs, lastStepKind };
}
