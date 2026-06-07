import { mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import { pathExists, repoInfo } from "../core/repo.js";
import type { CaptureScope, ConvosProvider } from "../core/schema/convos-jsonl-v1.js";
import { claudeHooksConfig, claudeHookPath } from "../providers/claude/hooks/config.js";
import { codexHooksConfig, codexHookPath } from "../providers/codex/hooks/config.js";

export type InstallHooksOptions = {
  provider: ConvosProvider | "all";
  scope: "global" | "repo-local" | "repo-shared";
  repo?: string;
  tracking?: "all" | "allowlist" | "off";
};

export type HookInstallResult = {
  provider: ConvosProvider;
  scope: InstallHooksOptions["scope"];
  path: string;
  installed: boolean;
  warnings: string[];
};

export async function installHooks(options: InstallHooksOptions): Promise<HookInstallResult[]> {
  const providers = expandProviders(options.provider);
  const repo = options.scope === "global" ? undefined : await repoInfo(options.repo || process.cwd());
  const repoRoot = repo?.root || repo?.cwd;
  const results: HookInstallResult[] = [];

  for (const provider of providers) {
    const configPath = provider === "codex" ? codexHookPath(options.scope, repoRoot) : claudeHookPath(options.scope, repoRoot);
    const config = provider === "codex" ? codexHooksConfig(options.scope) : claudeHooksConfig(options.scope);
    const warnings: string[] = [];
    await writeJsonConfig(configPath, config);
    if (options.scope === "repo-local") {
      await excludeLocalHook(repoRoot!, provider, warnings);
    }
    results.push({ provider, scope: options.scope, path: configPath, installed: true, warnings });
  }

  return results;
}

export async function uninstallHooks(options: Omit<InstallHooksOptions, "tracking">): Promise<HookInstallResult[]> {
  const providers = expandProviders(options.provider);
  const repo = options.scope === "global" ? undefined : await repoInfo(options.repo || process.cwd());
  const repoRoot = repo?.root || repo?.cwd;
  const results: HookInstallResult[] = [];
  for (const provider of providers) {
    const configPath = provider === "codex" ? codexHookPath(options.scope, repoRoot) : claudeHookPath(options.scope, repoRoot);
    if (await pathExists(configPath)) await rm(configPath);
    results.push({ provider, scope: options.scope, path: configPath, installed: false, warnings: [] });
  }
  return results;
}

function expandProviders(provider: ConvosProvider | "all"): ConvosProvider[] {
  return provider === "all" ? ["claude", "codex"] : [provider];
}

async function writeJsonConfig(filePath: string, config: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function excludeLocalHook(repoRoot: string, provider: ConvosProvider, warnings: string[]): Promise<void> {
  const excludePath = path.join(repoRoot, ".git", "info", "exclude");
  if (!(await pathExists(path.join(repoRoot, ".git")))) return;
  const entry = provider === "codex" ? ".codex/hooks.json" : ".claude/settings.local.json";
  const existing = (await pathExists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (!existing.split(/\r?\n/).includes(entry)) {
    await appendFile(excludePath, `${existing.endsWith("\n") || !existing ? "" : "\n"}${entry}\n`, "utf8");
  }
  if (provider === "codex") {
    warnings.push("Codex has no documented .local config file; repo-local mode writes .codex/hooks.json and excludes it locally.");
  }
}
