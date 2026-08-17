// Time facts for the Area map (design contract: otto/tangent/design-area-map,
// Decision 9). The vault is a git repository where every save is one commit,
// so git holds when each file was created and last changed. `mtime` changes on
// checkout and on `git mv`, so it is only the fallback for a file that has no
// commit yet, or a vault without git.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Parses `git log --format=%x00%ct --name-status` output into per-file times.
 * The log is newest first: the first time seen for a path is its last change,
 * the last time seen is its creation. A rename (`R100 old new`) carries the
 * new path, and older lines about the old path count for the new one, so
 * history follows a `git mv`.
 * Returns Map<path, { createdAt, changedAt }> in milliseconds.
 */
export function parseGitTimes(log) {
  const times = new Map();
  // Renames, seen newest first: an older line about `old` belongs to `new`.
  const alias = new Map();
  /** Follows rename aliases to the newest path of a file. */
  const resolve = (file) => {
    let current = file;
    for (let hops = 0; alias.has(current) && hops < 64; hops += 1) current = alias.get(current);
    return current;
  };
  let at = 0;
  for (const line of String(log).split("\n")) {
    if (line.startsWith("\0")) {
      at = Number(line.slice(1)) * 1000;
      continue;
    }
    const match = line.match(/^([A-Z])\d*\t([^\t]+)(?:\t([^\t]+))?$/);
    if (!match || !at) continue;
    if (match[3]) alias.set(match[2], resolve(match[3]));
    const file = resolve(match[3] ?? match[2]);
    const entry = times.get(file);
    if (entry) entry.createdAt = at;
    else times.set(file, { createdAt: at, changedAt: at });
  }
  return times;
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
 * Reads git times for every file in the vault, cached by HEAD so the pass runs
 * once per vault commit and never per poll. Returns an empty map for a vault
 * without git.
 */
export function createGitTimesReader(root, run = execFileAsync) {
  let cache = { head: null, times: new Map() };
  return async function gitTimes() {
    let head;
    try {
      head = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    } catch {
      return new Map();
    }
    if (cache.head === head) return cache.times;
    try {
      const { stdout } = await run("git", ["log", "--format=%x00%ct", "--name-status", "-M"], { cwd: root, maxBuffer: 1 << 28 });
      cache = { head, times: parseGitTimes(stdout) };
    } catch {
      cache = { head, times: new Map() };
    }
    return cache.times;
  };
}
