import { cleanText } from "./text-format.js";

/** Matches a line that opens a fenced code block. */
export const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([\w+.#-]*)\s*$/;

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

/**
 * Scans the reader's small Markdown block set and keeps exact source bounds.
 * Rendering and clean-copy mapping use these identities; `data-line` remains
 * the separate comment-anchor contract.
 */
export function scanMarkdownBlocks(text) {
  const source = visibleMarkdown(text);
  const lineOffset = frontmatterLineCount(text);
  const lines = source.split("\n");
  const starts = [];
  let cursor = 0;
  for (const line of lines) { starts.push(cursor); cursor += line.length + 1; }
  const blocks = [];
  /** Adds one exact structural block to the ordered scan. */
  const add = (type, first, last, detail = {}) => blocks.push({
    id: String(blocks.length), type, firstLine: first + lineOffset, lastLine: last + lineOffset,
    sourceStart: starts[first], sourceEnd: starts[last] + lines[last].length,
    raw: lines.slice(first, last + 1).join("\n"), detail,
  });
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.trim()) continue;
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const closer = fenceCloser(fence[1]);
      let last = index + 1;
      while (last < lines.length && !closer.test(lines[last].trimEnd())) last += 1;
      if (last >= lines.length) last = lines.length - 1;
      add("code", index, last, { fence: fence[1], language: fence[2] || "", bodyStart: index + 1, bodyEnd: closer.test(lines[last]?.trimEnd() ?? "") ? last - 1 : last });
      index = last;
      continue;
    }
    const alignments = line.includes("|") ? markdownTableAlignments(lines[index + 1] ?? "") : null;
    const headers = alignments ? markdownTableCells(line) : [];
    if (alignments && headers.length === alignments.length) {
      let last = index + 1;
      while (last + 1 < lines.length && lines[last + 1].includes("|") && lines[last + 1].trim()) {
        if (markdownTableCells(lines[last + 1]).length !== headers.length) break;
        last += 1;
      }
      add("table", index, last, { headers, alignments, rows: [headers, ...lines.slice(index + 2, last + 1).map(markdownTableCells)] });
      index = last;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const list = line.match(/^(\s*)([-*]|\d+[.)])\s+(.+)$/);
    const quote = line.match(/^(\s*(?:>\s*)+)(.*)$/);
    if (heading) add("heading", index, index, { level: heading[1].length, content: heading[2] });
    else if (list) add("list", index, index, { indent: list[1].length, marker: list[2], content: list[3] });
    else if (quote) add("quote", index, index, { prefix: quote[1], content: quote[2] });
    else add("paragraph", index, index, { content: line });
  }
  return blocks;
}
