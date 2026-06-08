import { stat } from "node:fs/promises";
import { hookInstallStatus, isGitTracked } from "@tangent/hooks";
import { repoInfo } from "@tangent/repo";

import { listJsonlFiles } from "../core/append-jsonl.js";
import { repoEventDir } from "../core/paths.js";
import type { ConvosProvider } from "../core/schema/convos-jsonl-v1.js";
import { capabilitiesForProvider } from "../core/schema/capabilities.js";
import { discoverClaudeNative } from "../providers/claude/native/discover.js";

export type StatusOptions = {
  repo: string;
  providers?: ConvosProvider[];
};

export type ProviderStatus = {
  provider: ConvosProvider;
  supported: true;
  native: "available" | "best-effort" | "unavailable";
  nativePaths: string[];
  hooks: {
    global: { installed: boolean; path: string };
    repoLocal: { installed: boolean; path: string };
    repoShared: { installed: boolean; path: string };
  };
  capture: {
    enabled: boolean;
    logDir: string;
    lastEvent?: string;
  };
  capabilities: ReturnType<typeof capabilitiesForProvider>;
};

export type RepoStatus = {
  repo: {
    path: string;
    gitRoot?: string;
    branch?: string;
    headSha?: string;
    tracking: boolean;
    trackingSource: string;
  };
  providers: ProviderStatus[];
};

export async function status(options: StatusOptions): Promise<RepoStatus> {
  const providers = options.providers || ["claude", "codex"];
  const info = await repoInfo(options.repo);
  const root = info.root || info.cwd;
  const providerStatuses: ProviderStatus[] = [];

  for (const provider of providers) {
    const logDir = repoEventDir(root, provider);
    const files = await listJsonlFiles(logDir);
    const nativePaths = provider === "claude" ? await discoverClaudeNative(root) : [];
    const hooks = {
      global: await hookStatus(provider, "global", root),
      repoLocal: await hookStatus(provider, "repo-local", root),
      repoShared: await hookStatus(provider, "repo-shared", root)
    };
    providerStatuses.push({
      provider,
      supported: true,
      native: provider === "claude" ? (nativePaths.length ? "available" : "unavailable") : "best-effort",
      nativePaths,
      hooks,
      capture: {
        enabled: hasAnyInstalledHook(hooks),
        logDir,
        lastEvent: await newestMtime(files)
      },
      capabilities: capabilitiesForProvider(provider)
    });
  }

  return {
    repo: {
      path: info.cwd,
      gitRoot: info.root,
      branch: info.branch,
      headSha: info.headSha,
      tracking: providerStatuses.some((provider) => provider.capture.enabled),
      trackingSource: "installed-hooks"
    },
    providers: providerStatuses
  };
}

function hasAnyInstalledHook(hooks: ProviderStatus["hooks"]): boolean {
  return hooks.global.installed || hooks.repoLocal.installed || hooks.repoShared.installed;
}

async function hookStatus(provider: ConvosProvider, scope: "global" | "repo-local" | "repo-shared", root: string): Promise<{ installed: boolean; path: string }> {
  const status = await hookInstallStatus({
    provider,
    scope,
    repoRoot: root,
    recordCommand: "tangent convos hook record"
  });
  let installed = status.installed;
  if (installed && provider === "codex" && scope !== "global") {
    const tracked = await isGitTracked(root, status.path);
    installed = scope === "repo-shared" ? tracked : !tracked;
  }
  return { installed, path: status.path };
}

async function newestMtime(files: string[]): Promise<string | undefined> {
  let newest = 0;
  for (const file of files) {
    const fileStat = await stat(file);
    newest = Math.max(newest, fileStat.mtimeMs);
  }
  return newest ? new Date(newest).toISOString() : undefined;
}
