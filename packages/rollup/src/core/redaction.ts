const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|authorization|bearer|cookie|session)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9+/]{32,}={0,2})\b/g;

/** Renders an unknown value as compact text for prompt and artifact previews. */
export function previewUnknown(value: unknown, maxChars: number, redactSecrets: boolean): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(redactUnknown(value, redactSecrets));
  return truncateCompact(redactSecrets ? redactText(text) : text, maxChars);
}

/** Redacts secret-looking fields and values from arbitrary structured input. */
export function redactUnknown(value: unknown, redactSecrets: boolean): unknown {
  if (!redactSecrets) return value;
  return redactValue(value, undefined);
}

/** Collapses whitespace and limits text to the requested character budget. */
export function truncateCompact(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, Math.max(0, maxChars - 3))}...` : compact;
}

/** Produces a compact excerpt, optionally redacting secret-looking text first. */
export function excerptText(text: string, maxChars: number, redactSecrets: boolean): string {
  return truncateCompact(redactSecrets ? redactText(text) : text, maxChars);
}

/** Redacts secret-looking text without truncating the message body. */
export function redactMessageText(text: string, redactSecrets: boolean): string {
  return redactSecrets ? redactText(text) : text;
}

/** Recursively redacts object fields and scalar values that look sensitive. */
function redactValue(value: unknown, key: string | undefined): unknown {
  if (key && SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey)
    ]));
  }
  return value;
}

/** Replaces secret-looking tokens inside a text string. */
function redactText(text: string): string {
  return text.replace(SECRET_VALUE_RE, "[REDACTED]");
}
