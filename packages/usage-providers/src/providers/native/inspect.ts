import { readFile } from "node:fs/promises";

import type { UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import type { NativeLogInspection, NativeLogKind, NativeRecordVariant } from "./types.js";

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

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch (error) {
      parseErrors.push({ line: index + 1, message: (error as Error).message });
      continue;
    }
    recordCount += 1;
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const item = record as Record<string, unknown>;
    const detected = detectNativeLog(item);
    provider ||= detected.provider;
    logKind ||= detected.logKind;
    increment(variants, variantKey(item, detected.provider));
    collectHints(item, detected.provider, versions, models, origins, sources);
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

function detectNativeLog(record: Record<string, unknown>): { provider?: UsageProvider; logKind?: NativeLogKind } {
  const type = stringValue(record.type);
  if (type === "session_meta" || type === "turn_context" || type === "response_item" || type === "event_msg" || type === "compacted") {
    return { provider: "codex", logKind: "codex.rollout" };
  }
  if (record.sessionId || record.uuid || record.message || type === "assistant" || type === "user" || type === "system") {
    return { provider: "claude", logKind: "claude.conversation" };
  }
  return {};
}

function variantKey(record: Record<string, unknown>, provider?: UsageProvider): string {
  const type = stringValue(record.type) || "<missing>";
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

  addVersion(versions, record.version);
  addString(models, record.model);
  const message = objectValue(record.message);
  addString(models, message?.model);
}

function addVersion(values: Map<string, string | number>, value: unknown): void {
  if (typeof value !== "string" && typeof value !== "number") return;
  values.set(String(value), value);
}

function addString(values: Set<string>, value: unknown): void {
  if (typeof value === "string" && value) values.add(value);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function mapVariants(values: Map<string, number>): NativeRecordVariant[] {
  return [...values.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

