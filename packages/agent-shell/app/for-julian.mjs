// The `## For Julian` section of an Area brain's plan Document (design
// contract: otto/tangent/design-the-for-you-row-shows-only-direct-asks,
// solution: otto/tangent/impl-the-for-you-row-shows-only-direct-asks; it
// replaces the shapes of impl-what-needs-julian-under-brains, section 3.1).
// Julian answers two things: he decides, or he tests. So the section holds
// two line shapes, `Decide` and `Test`, and a Decide line that does not ask a
// question does not parse at all. This module is the one place that knows
// those shapes, and it also reports the lines it did not parse, so hiding a
// line is never silent. It is pure: no file system, no server.

/** The section heading the brain writes, without the `## `. */
export const FOR_JULIAN_SECTION = "For Julian";

/** A targeted Decide row: a Document with a question that needs Julian's word. `Decision` is the old name. */
const DECIDE_TARGET = /^\s*[-*]\s+(?:Decide|Decision)\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*:\s*(.+)$/;

/** A Test row: a landed Goal for Julian to press. `Try it` is the old name. */
const TEST = /^\s*[-*]\s+(?:Test|Try it)\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*:\s*(.+)$/;

/** A targetless Decide row: one question that fits no Document. `Brain` is the old name. */
const DECIDE_FREE = /^\s*[-*]\s+(?:Decide|Brain)\s*:\s*(.+)$/;

/** Splits the words after a Decide colon into what it asks and what it unblocks. */
const UNBLOCKS = /\bUnblocks:\s*/i;

/** A line that starts a row of its own, rather than continuing the one above. */
const BULLET = /^\s*[-*]\s/;

/**
 * The body line range of the `## <name>` section, as `[start, end)` into
 * `lines`. Same rule as `noteSection` in the server: the first heading whose
 * text starts with the name, up to the next `## `. `start` is -1 when the
 * section is absent.
 */
function sectionBody(lines, name) {
  const heading = lines.findIndex((line) => line.startsWith(`## ${name}`));
  if (heading === -1) return { start: -1, end: -1 };
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return { start: heading + 1, end };
}

/** Drops one trailing period so a sentence and a phrase read the same. */
function withoutTrailingPeriod(text) {
  return text.trim().replace(/\.$/, "").trim();
}

/** Normalizes a wiki link target to a vault stem: no `.md`, no backslashes. */
function linkStem(target) {
  return String(target ?? "").trim().replaceAll("\\", "/").replace(/\.md$/i, "");
}

/**
 * Parses one plan line into a row, or returns null when the line is in no
 * known shape. A Decide line whose ask does not end with a question mark is
 * in no known shape either: it states something instead of asking, so it can
 * never become a row on Julian's desk. Unknown lines are not errors, but
 * they are never silent: `unparsedForJulianLines` lists them and
 * `tangent brain status` prints them.
 */
function parseLine(line, index) {
  const targeted = DECIDE_TARGET.exec(line);
  if (targeted) {
    const [asked, unblocks] = targeted[2].split(UNBLOCKS);
    const text = String(asked ?? "").trim();
    if (!text.endsWith("?")) return null;
    return {
      kind: "decide",
      target: linkStem(targeted[1]),
      text,
      unblocks: unblocks && unblocks.trim() ? withoutTrailingPeriod(unblocks) : null,
      line,
      index,
    };
  }
  const test = TEST.exec(line);
  if (test) {
    return {
      kind: "test",
      target: linkStem(test[1]).replace(/^goal-/, ""),
      text: test[2].trim(),
      unblocks: null,
      line,
      index,
    };
  }
  const free = DECIDE_FREE.exec(line);
  if (free) {
    const text = free[1].trim();
    if (!text.endsWith("?")) return null;
    return { kind: "decide", target: null, text, unblocks: null, line, index };
  }
  return null;
}

