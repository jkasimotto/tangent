import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs one read-only git command and returns its trimmed stdout. */
async function runGit(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  return stdout.trim();
}

/**
 * Reports commits added after this Agent Shell process started. Working-tree
 * edits are deliberately invisible: only a new HEAD can advertise a rebuild.
 */
export async function createCommitChangeMonitor({ root, git = runGit } = {}) {
  const deployedCommit = await git(root, ["rev-parse", "HEAD"]);

  /** Reads HEAD and the commits that would enter the next rebuild. */
  async function status() {
    const currentCommit = await git(root, ["rev-parse", "HEAD"]);
    if (!currentCommit || currentCommit === deployedCommit) return { deployedCommit, currentCommit, commits: [] };
    const output = await git(root, ["log", "--format=%H%x00%h%x00%s%x00%an", `${deployedCommit}..${currentCommit}`]);
    const commits = output ? output.split("\n").map((line) => {
      const [hash, shortHash, subject, author] = line.split("\0");
      return { hash, shortHash, subject, author };
    }) : [];
    return { deployedCommit, currentCommit, commits };
  }

  return { deployedCommit, status };
}
