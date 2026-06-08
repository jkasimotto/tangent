import { installProviderHooks, uninstallProviderHooks } from "@tangent/hooks";
import { repoInfo } from "@tangent/repo";

import type { UsageProvider } from "../core/schema/usage-jsonl-v1.js";
import { setGlobalTrackingDefault, setRepoTracked } from "../hook-runner/tracking-policy.js";

export type InstallHooksOptions = {
  provider: UsageProvider | "all";
  scope: "global" | "repo-local" | "repo-shared";
  repo?: string;
  tracking?: "all" | "allowlist" | "off";
};

export type HookInstallResult = {
  provider: UsageProvider;
  scope: InstallHooksOptions["scope"];
  path: string;
  installed: boolean;
  warnings: string[];
};

export async function installHooks(options: InstallHooksOptions): Promise<HookInstallResult[]> {
  const repo = options.scope === "global" ? undefined : await repoInfo(options.repo || process.cwd());
  const repoRoot = repo?.root || repo?.cwd;
  await applyInstallTracking(options, repoRoot);
  return installProviderHooks({
    provider: options.provider,
    scope: options.scope,
    repoRoot,
    recordCommand: "tangent usage hook record"
  }) as Promise<HookInstallResult[]>;
}

export async function uninstallHooks(options: Omit<InstallHooksOptions, "tracking">): Promise<HookInstallResult[]> {
  const repo = options.scope === "global" ? undefined : await repoInfo(options.repo || process.cwd());
  const repoRoot = repo?.root || repo?.cwd;
  return uninstallProviderHooks({
    provider: options.provider,
    scope: options.scope,
    repoRoot,
    recordCommand: "tangent usage hook record"
  }) as Promise<HookInstallResult[]>;
}

async function applyInstallTracking(options: InstallHooksOptions, repoRoot: string | undefined): Promise<void> {
  const providers = [options.provider];
  if (options.scope === "global") {
    await setGlobalTrackingDefault(options.tracking === "off" ? "off" : "on");
    return;
  }
  if (!repoRoot) return;
  await setRepoTracked(repoRoot, options.tracking !== "off", providers);
}
