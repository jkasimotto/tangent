import { readFile, stat } from "node:fs/promises";

import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { discoverClaudeNative } from "../claude/native/discover.js";
import { normalizeClaudeNativeRecords, type ClaudeNativeRecord } from "../claude/native/normalize.js";
import { discoverCodexNative } from "../codex/native/discover.js";
import { normalizeCodexNativeRecords, type CodexNativeRecord } from "../codex/native/normalize.js";
import { buildGeminiProjectMap, discoverGeminiNative, geminiDirOf, resolveGeminiCwd, type GeminiProjectMap } from "../gemini/native/discover.js";
import { readGeminiNative } from "../gemini/native/read.js";
import { normalizeGeminiNativeRecords, type GeminiNativeRecord } from "../gemini/native/normalize.js";

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

/** Discovers, parses, and normalizes native transcripts for the requested providers. */
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

  const geminiMap: GeminiProjectMap | undefined = options.providers.includes("gemini") ? await buildGeminiProjectMap() : undefined;

  for (const provider of options.providers) {
    const paths = await discoverNative(provider, options.repoRoot);
    for (const filePath of paths) {
      seenPaths.push(filePath);
      try {
        const fileStat = await stat(filePath);
        const source = { path: filePath, provider, mtimeMs: fileStat.mtimeMs, size: fileStat.size };
        if (options.skipUnchanged?.(source)) {
          skipped.push(source);
          continue;
        }
        const parsed = provider === "gemini" ? await readGeminiNative(filePath) : await readNativeJsonl(filePath);
        const eligibility = provider === "codex"
          ? codexEligibility(parsed.records, fileStat.mtimeMs, now)
          : nonMarkerEligibility(parsed.records, fileStat.mtimeMs, now, provider);
        if (!eligibility.eligible) continue;
        const events = provider === "codex"
          ? normalizeCodexNativeRecords(parsed.records as CodexNativeRecord[], {
            sourcePath: filePath,
            completed: eligibility.completed,
            inferredComplete: eligibility.inferredComplete
          })
          : provider === "gemini"
            ? normalizeGeminiNativeRecords(parsed.records as GeminiNativeRecord[], {
              sourcePath: filePath,
              cwd: geminiCwd(parsed.records, filePath, geminiMap),
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

/** Dispatches native transcript discovery to the right provider walker. */
async function discoverNative(provider: UsageProvider, repoRoot?: string): Promise<string[]> {
  if (provider === "claude") return discoverClaudeNative(repoRoot);
  if (provider === "codex") return discoverCodexNative(repoRoot);
  return discoverGeminiNative(repoRoot);
}

/** Resolves a Gemini session's working directory from its header projectHash, falling back to its directory name. */
function geminiCwd(records: Array<{ record: Record<string, unknown> }>, filePath: string, map?: GeminiProjectMap): string | undefined {
  if (!map) return undefined;
  const header = records.find((row) => typeof row.record.sessionId === "string" && typeof row.record.type !== "string");
  const projectHash = typeof header?.record.projectHash === "string" ? header.record.projectHash : undefined;
  const dir = geminiDirOf(filePath);
  return resolveGeminiCwd(dir || "", projectHash, map);
}

/** Reads a JSONL transcript into object records, collecting warnings for unparseable lines. */
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

/** Decides whether a Codex transcript should be indexed, and whether it reads as complete. */
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
  // Index any session with content, including ones still in progress, so the live UI sees
  // active conversations. `completed`/`inferredComplete` stay quiet-gated and only add the
  // synthetic end markers once the transcript settles.
  return { eligible: records.length > 0, completed, inferredComplete };
}

/** Decides whether a transcript with no explicit completion marker (Claude, Gemini) should be indexed. */
function nonMarkerEligibility(records: Array<{ record: Record<string, unknown> }>, mtimeMs: number, now: Date, provider: UsageProvider): {
  eligible: boolean;
  completed: boolean;
  inferredComplete: boolean;
} {
  const inferredComplete = isQuiet(records, mtimeMs, now) && !lastRecordIsUser(records, provider);
  // Native Claude/Gemini transcripts have no explicit completion marker, so eligibility used to wait
  // for a 15-minute quiet window, which hid every active conversation from the live UI. Index
  // as soon as there is content; `inferredComplete` still gates the synthetic end markers.
  return { eligible: records.length > 0, completed: false, inferredComplete };
}

/** Returns whether the transcript's latest activity is older than the quiet window. */
function isQuiet(records: Array<{ record: Record<string, unknown> }>, mtimeMs: number, now: Date): boolean {
  const latestTimestamp = Math.max(0, ...records.map((row) => timestampMs(row.record)).filter((value) => value > 0));
  const latest = Math.max(latestTimestamp, mtimeMs);
  return latest > 0 && now.getTime() - latest >= nativeQuietMs;
}

/** Returns whether the last conversational turn was the user, used to avoid marking a waiting turn complete. */
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
    if (provider === "gemini") {
      if (type === "user") return true;
      if (type === "gemini") return false;
      continue;
    }
    if (type === "user") return true;
    if (type === "assistant") return false;
  }
  return false;
}

/** Parses a record's timestamp to epoch milliseconds, or 0 when absent or invalid. */
function timestampMs(record: Record<string, unknown>): number {
  const timestamp = stringValue(record.timestamp) || stringValue(record.created_at);
  const ms = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Narrows a value to a plain object, or undefined. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Narrows a value to a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
