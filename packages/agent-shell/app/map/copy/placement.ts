// The placement bar shown while a resource Block waits for its point.

import type { KeyedText } from "./keyed-text.ts";
import { key } from "./keyed-text.ts";

/** The words of the placement bar and its preview Block. */
export const PLACEMENT = {
  /** The status printed on the dashed preview Block. */
  previewStatus: "Place with click or Enter",
  place: "Place",
  cancel: "Cancel",
  move: ["Move the pointer or use ", key("←"), key("↑"), key("↓"), key("→")] as KeyedText,
  commit: ["Click or ", key("Enter"), " to place · ", key("Esc"), " to cancel"] as KeyedText,
  /** The accessible name of the bar. */
  name(label: string): string { return `Place ${label} on the Map`; },
  /** The bar's heading: the resource and the Area it lands in. */
  title(label: string, areaName: string): string { return `Place ${label} in ${areaName}`; },
} as const;
