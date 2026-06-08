import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "@tangent/repo";
import type { HookProvider } from "./types.js";

export async function excludeRepoLocalHook(repoRoot: string, provider: HookProvider, warnings: string[] = []): Promise<string[]> {
  const excludePath = path.join(repoRoot, ".git", "info", "exclude");
  if (!(await pathExists(path.join(repoRoot, ".git")))) return warnings;
  const entry = provider === "codex" ? ".codex/hooks.json" : ".claude/settings.local.json";
  const existing = (await pathExists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (!existing.split(/\r?\n/).includes(entry)) {
    await appendFile(excludePath, `${existing.endsWith("\n") || !existing ? "" : "\n"}${entry}\n`, "utf8");
  }
  if (provider === "codex") {
    warnings.push("Codex has no documented .local config file; repo-local mode writes .codex/hooks.json and excludes it locally.");
  }
  return warnings;
}
