import { readJsonl, listJsonlFiles } from "../core/append-jsonl.js";
import { ConvosDataset } from "../core/dataset.js";
import { convosHome, repoEventDir } from "../core/paths.js";
import { repoInfo } from "@tangent/repo";
import type { ConvosJsonlLineV1, ConvosProvider, ConvosWarning } from "../core/schema/convos-jsonl-v1.js";
import { discoverClaudeNative } from "../providers/claude/native/discover.js";
import { normalizeClaudeNativeRecord } from "../providers/claude/native/normalize.js";

export type ScanRepoOptions = {
  repo: string;
  providers?: ConvosProvider[];
  sources?: Array<"native" | "convos-jsonl" | "hooks-status">;
  since?: Date;
  until?: Date;
  includeRaw?: boolean;
};

export async function scanRepo(options: ScanRepoOptions): Promise<ConvosDataset> {
  const providers = options.providers || ["claude", "codex"];
  const sources = options.sources || ["convos-jsonl"];
  const repo = await repoInfo(options.repo);
  const root = repo.root || repo.cwd;
  const events: ConvosJsonlLineV1[] = [];
  const warnings: ConvosWarning[] = [];
  const sourceFiles: string[] = [];

  if (sources.includes("convos-jsonl")) {
    for (const provider of providers) {
      const files = await listJsonlFiles(repoEventDir(root, provider));
      for (const file of files) {
        try {
          sourceFiles.push(file);
          events.push(...await readJsonl<ConvosJsonlLineV1>(file));
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
          if (normalized) events.push(normalized);
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

  void convosHome;
  const dataset = new ConvosDataset(filtered, warnings, { sourceFiles });
  try {
    dataset.writeIndex(root);
  } catch (error) {
    warnings.push({ code: "index-write-failed", message: (error as Error).message });
  }
  return dataset;
}

export async function openConvos(options: Omit<ScanRepoOptions, "sources">): Promise<ConvosDataset> {
  return scanRepo({ ...options, sources: ["convos-jsonl"] });
}
