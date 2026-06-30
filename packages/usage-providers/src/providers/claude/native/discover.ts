import path from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";

import { listJsonlFiles } from "@tangent/usage-core/core/append-jsonl";

/**
 * Encodes a repo/worktree path the way Claude Code names its `~/.claude/projects/<key>` directories,
 * so a path can be mapped back to its transcript folder. Claude Code replaces BOTH `/` and `.` with `-`
 * (so `/Users/me/.tangent/x` becomes `-Users-me--tangent-x`). Replacing only `/` silently fails to match
 * any path containing a dot, which is every Tangent eval worktree under `~/.tangent/eval/runs/...`, and
 * left their conversation metrics (tokens, tools, flame graph) empty.
 */
export function claudeProjectKey(repoRoot: string): string {
  return repoRoot.replace(/[/.]/g, "-");
}

/**
 * Every Claude Code data directory to scan. The user runs more than one Claude
 * profile (`~/.claude`, `~/.claude-otto`, ...), each with its own `projects/`
 * transcript tree, so discovery must union them all or conversations under the
 * extra profiles are invisible. CLAUDE_HOME overrides the glob entirely and may
 * list several dirs (`path.delimiter`-separated) so tests can point at fixtures.
 */
export function claudeHomes(): string[] {
  const override = process.env.CLAUDE_HOME;
  if (override) return override.split(path.delimiter).filter(Boolean);
  const home = homedir();
  try {
    return readdirSync(home)
      .filter((name) => name.startsWith(".claude"))
      .map((name) => path.join(home, name))
      .filter((dir) => isClaudeProfileDir(dir))
      .sort();
  } catch {
    return [path.join(home, ".claude")];
  }
}

/** A profile dir counts only if it is a directory (following symlinks) holding a `projects/` tree. */
function isClaudeProfileDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && existsSync(path.join(dir, "projects"));
  } catch {
    return false;
  }
}

/** First Claude data directory, for the rare caller that needs a single home rather than all of them. */
export function claudeHome(): string {
  return claudeHomes()[0] ?? path.join(homedir(), ".claude");
}

/** Lists Claude native transcript files across every profile, scoped to one repo/worktree's project dir when given, else all of them. */
export async function discoverClaudeNative(repoRoot?: string): Promise<string[]> {
  const files: string[] = [];
  for (const home of claudeHomes()) {
    const projectsDir = path.join(home, "projects");
    for (const target of await projectDirsUnder(projectsDir, repoRoot)) {
      files.push(...(await listJsonlFiles(target)));
    }
  }
  return files;
}

/**
 * Resolves the project dirs to scan for a repoRoot: the dir keyed by repoRoot itself, plus any dir
 * keyed by a cwd nested under it (an eval variant can run the agent in a subdirectory of its worktree,
 * which Claude Code keys as its own project dir distinct from the worktree root's). Unscoped, returns
 * the whole projects dir as a single target, as before.
 */
async function projectDirsUnder(projectsDir: string, repoRoot?: string): Promise<string[]> {
  if (!repoRoot) return [projectsDir];
  const key = claudeProjectKey(repoRoot);
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === key || entry.name.startsWith(`${key}-`)))
    .map((entry) => path.join(projectsDir, entry.name));
}
