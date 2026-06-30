import { readFile } from "node:fs/promises";

import type { UsageWarning } from "@tangent/usage-core/core/schema/usage-jsonl-v1";

export type GeminiNativeRecord = {
  line: number;
  record: Record<string, unknown>;
};

/**
 * Reads a Gemini CLI chat session into a uniform record stream, hiding the two on-disk formats from
 * the normalizer. Older sessions are a single JSON document `{ sessionId, projectHash, startTime,
 * messages: [...] }`; newer sessions are JSONL whose first line is that same header (minus messages)
 * followed by one message per line (plus `{ $set: ... }` update lines). Both are flattened to the
 * JSONL shape: record 1 is the session header, the rest are message (or update) records.
 */
export async function readGeminiNative(filePath: string): Promise<{
  records: GeminiNativeRecord[];
  warnings: UsageWarning[];
}> {
  const text = await readFile(filePath, "utf8");
  return filePath.endsWith(".jsonl") ? readJsonl(text, filePath) : readJsonDocument(text, filePath);
}

/** Parses a JSONL session: each non-empty line is one object record (header, message, or update). */
function readJsonl(text: string, filePath: string): { records: GeminiNativeRecord[]; warnings: UsageWarning[] } {
  const records: GeminiNativeRecord[] = [];
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

/** Parses a single-document session, splitting its header from its messages array into records. */
function readJsonDocument(text: string, filePath: string): { records: GeminiNativeRecord[]; warnings: UsageWarning[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { records: [], warnings: [{ code: "invalid-native-json", message: (error as Error).message, path: filePath }] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { records: [], warnings: [{ code: "invalid-native-json", message: "Gemini session is not a JSON object.", path: filePath }] };
  }
  const { messages, ...header } = parsed as Record<string, unknown>;
  const records: GeminiNativeRecord[] = [{ line: 1, record: header }];
  if (Array.isArray(messages)) {
    messages.forEach((message, index) => {
      if (message && typeof message === "object" && !Array.isArray(message)) records.push({ line: index + 2, record: message as Record<string, unknown> });
    });
  }
  return { records, warnings: [] };
}
