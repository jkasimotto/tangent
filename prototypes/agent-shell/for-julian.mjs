// The `## For Julian` section of an Area brain's plan Document (design
// contract: otto/tangent/impl-what-needs-julian-under-brains, section 3.1).
// Under a live brain the brain writes what waits on Julian; Tangent reads
// only this section and shows only three line shapes. This module is the one
// place that knows those shapes. It is pure: no file system, no server.

/** The section heading the brain writes, without the `## `. */
export const FOR_JULIAN_SECTION = "For Julian";

/** A Decision row: a Document with questions that need Julian's word. */
const DECISION = /^\s*[-*]\s+Decision\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*:\s*(.+)$/;

/** A Try it row: a landed Goal for Julian to press. */
const TRY_IT = /^\s*[-*]\s+Try it\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*:\s*(.+)$/;

/** A Brain row: one question that fits no Document. */
const BRAIN = /^\s*[-*]\s+Brain\s*:\s*(.+)$/;

/** Splits the words after a Decision colon into what it asks and what it unblocks. */
const UNBLOCKS = /\bUnblocks:\s*/i;

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
 * known shape. Unknown lines are not errors: the brain writes prose in the
 * same section, and `tangent brain status` shows what parsed.
 */
function parseLine(line, index) {
  const decision = DECISION.exec(line);
  if (decision) {
    const [asked, unblocks] = decision[2].split(UNBLOCKS);
    return {
      kind: "decision",
      target: linkStem(decision[1]),
      text: withoutTrailingPeriod(asked ?? ""),
      unblocks: unblocks && unblocks.trim() ? withoutTrailingPeriod(unblocks) : null,
      line,
      index,
    };
  }
  const tryIt = TRY_IT.exec(line);
  if (tryIt) {
    return {
      kind: "tryit",
      target: linkStem(tryIt[1]).replace(/^goal-/, ""),
      text: tryIt[2].trim(),
      unblocks: null,
      line,
      index,
    };
  }
  const brain = BRAIN.exec(line);
  if (brain) {
    return { kind: "brain", target: null, text: brain[1].trim(), unblocks: null, line, index };
  }
  return null;
}

/**
 * Parses the `## For Julian` section of one plan text into rows, in order.
 * Returns [] when the section is absent or empty.
 * Row shape: { kind, target, text, unblocks, line, index }
 *   kind: "decision" | "tryit" | "brain"
 *   target: the wiki link inside [[...]] (decision: Document; tryit: Goal slug), or null for brain
 *   text: the words after the colon, without a trailing "Unblocks: ..." part, trimmed
 *   unblocks: the words after "Unblocks:" (decision only), or null
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

/**
 * Removes the first line of the section that equals `line` exactly. A Try it
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
    const hasContinuation = i + 1 < end && next !== undefined && next.trim() !== "" && !/^\s*[-*]\s/.test(next);
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
