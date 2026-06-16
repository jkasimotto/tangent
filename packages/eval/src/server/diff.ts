import type { EvalDiffLineView } from "./types.js";

/** Builds a line-oriented diff view for two text values. */
export function diffLines(left: string, right: string): EvalDiffLineView[] {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);
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
  return pairChangedLines(rows);
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
