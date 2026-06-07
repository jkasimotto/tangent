import { readJsonl, listJsonlFiles } from "../core/append-jsonl.js";
import { ConvosDataset } from "../core/dataset.js";
import { convosHome, repoEventDir } from "../core/paths.js";
import { repoInfo } from "../core/repo.js";
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
  const sources = options.sources || ["native", "convos-jsonl"];
  const repo = await repoInfo(options.repo);
  const root = repo.root || repo.cwd;
  const events: ConvosJsonlLineV1[] = [];
  const warnings: ConvosWarning[] = [];

  if (sources.includes("convos-jsonl")) {
    for (const provider of providers) {
      const files = await listJsonlFiles(repoEventDir(root, provider));
      for (const file of files) {
        try {
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
  return new ConvosDataset(filtered, warnings);
}
