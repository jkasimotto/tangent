import path from "node:path";
import { homedir } from "node:os";

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

/** Root of Claude Code's data directory, honoring CLAUDE_HOME so tests can point it at a fixture. */
export function claudeHome(): string {
  return process.env.CLAUDE_HOME || path.join(homedir(), ".claude");
}

/** Lists Claude native transcript files, scoped to one repo/worktree's project dir when given, else all of them. */
export async function discoverClaudeNative(repoRoot?: string): Promise<string[]> {
  const projectsDir = path.join(claudeHome(), "projects");
  if (!repoRoot) return listJsonlFiles(projectsDir);
  const projectDir = path.join(projectsDir, claudeProjectKey(repoRoot));
  return listJsonlFiles(projectDir);
}
