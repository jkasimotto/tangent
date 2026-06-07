import path from "node:path";
import { homedir } from "node:os";

import { listJsonlFiles } from "../../../core/append-jsonl.js";

export function claudeProjectKey(repoRoot: string): string {
  return repoRoot.replace(/\//g, "-").replace(/^-/, "-");
}

export async function discoverClaudeNative(repoRoot: string): Promise<string[]> {
  const projectDir = path.join(homedir(), ".claude", "projects", claudeProjectKey(repoRoot));
  return listJsonlFiles(projectDir);
}
