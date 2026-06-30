import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathExists, repoInfo } from "@tangent/repo";

import { listJsonlFiles } from "@tangent/usage-core/core/append-jsonl";
import { repoEventDir, repoIndexPath } from "@tangent/usage-core/core/paths";
import { usageProviders, type UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { capabilitiesForProvider } from "@tangent/usage-core/core/schema/capabilities";
import { discoverClaudeNative } from "@tangent/usage-providers/providers/claude/native/discover";
import { discoverCodexNative } from "@tangent/usage-providers/providers/codex/native/discover";
import { discoverGeminiNative } from "@tangent/usage-providers/providers/gemini/native/discover";
import { nativeSchemaStatus } from "@tangent/usage-providers/providers/native/status";
import type { NativeProviderSchemaStatus } from "@tangent/usage-providers/providers/native/types";

const require = createRequire(import.meta.url);
type DatabaseHandle = {
  prepare(sql: string): { get(...params: unknown[]): unknown };
  close(): void;
};

export type StatusOptions = {
  repo: string;
  providers?: UsageProvider[];
};

export type ProviderStatus = {
  provider: UsageProvider;
  supported: true;
  native: "available" | "best-effort" | "unavailable";
  nativePaths: string[];
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

/** Returns a snapshot of the usage tracking status for the given repo across all providers. */
export async function status(options: StatusOptions): Promise<RepoStatus> {
  const providers = options.providers || [...usageProviders];
  const info = await repoInfo(options.repo);
  const root = info.root || info.cwd;
  const providerStatuses: ProviderStatus[] = [];
  const nativeStatuses = await nativeSchemaStatus({ repo: root, providers });

  for (const provider of providers) {
    const logDir = repoEventDir(root, provider);
    const files = await listJsonlFiles(logDir);
    const nativePaths = provider === "claude"
      ? await discoverClaudeNative(root)
      : provider === "gemini"
        ? await discoverGeminiNative(root)
        : await discoverCodexNative(root);
    const nativeSchema = nativeStatuses.find((status) => status.provider === provider) || {
      provider,
      logKind: provider === "claude" ? "claude.conversation" as const : provider === "gemini" ? "gemini.chat" as const : "codex.rollout" as const,
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
      native: nativePaths.length ? "available" : "unavailable",
      nativePaths,
      capture: {
        enabled: nativePaths.length > 0,
        logDir,
        lastEvent: await newestMtime(nativePaths.length ? nativePaths : files)
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
      trackingSource: "native-transcripts"
    },
    index: await indexStatus(root),
    providers: providerStatuses
  };
}

/** Returns the ISO timestamp of the most recently modified file in the list, or undefined if empty. */
async function newestMtime(files: string[]): Promise<string | undefined> {
  let newest = 0;
  for (const file of files) {
    const fileStat = await stat(file);
    newest = Math.max(newest, fileStat.mtimeMs);
  }
  return newest ? new Date(newest).toISOString() : undefined;
}

/** Returns the SQLite index state for the given repo root, including path, existence, and source-file count. */
async function indexStatus(root: string): Promise<RepoStatus["index"]> {
  const indexPath = repoIndexPath(root);
  if (!(await pathExists(indexPath))) return { path: indexPath, exists: false, sourceFiles: 0 };
  const fileStat = await stat(indexPath);
  let sourceFiles = 0;
  try {
    const Database = optionalSqlite();
    const db = new Database(indexPath, { readonly: true }) as DatabaseHandle;
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

/** Loads the better-sqlite3 module dynamically and throws if it is not installed. */
function optionalSqlite(): new (path: string, options?: unknown) => unknown {
  try {
    return require("better-sqlite3") as new (path: string, options?: unknown) => unknown;
  } catch {
    throw new Error("SQLite unavailable");
  }
}
