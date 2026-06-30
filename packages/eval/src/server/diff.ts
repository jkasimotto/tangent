import type { EvalDiffLineView } from "./types.js";

/**
 * Builds a line-oriented diff view for two text values.
 *
 * The LCS table is O(n*m) in time and memory, which is pathological for large near-identical files (e.g.
 * an 8000-line source file with a 30-line edit costs ~64M cells and seconds of work). Common leading and
 * trailing lines are stripped first so the quadratic step runs only over the region that actually differs,
 * making the typical small edit in a large file near-instant; the trimmed lines are emitted as equal rows.
 */
export function diffLines(left: string, right: string): EvalDiffLineView[] {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);

  let prefix = 0;
  while (prefix < leftLines.length && prefix < rightLines.length && leftLines[prefix] === rightLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < leftLines.length - prefix &&
    suffix < rightLines.length - prefix &&
    leftLines[leftLines.length - 1 - suffix] === rightLines[rightLines.length - 1 - suffix]
  ) suffix += 1;

  const rows: EvalDiffLineView[] = [];
  for (let index = 0; index < prefix; index += 1) {
    rows.push({ kind: "equal", leftNumber: index + 1, rightNumber: index + 1, left: leftLines[index], right: rightLines[index] });
  }
  // Diff only the differing middle, then shift its 1-based line numbers back to absolute positions.
  for (const row of diffMiddle(leftLines.slice(prefix, leftLines.length - suffix), rightLines.slice(prefix, rightLines.length - suffix))) {
    rows.push({
      ...row,
      leftNumber: row.leftNumber === undefined ? undefined : row.leftNumber + prefix,
      rightNumber: row.rightNumber === undefined ? undefined : row.rightNumber + prefix
    });
  }
  for (let index = 0; index < suffix; index += 1) {
    const leftIndex = leftLines.length - suffix + index;
    const rightIndex = rightLines.length - suffix + index;
    rows.push({ kind: "equal", leftNumber: leftIndex + 1, rightNumber: rightIndex + 1, left: leftLines[leftIndex], right: rightLines[rightIndex] });
  }
  return pairChangedLines(rows);
}

/** LCS-aligns the differing region into equal/add/delete rows with 1-based numbers local to that region. */
function diffMiddle(leftLines: string[], rightLines: string[]): EvalDiffLineView[] {
  const table = lcsTable(leftLines, rightLines);
  const rows: EvalDiffLineView[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (leftIndex < leftLines.length && rightIndex < rightLines.length && leftLines[leftIndex] === rightLines[rightIndex]) {
      rows.push({
        kind: "equal",
        leftNumber: leftIndex + 1,
        rightNumber: rightIndex + 1,
        left: leftLines[leftIndex],
        right: rightLines[rightIndex]
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex < rightLines.length && (leftIndex === leftLines.length || table[leftIndex]![rightIndex + 1]! >= table[leftIndex + 1]![rightIndex]!)) {
      rows.push({ kind: "add", rightNumber: rightIndex + 1, right: rightLines[rightIndex] });
      rightIndex += 1;
    } else if (leftIndex < leftLines.length) {
      rows.push({ kind: "delete", leftNumber: leftIndex + 1, left: leftLines[leftIndex] });
      leftIndex += 1;
    }
  }
  return rows;
}

/** Collapses adjacent add/delete rows into changed rows. */
function pairChangedLines(rows: EvalDiffLineView[]): EvalDiffLineView[] {
  const paired: EvalDiffLineView[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const next = rows[index + 1];
    if (row.kind === "delete" && next?.kind === "add") {
      paired.push({ kind: "changed", leftNumber: row.leftNumber, rightNumber: next.rightNumber, left: row.left, right: next.right });
      index += 1;
    } else if (row.kind === "add" && next?.kind === "delete") {
      paired.push({ kind: "changed", leftNumber: next.leftNumber, rightNumber: row.rightNumber, left: next.left, right: row.right });
      index += 1;
    } else {
      paired.push(row);
    }
  }
  return paired;
}

/** Splits text into comparable lines without retaining a final empty line. */
function splitLines(value: string): string[] {
  if (!value) return [];
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

/** Builds a longest-common-subsequence lookup table. */
function lcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex]![rightIndex] = left[leftIndex] === right[rightIndex]
        ? table[leftIndex + 1]![rightIndex + 1]! + 1
        : Math.max(table[leftIndex + 1]![rightIndex]!, table[leftIndex]![rightIndex + 1]!);
    }
  }
  return table;
}
