import { readJsonl, listJsonlFiles } from "@tangent/usage-core/core/append-jsonl";
import { UsageDataset } from "@tangent/usage-core/core/dataset";
import { usageHome, repoEventDir } from "@tangent/usage-core/core/paths";
import { repoInfo } from "@tangent/repo";
import { usageProviders, type UsageJsonlLineV1, type UsageProvider, type UsageWarning } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { loadNativeSourceFiles } from "@tangent/usage-providers/providers/native/load";
import { loadUsageDatasetFromIndex, type UsageIndexSource } from "./indexStore.js";

export type ScanRepoOptions = {
  repo: string;
  providers?: UsageProvider[];
  sources?: UsageIndexSource[];
  now?: Date;
  since?: Date;
  until?: Date;
  includeRaw?: boolean;
};

export async function scanRepo(options: ScanRepoOptions): Promise<UsageDataset> {
  const providers = options.providers || [...usageProviders];
  const sources = options.sources || ["native"];
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

  if (sources.includes("native")) {
    const native = await loadNativeSourceFiles({ repoRoot: root, providers, now: options.now });
    warnings.push(...native.warnings);
    for (const file of native.files) {
      sourceFiles.push(file.path);
      events.push(...file.events);
    }
  }

  const filtered = events.filter((event) => {
    const observed = new Date(event.observed_at || event.recorded_at);
    if (options.since && observed < options.since) return false;
    if (options.until && observed > options.until) return false;
    return true;
  });

  void usageHome;
  return new UsageDataset(filtered, warnings, { sourceFiles });
}

export async function openUsage(options: Omit<ScanRepoOptions, "sources">): Promise<UsageDataset> {
  try {
    return await loadUsageDatasetFromIndex(options);
  } catch (error) {
    if (!/better-sqlite3|SQLite/.test((error as Error).message)) throw error;
    return scanRepo({ ...options, sources: ["native"] });
  }
}
