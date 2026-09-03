// The Outline hang: the Area tree with its Blocks.

import type { Count, Index } from "../units/units.ts";

/** The words of the Outline. */
export const OUTLINE = {
  name: "Area hierarchy",
  title: "Map Outline",
  close: "Close",
  empty: "Nothing on the Map yet.",
  block: "Block",
  resources: "Resources",
  separator: " · ",
  noPrimaryAction: "No primary action.",
  /** One Area row: name, depth, fold or load state, block count. */
  areaRow(name: string, depth: Index, state: string, blocks: Count): string { return `${name} · depth ${depth + 1} · ${state} · ${blocks} blocks`; },
  /** The accessible name of one Block row: its facts, then what Enter does. */
  blockName(accessibleName: string, actionLabel: string | null): string { return `${accessibleName}. ${actionLabel ? `${actionLabel} with Enter.` : this.noPrimaryAction}`; },
  /** The visible tail of one Block row after its kind: label, state words, action label. */
  blockRow(label: string, stateText: readonly string[], actionLabel: string | null): string {
    return `${this.separator}${label}${stateText.length ? `${this.separator}${stateText.join(this.separator)}` : ""}${actionLabel ? `${this.separator}${actionLabel}` : ""}`;
  },
} as const;
