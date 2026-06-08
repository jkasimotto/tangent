import { stat } from "node:fs/promises";
import Database from "better-sqlite3";
import { hookInstallStatus, isGitTracked } from "@tangent/hooks";
import { pathExists, repoInfo } from "@tangent/repo";

import { listJsonlFiles } from "../core/append-jsonl.js";
import { repoEventDir, repoIndexPath } from "../core/paths.js";
import type { UsageProvider } from "../core/schema/usage-jsonl-v1.js";
import { capabilitiesForProvider } from "../core/schema/capabilities.js";
import { discoverClaudeNative } from "../providers/claude/native/discover.js";
import { discoverCodexNative } from "../providers/codex/native/discover.js";
import { nativeSchemaStatus } from "../providers/native/status.js";
import type { NativeProviderSchemaStatus } from "../providers/native/types.js";

export type StatusOptions = {
  repo: string;
  providers?: UsageProvider[];
};

export type ProviderStatus = {
  provider: UsageProvider;
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
  nativeSchema: NativeProviderSchemaStatus;
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
  index: {
    path: string;
    exists: boolean;
    sourceFiles: number;
    updatedAt?: string;
  };
  providers: ProviderStatus[];
};

export async function status(options: StatusOptions): Promise<RepoStatus> {
  const providers = options.providers || ["claude", "codex"];
  const info = await repoInfo(options.repo);
  const root = info.root || info.cwd;
  const providerStatuses: ProviderStatus[] = [];
  const nativeStatuses = await nativeSchemaStatus({ repo: root, providers });

  for (const provider of providers) {
    const logDir = repoEventDir(root, provider);
    const files = await listJsonlFiles(logDir);
    const nativePaths = provider === "claude" ? await discoverClaudeNative(root) : await discoverCodexNative(root);
    const hooks = {
      global: await hookStatus(provider, "global", root),
      repoLocal: await hookStatus(provider, "repo-local", root),
      repoShared: await hookStatus(provider, "repo-shared", root)
    };
    const nativeSchema = nativeStatuses.find((status) => status.provider === provider) || {
      provider,
      logKind: provider === "claude" ? "claude.conversation" as const : "codex.rollout" as const,
      files: 0,
      records: 0,
      parseErrors: 0,
      observedVersions: [],
      compatibility: "no-native-logs" as const,
      messages: [],
      versions: [],
      matchedSchemaIds: []
    };
    providerStatuses.push({
      provider,
      supported: true,
      native: nativePaths.length ? "available" : provider === "claude" ? "unavailable" : "best-effort",
      nativePaths,
      hooks,
      capture: {
        enabled: hasAnyInstalledHook(hooks),
        logDir,
        lastEvent: await newestMtime(files)
      },
      nativeSchema,
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
    index: await indexStatus(root),
    providers: providerStatuses
  };
}

function hasAnyInstalledHook(hooks: ProviderStatus["hooks"]): boolean {
  return hooks.global.installed || hooks.repoLocal.installed || hooks.repoShared.installed;
}

async function hookStatus(provider: UsageProvider, scope: "global" | "repo-local" | "repo-shared", root: string): Promise<{ installed: boolean; path: string }> {
  const status = await hookInstallStatus({
    provider,
    scope,
    repoRoot: root,
    recordCommand: "tangent usage hook record"
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

async function indexStatus(root: string): Promise<RepoStatus["index"]> {
  const indexPath = repoIndexPath(root);
  if (!(await pathExists(indexPath))) return { path: indexPath, exists: false, sourceFiles: 0 };
  const fileStat = await stat(indexPath);
  let sourceFiles = 0;
  try {
    const db = new Database(indexPath, { readonly: true });
    try {
      const row = db.prepare("select count(*) as count from source_files").get() as { count: number };
      sourceFiles = row.count;
    } finally {
      db.close();
    }
  } catch {
    sourceFiles = 0;
  }
  return {
    path: indexPath,
    exists: true,
    sourceFiles,
    updatedAt: fileStat.mtime.toISOString()
  };
}
