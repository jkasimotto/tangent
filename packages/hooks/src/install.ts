import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { pathExists, repoInfo } from "@tangent/repo";
import { hasManagedHookCommand, managedHookCommandFragments, mergeJsonConfig, removeManagedHooks } from "./config.js";
import { excludeRepoLocalHook } from "./git-exclude.js";
import { claudeHooksConfig, claudeHookPath } from "./providers/claude.js";
import { codexHooksConfig, codexHookPath } from "./providers/codex.js";
import type { HookInstallStatus, HookProvider, HookScope } from "./types.js";

const execFileAsync = promisify(execFile);

export type InstallProviderHooksOptions = {
  provider: HookProvider | "all";
  scope: HookScope;
  repo?: string;
  repoRoot?: string;
  recordCommand?: string;
};

export type ProviderHookInstallResult = {
  provider: HookProvider;
  scope: HookScope;
  path: string;
  installed: boolean;
  warnings: string[];
};

export async function installProviderHooks(options: InstallProviderHooksOptions): Promise<ProviderHookInstallResult[]> {
  const providers = expandProviders(options.provider);
  const repoRoot = await resolveRepoRoot(options);
  const results: ProviderHookInstallResult[] = [];

  for (const provider of providers) {
    const configPath = hookPath(provider, options.scope, repoRoot);
    const config = hooksConfig(provider, {
      scope: options.scope,
      repoRoot,
      recordCommand: options.recordCommand
    });
    const warnings: string[] = [];
    await mergeJsonConfig(configPath, config, provider, managedHookCommandFragments(options.recordCommand));
    if (options.scope === "repo-local") await excludeRepoLocalHook(repoRoot!, provider, warnings);
    results.push({ provider, scope: options.scope, path: configPath, installed: true, warnings });
  }

  return results;
}

export async function uninstallProviderHooks(options: InstallProviderHooksOptions): Promise<ProviderHookInstallResult[]> {
  const providers = expandProviders(options.provider);
  const repoRoot = await resolveRepoRoot(options);
  const results: ProviderHookInstallResult[] = [];

  for (const provider of providers) {
    const configPath = hookPath(provider, options.scope, repoRoot);
    if (await pathExists(configPath)) await removeManagedHooks(configPath, provider, managedHookCommandFragments(options.recordCommand));
    results.push({ provider, scope: options.scope, path: configPath, installed: false, warnings: [] });
  }

  return results;
}

export async function hookInstallStatus(options: {
  provider: HookProvider;
  scope: HookScope;
  repoRoot?: string;
  recordCommand?: string;
}): Promise<HookInstallStatus> {
  const path = hookPath(options.provider, options.scope, options.repoRoot);
  const installed = await hasManagedHookCommand(path, options.provider, options.scope, managedHookCommandFragments(options.recordCommand));
  return { installed, path };
}

export async function providerHookStatus(options: {
  provider: HookProvider;
  repoRoot: string;
  recordCommand?: string;
}): Promise<{
  global: HookInstallStatus;
  repoLocal: HookInstallStatus;
  repoShared: HookInstallStatus;
}> {
  return {
    global: await hookInstallStatus({ ...options, scope: "global" }),
    repoLocal: await hookInstallStatus({ ...options, scope: "repo-local" }),
    repoShared: await hookInstallStatus({ ...options, scope: "repo-shared" })
  };
}

export async function isGitTracked(root: string, filePath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", root, "ls-files", "--error-unmatch", filePath]);
    return true;
  } catch {
    return false;
  }
}

export function hookPath(provider: HookProvider, scope: HookScope, repoRoot?: string): string {
  return provider === "codex" ? codexHookPath(scope, repoRoot) : claudeHookPath(scope, repoRoot);
}

export function hooksConfig(provider: HookProvider, options: { scope: HookScope; repoRoot?: string; recordCommand?: string }): Record<string, unknown> {
  return provider === "codex" ? codexHooksConfig(options) : claudeHooksConfig(options);
}

function expandProviders(provider: HookProvider | "all"): HookProvider[] {
  return provider === "all" ? ["claude", "codex"] : [provider];
}

async function resolveRepoRoot(options: InstallProviderHooksOptions): Promise<string | undefined> {
  if (options.scope === "global") return undefined;
  if (options.repoRoot) return options.repoRoot;
  const repo = await repoInfo(options.repo || process.cwd());
  return repo.root || repo.cwd;
}
