import { readJsonl } from "@tangent/usage-core/core/append-jsonl";
import { appendJsonl } from "@tangent/usage-core/core/append-jsonl";
import { eventFileForConversation } from "@tangent/usage-core/core/paths";
import { pathExists, repoInfo } from "@tangent/repo";
import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { discoverClaudeNative } from "@tangent/usage-providers/providers/claude/native/discover";
import { normalizeClaudeNativeRecord } from "@tangent/usage-providers/providers/claude/native/normalize";

export type ImportNativeOptions = {
  repo: string;
  provider: Extract<UsageProvider, "claude">;
};

export type ImportNativeResult = {
  provider: "claude";
  files: number;
  imported: number;
  skipped: number;
  warnings: Array<{ path: string; message: string }>;
};

/** Imports Claude native transcript JSONL files into the usage event store for the given repo. */
export async function importNative(options: ImportNativeOptions): Promise<ImportNativeResult> {
  const repo = await repoInfo(options.repo);
  const root = repo.root || repo.cwd;
  const files = await discoverClaudeNative(root);
  const warnings: ImportNativeResult["warnings"] = [];
  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      const records = await readJsonl<unknown>(file);
      for (const [index, record] of records.entries()) {
        const events = normalizeClaudeNativeRecord(record, file, index + 1);
        if (!events.length) {
          skipped += 1;
          continue;
        }
        for (const event of events) {
          const target = eventFileForConversation(root, "claude", event.conversation.id);
          const existingIds = await existingEventIds(target);
          if (existingIds.has(event.event_id)) {
            skipped += 1;
            continue;
          }
          await appendJsonl(target, event);
          imported += 1;
        }
      }
    } catch (error) {
      warnings.push({ path: file, message: (error as Error).message });
    }
  }

  return { provider: "claude", files: files.length, imported, skipped, warnings };
}

/** Returns the set of event IDs already recorded in the given event JSONL file. */
async function existingEventIds(filePath: string): Promise<Set<string>> {
  if (!(await pathExists(filePath))) return new Set();
  return new Set((await readJsonl<{ event_id?: string }>(filePath)).map((event) => event.event_id).filter((id): id is string => Boolean(id)));
}