/**
 * Parses the `## For Julian` section of one plan text into rows, in order.
 * Returns [] when the section is absent or empty.
 * Row shape: { kind, target, text, unblocks, line, index }
 *   kind: "decide" | "test"
 *   target: the wiki link inside [[...]] (decide: Document; test: Goal slug),
 *     or null for a Decide that names no Document
 *   text: the ask, or what to press, without a trailing "Unblocks: ..." part;
 *     a Decide ask keeps its question mark
 *   unblocks: the words after "Unblocks:" (a targeted Decide only), or null
 *   line: the exact source line, untrimmed, for removal and restore
 *   index: the 0-based line number inside the section body
 */
export function parseForJulian(planText) {
  const lines = String(planText ?? "").split("\n");
  const { start, end } = sectionBody(lines, FOR_JULIAN_SECTION);
  if (start === -1) return [];
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const row = parseLine(lines[i], i - start);
    if (row) rows.push(row);
  }
  return rows;
}

/** The body of the `## For Julian` section as text, or "" when it is absent. */
export function forJulianSectionText(planText) {
  const lines = String(planText ?? "").split("\n");
  const { start, end } = sectionBody(lines, FOR_JULIAN_SECTION);
  if (start === -1) return "";
  return lines.slice(start, end).join("\n");
}

/**
 * Every line of the section that becomes no row: prose, a bullet in an
 * unknown shape, and a Decide line that states instead of asking. A Test
 * entry may wrap to a second line with no bullet of its own; such a
 * continuation belongs to the row above and is not reported.
 * Returns [{ line, index }], the exact line text and its 0-based index
 * inside the section body. This is what Tangent tells the brain it hid.
 */
export function unparsedForJulianLines(planText) {
  const lines = String(planText ?? "").split("\n");
  const { start, end } = sectionBody(lines, FOR_JULIAN_SECTION);
  if (start === -1) return [];
  const parsed = new Set(parseForJulian(planText).map((row) => row.index));
  const unparsed = [];
  for (let i = start; i < end; i += 1) {
    const index = i - start;
    if (!lines[i].trim() || parsed.has(index)) continue;
    if (parsed.has(index - 1) && !BULLET.test(lines[i])) continue;
    unparsed.push({ line: lines[i], index });
  }
  return unparsed;
}

/**
 * Removes the first line of the section that equals `line` exactly. A Test
 * entry can wrap to a second, indented line with no bullet of its own (the
 * brain writes "two lines at most"); when the removed line is followed by
 * one, it leaves with it, so no dangling continuation stays behind.
 * Returns { text, removed: true, index, removedText } (removedText is the
 * one or two removed lines, joined by "\n") or
 * { text: planText, removed: false, index: -1, removedText: "" }.
 */
export function removeForJulianLine(planText, line) {
  const original = String(planText ?? "");
  const wanted = String(line ?? "").trimEnd();
  if (!wanted) return { text: original, removed: false, index: -1, removedText: "" };
  const lines = original.split("\n");
  const { start, end } = sectionBody(lines, FOR_JULIAN_SECTION);
  if (start === -1) return { text: original, removed: false, index: -1, removedText: "" };
  for (let i = start; i < end; i += 1) {
    if (lines[i].trimEnd() !== wanted) continue;
    const next = lines[i + 1];
    const hasContinuation = i + 1 < end && next !== undefined && next.trim() !== "" && !BULLET.test(next);
    const removedLines = hasContinuation ? [lines[i], next] : [lines[i]];
    const kept = [...lines.slice(0, i), ...lines.slice(i + removedLines.length)];
    return { text: kept.join("\n"), removed: true, index: i - start, removedText: removedLines.join("\n") };
  }
  return { text: original, removed: false, index: -1, removedText: "" };
}

/**
 * Puts `line` back into the section at `index` (clamped to the section's
 * length). Creates the section at the end of the text when it is absent.
 * Returns the new text.
 */
export function restoreForJulianLine(planText, line, index) {
  const original = String(planText ?? "");
  const lines = original.split("\n");
  const { start, end } = sectionBody(lines, FOR_JULIAN_SECTION);
  if (start === -1) {
    const base = original.replace(/\n+$/, "");
    return `${base}\n\n## ${FOR_JULIAN_SECTION}\n\n${line}\n`;
  }
  const at = start + Math.min(Math.max(Number(index) || 0, 0), end - start);
  return [...lines.slice(0, at), line, ...lines.slice(at)].join("\n");
}
