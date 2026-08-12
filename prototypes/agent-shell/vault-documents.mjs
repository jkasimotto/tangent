import { createHash } from "node:crypto";
import path from "node:path";

/** Stable content identity used by conflict-safe document saves. */
export const documentHash = (text) => createHash("sha256").update(text).digest("hex");

/** Removes Markdown regions in which wiki-link syntax is literal. */
export function proseOnly(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** Returns normalized [[target]] / [[target|label]] targets in prose. */
export function wikiLinks(text) {
  return [...proseOnly(text).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((match) => match[1].trim().replace(/\.md$/i, ""))
    .filter(Boolean);
}

/** Resolve a client-supplied vault-relative Markdown path without traversal. */
export function safeMarkdownPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || !relative.endsWith(".md")) return null;
  const normalized = path.posix.normalize(relative.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  const absolute = path.resolve(root, normalized);
  const prefix = path.resolve(root) + path.sep;
  return absolute.startsWith(prefix) ? { relative: normalized, absolute } : null;
}

/** Uses the first level-one heading as a document's display title. */
export function markdownTitle(text, fallback) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}
