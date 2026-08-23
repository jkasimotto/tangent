// Time facts for the Area map (design contract: otto/tangent/design-area-map,
// Decision 9). The vault is a git repository where every save is one commit,
// so git holds when each file was created and last changed. `mtime` changes on
// checkout and on `git mv`, so it is only the fallback for a file that has no
// commit yet, or a vault without git.
//
// The same pass reads each commit's subject and its `Tangent-Tmux` trailer, so
// a Goal file also carries the agents that ever worked on it and when the work
// started and last ended (design-goal-cards, Decisions 1 and 2).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * True for a vault commit subject that starts an agent on a Goal file:
 * `... goal <slug> active`, `... N goals active`, or `... owned by <session>`.
 */
function isRunStart(subject) {
  return / active$/.test(subject) || / owned by /.test(subject);
}

/**
 * True for a vault commit subject that ends an agent run on a Goal file:
 * the reconciler's `back to open`, a release, or a close in the tree.
 */
function isRunEnd(subject) {
  return / back to open, session ended$/.test(subject)
    || / released$/.test(subject)
    || / done in tree$/.test(subject)
    || / marked won't do in tree$/.test(subject);
}

/**
 * The close kind of a vault commit subject, for a Goal marked done or won't
 * do in the tree. Null for any other subject.
 */
function closeKind(subject) {
  if (subject.endsWith(" done in tree")) return "done";
  if (subject.endsWith(" marked won't do in tree")) return "wontdo";
  return null;
}

/**
 * Parses `git log --format=%x00%ct%x1f%s%x1f<Tangent-Tmux trailers> --name-status`
 * output into per-file times, per-file agent runs, and close events. The log
 * is newest first: the first time seen for a path is its last change, the
 * last time seen is its creation. A rename (`R100 old new`) carries the new
 * path, and older lines about the old path count for the new one, so history
 * follows a `git mv`.
 * Returns { times, runs, closes }:
 *   times:  Map<path, { createdAt, changedAt }> in milliseconds
 *   runs:   Map<path, { agents, firstStartAt, lastStartAt, lastEndAt }>, only
 *           for files an agent was ever started on; `agents` is oldest first.
 *   closes: Array<{ file, kind, at, session }>, newest first, one entry per
 *           Goal file marked done or won't do in the tree; `session` is the
 *           first Tangent-Tmux trailer name, null when the commit has none.
 */
export function parseGitLog(log) {
  const times = new Map();
  const runs = new Map();
  const closes = [];
  // Renames, seen newest first: an older line about `old` belongs to `new`.
  const alias = new Map();
  /** Follows rename aliases to the newest path of a file. */
  const resolve = (file) => {
    let current = file;
    for (let hops = 0; alias.has(current) && hops < 64; hops += 1) current = alias.get(current);
    return current;
  };
  let at = 0;
  let kind = "other";
  let closing = null;
  let sessions = [];
  for (const line of String(log).split("\n")) {
    if (line.startsWith("\0")) {
      const [seconds, subject = "", trailers = ""] = line.slice(1).split("\x1f");
      at = Number(seconds) * 1000;
      sessions = trailers.split(",").map((name) => name.trim()).filter(Boolean);
      kind = isRunStart(subject) && sessions.length ? "start" : isRunEnd(subject) ? "end" : "other";
      closing = closeKind(subject);
      continue;
    }
    const match = line.match(/^([A-Z])\d*\t([^\t]+)(?:\t([^\t]+))?$/);
    if (!match || !at) continue;
    if (match[3]) alias.set(match[2], resolve(match[3]));
    const file = resolve(match[3] ?? match[2]);
    const entry = times.get(file);
    if (entry) entry.createdAt = at;
    else times.set(file, { createdAt: at, changedAt: at });
    if (closing && file.split("/").pop().startsWith("goal-") && file.endsWith(".md")) {
      closes.push({ file, kind: closing, at, session: sessions[0] ?? null });
    }
    if (kind === "other") continue;
    let run = runs.get(file);
    if (!run) {
      run = { agents: [], firstStartAt: at, lastStartAt: null, lastEndAt: null };
      runs.set(file, run);
    }
    if (kind === "start") {
      // The log is newest first, so an older commit's agents go in front.
      run.agents.unshift(...sessions.filter((session) => !run.agents.includes(session)));
      run.firstStartAt = at;
      if (run.lastStartAt === null) run.lastStartAt = at;
    } else if (run.lastEndAt === null) run.lastEndAt = at;
  }
  // An end commit alone says nothing about a run: no start, no entry.
  for (const [file, run] of runs) if (!run.agents.length) runs.delete(file);
  return { times, runs, closes };
}

/** The per-file times of the vault log, without the run facts. */
export function parseGitTimes(log) {
  return parseGitLog(log).times;
}

/**
 * Chooses the change and creation time of one file: git when the file is
 * committed, `mtime` when it is newer than the last commit that touched it
 * (an uncommitted edit) or when git knows nothing about the file.
 */
export function fileTimes(file, mtimeMs, gitTimes) {
  const git = gitTimes?.get(file);
  const mtime = Number(mtimeMs) || 0;
  if (!git) return { createdAt: mtime, changedAt: mtime, committed: false };
  const changedAt = mtime > git.changedAt + 2000 ? mtime : git.changedAt;
  return { createdAt: git.createdAt, changedAt, committed: true };
}

/**
 * Reads git times and agent runs for every file in the vault, cached by HEAD
 * so the pass runs once per vault commit and never per poll. Returns two
 * empty maps for a vault without git.
 */
export function createVaultGitReader(root, run = execFileAsync) {
  let cache = { head: null, times: new Map(), runs: new Map(), closes: [] };
  return async function vaultGit() {
    let head;
    try {
      head = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    } catch {
      return { times: new Map(), runs: new Map(), closes: [] };
    }
    if (cache.head === head) return { times: cache.times, runs: cache.runs, closes: cache.closes };
    try {
      const format = "--format=%x00%ct%x1f%s%x1f%(trailers:key=Tangent-Tmux,valueonly,separator=%x2C)";
      const { stdout } = await run("git", ["log", format, "--name-status", "-M"], { cwd: root, maxBuffer: 1 << 28 });
      cache = { head, ...parseGitLog(stdout) };
    } catch {
      cache = { head, times: new Map(), runs: new Map(), closes: [] };
    }
    return { times: cache.times, runs: cache.runs, closes: cache.closes };
  };
}
