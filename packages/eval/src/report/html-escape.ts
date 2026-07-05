// HTML-escaping helpers shared by every HTML report section. Report text (judge reasoning, transcript
// prose, tool-call previews, file paths) comes from an LLM's own output or a user's prompt, so every
// interpolated value must be escaped before it reaches the page; nothing in this module is decorative.

/** Escapes the five HTML-significant characters in a string, so untrusted text is always safe as element content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes a string for safe use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Truncates a string to `maxChars`, appending an ellipsis marker when it was cut, before escaping. Keeps very long tool-output previews from bloating the report. */
export function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}… [truncated]`;
}
