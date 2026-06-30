import type { ContentMode } from "./schema/usage-jsonl-v1.js";

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|authorization|bearer|cookie)/i;

export type RedactionOptions = {
  contentMode: ContentMode;
  redactSecrets: boolean;
  maxStringBytes: number;
  maxToolResponseBytes: number;
};

export const defaultRedaction: RedactionOptions = {
  contentMode: "metadata-with-excerpts",
  redactSecrets: true,
  maxStringBytes: 4000,
  maxToolResponseBytes: 20000
};

/** Redacts or strips an arbitrary value according to the given content mode and secret-key rules. */
export function redactUnknown(value: unknown, options: RedactionOptions = defaultRedaction): unknown {
  if (options.contentMode === "metadata-only") return metadataOnly(value);
  return redactValue(value, options, undefined);
}

/** Truncates a text string to max characters, adding "..." if the string was trimmed. */
export function previewText(text: string, max = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

/** Recursively redacts secret-key values and enforces string byte limits on a value. */
function redactValue(value: unknown, options: RedactionOptions, key: string | undefined): unknown {
  if (options.redactSecrets && key && SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (value.length > options.maxStringBytes) return `${value.slice(0, options.maxStringBytes)}...`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options, undefined));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, options, entryKey)
      ])
    );
  }
  return value;
}

/** Replaces a value with a structural descriptor (type, length, or keys) for metadata-only mode. */
function metadataOnly(value: unknown): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return { type: "string", bytes: Buffer.byteLength(value) };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>) };
  return { type: typeof value };
}
