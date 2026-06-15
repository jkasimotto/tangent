import { readJsonl, listJsonlFiles } from "../core/append-jsonl.js";
import { UsageDataset } from "../core/dataset.js";
import { usageHome, repoEventDir } from "../core/paths.js";
import { repoInfo } from "@tangent/repo";
import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "../core/schema/usage-jsonl-v1.js";
import { loadNativeSourceFiles } from "../providers/native/load.js";
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
  const providers = options.providers || ["claude", "codex"];
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
  const dataset = new UsageDataset(filtered, warnings, { sourceFiles });
  try {
    dataset.writeIndex(root);
  } catch (error) {
    warnings.push({ code: "index-write-failed", message: (error as Error).message });
  }
  return dataset;
}

export async function openUsage(options: Omit<ScanRepoOptions, "sources">): Promise<UsageDataset> {
  return loadUsageDatasetFromIndex(options);
}
