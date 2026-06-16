import { readFile, stat } from "node:fs/promises";

import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "../../core/schema/usage-jsonl-v1.js";
import { discoverClaudeNative } from "../claude/native/discover.js";
import { normalizeClaudeNativeRecords, type ClaudeNativeRecord } from "../claude/native/normalize.js";
import { discoverCodexNative } from "../codex/native/discover.js";
import { normalizeCodexNativeRecords, type CodexNativeRecord } from "../codex/native/normalize.js";

export const nativeQuietMs = 15 * 60 * 1000;

export type NativeSourceFile = {
  path: string;
  provider: UsageProvider;
  mtimeMs: number;
  size: number;
  events: UsageJsonlLineV1[];
};

export type NativeSourceFileStat = Omit<NativeSourceFile, "events">;

export type LoadNativeOptions = {
  repoRoot?: string;
  providers: UsageProvider[];
  now?: Date;
  skipUnchanged?: (file: NativeSourceFileStat) => boolean;
};

export async function loadNativeSourceFiles(options: LoadNativeOptions): Promise<{
  files: NativeSourceFile[];
  skipped: NativeSourceFileStat[];
  seenPaths: string[];
  warnings: UsageWarning[];
}> {
  const files: NativeSourceFile[] = [];
  const skipped: NativeSourceFileStat[] = [];
  const seenPaths: string[] = [];
  const warnings: UsageWarning[] = [];
  const now = options.now || new Date();

  for (const provider of options.providers) {
    const paths = provider === "claude" ? await discoverClaudeNative(options.repoRoot) : await discoverCodexNative(options.repoRoot);
    for (const filePath of paths) {
      seenPaths.push(filePath);
      try {
        const fileStat = await stat(filePath);
        const source = { path: filePath, provider, mtimeMs: fileStat.mtimeMs, size: fileStat.size };
        if (options.skipUnchanged?.(source)) {
          skipped.push(source);
          continue;
        }
        const parsed = await readNativeJsonl(filePath);
        const eligibility = provider === "codex"
          ? codexEligibility(parsed.records, fileStat.mtimeMs, now)
          : claudeEligibility(parsed.records, fileStat.mtimeMs, now);
        if (!eligibility.eligible) continue;
        const events = provider === "codex"
          ? normalizeCodexNativeRecords(parsed.records as CodexNativeRecord[], {
            sourcePath: filePath,
            completed: eligibility.completed,
            inferredComplete: eligibility.inferredComplete
          })
          : normalizeClaudeNativeRecords(parsed.records as ClaudeNativeRecord[], {
            sourcePath: filePath,
            inferredComplete: eligibility.inferredComplete || eligibility.completed
          });
        files.push({
          path: filePath,
          provider,
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
          events
        });
        warnings.push(...parsed.warnings);
      } catch (error) {
        warnings.push({ code: `${provider}-native-parse-failed`, message: (error as Error).message, path: filePath });
      }
    }
  }

  return { files, skipped, seenPaths, warnings };
}

async function readNativeJsonl(filePath: string): Promise<{
  records: Array<{ line: number; record: Record<string, unknown> }>;
  warnings: UsageWarning[];
}> {
  const text = await readFile(filePath, "utf8");
  const records: Array<{ line: number; record: Record<string, unknown> }> = [];
  const warnings: UsageWarning[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as unknown;
      if (record && typeof record === "object" && !Array.isArray(record)) records.push({ line: index + 1, record: record as Record<string, unknown> });
    } catch (error) {
      warnings.push({ code: "invalid-native-jsonl", message: `line ${index + 1}: ${(error as Error).message}`, path: filePath });
    }
  }
  return { records, warnings };
}

function codexEligibility(records: Array<{ record: Record<string, unknown> }>, mtimeMs: number, now: Date): {
  eligible: boolean;
  completed: boolean;
  inferredComplete: boolean;
} {
  const completed = records.some((row) => {
    const payload = objectValue(row.record.payload);
    return stringValue(row.record.type) === "event_msg" && stringValue(payload?.type) === "task_complete";
  });
  const quiet = isQuiet(records, mtimeMs, now);
  const inferredComplete = !completed && quiet && !lastRecordIsUser(records, "codex");
  return { eligible: completed || inferredComplete, completed, inferredComplete };
}

function claudeEligibility(records: Array<{ record: Record<string, unknown> }>, mtimeMs: number, now: Date): {
  eligible: boolean;
  completed: boolean;
  inferredComplete: boolean;
} {
  const inferredComplete = isQuiet(records, mtimeMs, now) && !lastRecordIsUser(records, "claude");
  return { eligible: inferredComplete, completed: false, inferredComplete };
}

function isQuiet(records: Array<{ record: Record<string, unknown> }>, mtimeMs: number, now: Date): boolean {
  const latestTimestamp = Math.max(0, ...records.map((row) => timestampMs(row.record)).filter((value) => value > 0));
  const latest = Math.max(latestTimestamp, mtimeMs);
  return latest > 0 && now.getTime() - latest >= nativeQuietMs;
}

function lastRecordIsUser(records: Array<{ record: Record<string, unknown> }>, provider: UsageProvider): boolean {
  for (const row of [...records].reverse()) {
    const type = stringValue(row.record.type);
    const payload = objectValue(row.record.payload);
    if (provider === "codex") {
      if (type === "event_msg" && stringValue(payload?.type) === "user_message") return true;
      if (type === "event_msg" && stringValue(payload?.type) === "agent_message") return false;
      if (type === "response_item") {
        const role = stringValue(payload?.role);
        if (role === "user") return true;
        if (role === "assistant") return false;
      }
      continue;
    }
    if (type === "user") return true;
    if (type === "assistant") return false;
  }
  return false;
}

function timestampMs(record: Record<string, unknown>): number {
  const timestamp = stringValue(record.timestamp) || stringValue(record.created_at);
  const ms = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
