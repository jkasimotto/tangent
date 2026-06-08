import { readJsonl, listJsonlFiles } from "../core/append-jsonl.js";
import { UsageDataset } from "../core/dataset.js";
import { usageHome, repoEventDir } from "../core/paths.js";
import { repoInfo } from "@tangent/repo";
import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "../core/schema/usage-jsonl-v1.js";
import { discoverClaudeNative } from "../providers/claude/native/discover.js";
import { normalizeClaudeNativeRecord } from "../providers/claude/native/normalize.js";

export type ScanRepoOptions = {
  repo: string;
  providers?: UsageProvider[];
  sources?: Array<"native" | "usage-jsonl" | "hooks-status">;
  since?: Date;
  until?: Date;
  includeRaw?: boolean;
};

export async function scanRepo(options: ScanRepoOptions): Promise<UsageDataset> {
  const providers = options.providers || ["claude", "codex"];
  const sources = options.sources || ["usage-jsonl"];
  const repo = await repoInfo(options.repo);
  const root = repo.root || repo.cwd;
  const events: UsageJsonlLineV1[] = [];
  const warnings: UsageWarning[] = [];
  const sourceFiles: string[] = [];

  if (sources.includes("usage-jsonl")) {
    for (const provider of providers) {
      const files = await listJsonlFiles(repoEventDir(root, provider));
      for (const file of files) {
        try {
          sourceFiles.push(file);
          events.push(...await readJsonl<UsageJsonlLineV1>(file));
        } catch (error) {
          warnings.push({ code: "invalid-jsonl", message: (error as Error).message, path: file });
        }
      }
    }
  }

  if (sources.includes("native") && providers.includes("claude")) {
    const files = await discoverClaudeNative(root);
    for (const file of files) {
      try {
        const records = await readJsonl<unknown>(file);
        sourceFiles.push(file);
        records.forEach((record, index) => {
          const normalized = normalizeClaudeNativeRecord(record, file, index + 1);
          events.push(...normalized);
        });
      } catch (error) {
        warnings.push({ code: "claude-native-parse-failed", message: (error as Error).message, path: file });
      }
    }
  }

  const filtered = events.filter((event) => {
    const observed = new Date(event.observed_at || event.recorded_at);
    if (options.since && observed < options.since) return false;
    if (options.until && observed > options.until) return false;
    return true;
  });

  void usageHome;
  const dataset = new UsageDataset(filtered, warnings, { sourceFiles });
  try {
    dataset.writeIndex(root);
  } catch (error) {
    warnings.push({ code: "index-write-failed", message: (error as Error).message });
  }
  return dataset;
}

export async function openUsage(options: Omit<ScanRepoOptions, "sources">): Promise<UsageDataset> {
  return scanRepo({ ...options, sources: ["usage-jsonl"] });
}
