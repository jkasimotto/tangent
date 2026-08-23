/** Escapes arbitrary text before it enters rendered HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Removes display Markdown and collapses whitespace. */
export function cleanText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clips readable text at a nearby word boundary. */
export function clip(value, length = 210) {
  const text = cleanText(value);
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, Math.max(boundary, length - 35))}…`;
}

/** Converts a progress note into a small set of readable points. */
export function progressPoints(text) {
  const units = String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n|\n(?=\s*[-*]\s+)/)
    .map((part) => cleanText(part.replace(/^\s*[-*]\s+/, "")))
    .filter((part) => part && !/^state$/i.test(part));
  const unique = [...new Set(units)];
  if (!unique.length) return ["No progress note exists yet."];
  if (unique.length <= 4) return unique.map((part) => clip(part));
  return [unique[0], unique[1], unique.at(-2), unique.at(-1)].map((part) => clip(part));
}
