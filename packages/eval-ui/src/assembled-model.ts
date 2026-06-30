import type { EvalAssembledBlock } from "./client.js";

/** The verbatim concatenation of block texts (no provenance dividers), for copy. Joins block texts with "\n\n", not a byte-image of the original files. */
export function concatBlocks(blocks: EvalAssembledBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export type AssembledDiffStatus = "same" | "changed" | "left-only" | "right-only";
export type AssembledDiffRow = { source: string; kind: EvalAssembledBlock["kind"]; leftText?: string; rightText?: string; status: AssembledDiffStatus };

/** Concatenates a side's blocks by source (segments of one file rejoin), preserving first-seen order. */
function bySource(blocks: EvalAssembledBlock[]): { order: string[]; text: Map<string, string>; kind: Map<string, EvalAssembledBlock["kind"]> } {
  const order: string[] = [];
  const text = new Map<string, string>();
  const kind = new Map<string, EvalAssembledBlock["kind"]>();
  for (const block of blocks) {
    if (!text.has(block.source)) { order.push(block.source); text.set(block.source, block.text); kind.set(block.source, block.kind); }
    else text.set(block.source, `${text.get(block.source)}${block.text}`);
  }
  return { order, text, kind };
}

/** Aligns two sides' blocks by source so present-only and content differences are explicit. */
export function alignBySource(left: EvalAssembledBlock[], right: EvalAssembledBlock[]): AssembledDiffRow[] {
  const a = bySource(left);
  const b = bySource(right);
  const seen = new Set<string>();
  const rows: AssembledDiffRow[] = [];
  for (const source of [...a.order, ...b.order]) {
    if (seen.has(source)) continue;
    seen.add(source);
    const leftText = a.text.get(source);
    const rightText = b.text.get(source);
    const kind = (a.kind.get(source) || b.kind.get(source)) as EvalAssembledBlock["kind"];
    const status: AssembledDiffStatus = leftText === undefined ? "right-only" : rightText === undefined ? "left-only" : leftText === rightText ? "same" : "changed";
    rows.push({ source, kind, leftText, rightText, status });
  }
  return rows;
}
