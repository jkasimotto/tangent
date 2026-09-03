// The Find hang: the input, the position, the result rows and the key line.

import type { Count, Index } from "../units/units.ts";
import type { KeyedText } from "./keyed-text.ts";
import { key } from "./keyed-text.ts";

/** The words of the Find surface. */
export const FIND = {
  name: "Find on the map",
  placeholder: "Area name or path",
  noMatch: "No match",
  previous: "Previous match",
  previousGlyph: "↑",
  next: "Next match",
  nextGlyph: "↓",
  cancel: "Cancel",
  hidden: "hidden",
  /** The escape hint the shell shows while Show on Map holds the view. */
  escapeReturnsFromShow: "Esc returns from Show on Map",
  /** "3 of 12" beside the input, from the zero-based position. */
  position(current: Index, total: Count): string { return `${current + 1} of ${total}`; },
  keys: [key("↓"), " next · ", key("↑"), " previous · ", key("↵"), " keep · ", key("Esc"), " cancel"] as KeyedText,
} as const;
