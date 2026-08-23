/** Matches a line that opens a fenced code block. */
export const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([\w+.#-]*)\s*$/;

/** Removes display Markdown and collapses whitespace. */
function cleanText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes frontmatter from Markdown before display or structural analysis. */
export function visibleMarkdown(text) {
  return String(text ?? "").replace(/\r/g, "").replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
}

/** Creates a stable local anchor from one Markdown heading. */
export function markdownHeadingAnchor(value, seen) {
  const base = cleanText(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

/** Returns the regex that closes a given fence marker. */
export function fenceCloser(marker) {
  return new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
}

/** Flags lines inside fenced code, including the opening and closing lines. */
export function fencedLineFlags(lines) {
  const flags = new Array(lines.length).fill(false);
  let close = null;
  for (const [index, line] of lines.entries()) {
    const text = line.trimEnd();
    if (close) {
      flags[index] = true;
      if (close.test(text)) close = null;
      continue;
    }
    const fence = text.match(FENCE_OPEN);
    if (!fence) continue;
    flags[index] = true;
    close = fenceCloser(fence[1]);
  }
  return flags;
}

/** Returns the visible heading hierarchy with renderer-compatible anchors. */
export function markdownHeadings(text) {
  const seen = new Map();
  const offset = frontmatterLineCount(text);
  const lines = visibleMarkdown(text).split("\n");
  const fenced = fencedLineFlags(lines);
  return lines.flatMap((line, index) => {
    if (fenced[index]) return [];
    const match = line.trimEnd().match(/^(#{1,4})\s+(.+)$/);
    if (!match) return [];
    return [{ level: match[1].length, title: cleanText(match[2]), id: markdownHeadingAnchor(match[2], seen), line: index + offset }];
  });
}

/** Returns the number of source lines removed with frontmatter. */
export function frontmatterLineCount(text) {
  const full = String(text ?? "").replace(/\r/g, "").split("\n").length;
  return full - visibleMarkdown(text).split("\n").length;
}

/** Splits a Markdown table row without treating escaped pipes as columns. */
export function markdownTableCells(value) {
  const escapedPipe = "\u0000";
  let row = String(value ?? "").trim().replace(/\\\|/g, escapedPipe);
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim().replaceAll(escapedPipe, "|"));
}

/** Returns alignment names when one row is a valid Markdown separator. */
export function markdownTableAlignments(value) {
  const cells = markdownTableCells(value);
  if (cells.length < 2 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
}
