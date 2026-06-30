import { readFile } from "node:fs/promises";

import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import type { NativeLogInspection, NativeLogKind, NativeRecordVariant } from "./types.js";

/** Parses a native provider log file and returns a structural inspection summary. */
export async function inspectNativeLogFile(filePath: string): Promise<NativeLogInspection> {
  const text = await readFile(filePath, "utf8");
  const parseErrors: NativeLogInspection["parseErrors"] = [];
  const variants = new Map<string, number>();
  const versions = new Map<string, string | number>();
  const models = new Set<string>();
  const origins = new Set<string>();
  const sources = new Set<string>();
  let provider: UsageProvider | undefined;
  let logKind: NativeLogKind | undefined;
  let recordCount = 0;

  const { records } = readInspectableRecords(text, parseErrors);
  for (const item of records) {
    recordCount += 1;
    const detected = detectNativeLog(item);
    provider ||= detected.provider;
    logKind ||= detected.logKind;
    // Use the file-level provider once known, so records that are ambiguous on their own
    // (e.g. a Gemini `user` message) still classify under the format the header established.
    increment(variants, variantKey(item, provider || detected.provider));
    collectHints(item, provider || detected.provider, versions, models, origins, sources);
  }

  return {
    path: filePath,
    provider,
    logKind,
    recordCount,
    parseErrors,
    producerHints: {
      versions: [...versions.values()],
      models: [...models].sort(),
      origins: [...origins].sort(),
      sources: [...sources].sort()
    },
    variants: mapVariants(variants)
  };
}

/**
 * Reads a native log into object records for inspection, transparently handling the three on-disk
 * shapes: line-delimited JSONL (Claude, Codex, newer Gemini) and a single pretty-printed JSON
 * document (older Gemini `session-*.json`). A whole-text parse that yields an object with a
 * `messages` array is the single-document case; its header and messages become the records.
 */
function readInspectableRecords(text: string, parseErrors: NativeLogInspection["parseErrors"]): { records: Record<string, unknown>[] } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).messages)) {
        const { messages, ...header } = parsed as Record<string, unknown>;
        const records = [header, ...(messages as unknown[]).filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object" && !Array.isArray(message))];
        return { records };
      }
    } catch {
      // Not a single JSON document; fall through to line-delimited parsing.
    }
  }
  const records: Record<string, unknown>[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as unknown;
      if (record && typeof record === "object" && !Array.isArray(record)) records.push(record as Record<string, unknown>);
    } catch (error) {
      parseErrors.push({ line: index + 1, message: (error as Error).message });
    }
  }
  return { records };
}

/** Heuristically identifies the provider and log kind from a single record's fields. */
function detectNativeLog(record: Record<string, unknown>): { provider?: UsageProvider; logKind?: NativeLogKind } {
  const type = stringValue(record.type);
  if (type === "session_meta" || type === "turn_context" || type === "response_item" || type === "event_msg" || type === "compacted") {
    return { provider: "codex", logKind: "codex.rollout" };
  }
  if (type === "gemini" || record.projectHash !== undefined || record.$set !== undefined || record.thoughts !== undefined || record.toolCalls !== undefined) {
    return { provider: "gemini", logKind: "gemini.chat" };
  }
  if (record.sessionId || record.uuid || record.message || type === "assistant" || type === "user" || type === "system") {
    return { provider: "claude", logKind: "claude.conversation" };
  }
  return {};
}

/** Computes a variant key that describes a record's type within its provider format. */
function variantKey(record: Record<string, unknown>, provider?: UsageProvider): string {
  const type = stringValue(record.type) || "<missing>";
  if (provider === "gemini") {
    if (record.$set !== undefined) return "$set";
    return stringValue(record.type) || "session";
  }
  if (provider === "codex") {
    const payload = objectValue(record.payload);
    const payloadType = payload ? stringValue(payload.type) : undefined;
    return payloadType ? `${type}:${payloadType}` : type;
  }
  if (provider === "claude") {
    const message = objectValue(record.message);
    const messageType = message ? stringValue(message.type) : undefined;
    const role = message ? stringValue(message.role) : undefined;
    return [type, role, messageType].filter(Boolean).join(":") || type;
  }
  return type;
}

/** Collects version, model, origin, and source hints from a single provider record. */
function collectHints(
  record: Record<string, unknown>,
  provider: UsageProvider | undefined,
  versions: Map<string, string | number>,
  models: Set<string>,
  origins: Set<string>,
  sources: Set<string>
): void {
  if (provider === "codex") {
    const payload = objectValue(record.payload);
    addVersion(versions, payload?.cli_version);
    addString(origins, payload?.originator);
    addString(sources, payload?.source);
    addString(models, payload?.model);
    const collaboration = objectValue(payload?.collaboration_mode);
    const settings = objectValue(collaboration?.settings);
    addString(models, settings?.model);
    return;
  }

  if (provider === "gemini") {
    addString(models, record.model);
    return;
  }

  addVersion(versions, record.version);
  addString(models, record.model);
  const message = objectValue(record.message);
  addString(models, message?.model);
}

/** Adds a version string or number to the versions map, keyed by its string representation. */
function addVersion(values: Map<string, string | number>, value: unknown): void {
  if (typeof value !== "string" && typeof value !== "number") return;
  values.set(String(value), value);
}

/** Adds a non-empty string value to the given set, ignoring non-strings and empty strings. */
function addString(values: Set<string>, value: unknown): void {
  if (typeof value === "string" && value) values.add(value);
}

/** Increments the count for the given map key, initializing it to zero if absent. */
function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

/** Converts a variant count map to a sorted array of NativeRecordVariant objects. */
function mapVariants(values: Map<string, number>): NativeRecordVariant[] {
  return [...values.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/** Returns the value as a plain object, or undefined if it is an array or non-object. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Returns the value as a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

