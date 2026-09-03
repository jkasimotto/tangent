// The roving-tabindex arithmetic of the Listbox, kept pure so it is tested under Node.
//
// A listbox is one tab stop. Exactly one option carries tabIndex 0 (the selected one, else the
// first) and the arrow keys, Home and End move focus between options. This module answers which
// option is the tab stop and where a key moves focus; `Listbox.tsx` applies the answers to the DOM.
// Movement clamps at the ends rather than wrapping, the simplest behaviour consistent with the
// design, which is silent on wrapping.

import type { Count, Index } from "../units/units.ts";
import { index } from "../units/units.ts";

/** The keys that move focus inside a listbox. */
export type RovingKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

const ROVING_KEYS: ReadonlySet<string> = new Set<RovingKey>(["ArrowDown", "ArrowUp", "Home", "End"]);

/** True when a key name moves focus inside a listbox. */
export function isRovingKey(key: string): key is RovingKey {
  return ROVING_KEYS.has(key);
}

/** The last valid index of a list, or null when it is empty. */
function lastIndex(total: Count): Index | null {
  return total > 0 ? index(total - 1) : null;
}

/** Keeps a candidate position inside the list. Assumes the list is not empty. */
function clampIndex(candidate: Index, total: Count): Index {
  const last = lastIndex(total) ?? index(0);
  return index(Math.min(Math.max(candidate, 0), last));
}

/**
 * The option that carries tabIndex 0 so Tab enters the list once: the selected option when it is in
 * the list, else the first option, or null when the list is empty.
 */
export function tabStop(selected: Index | null, total: Count): Index | null {
  if (lastIndex(total) === null) return null;
  if (selected === null) return index(0);
  return clampIndex(selected, total);
}

/** Where a roving key moves focus from `current`, clamped to the ends of the list. */
export function rovingTarget(current: Index, total: Count, key: RovingKey): Index {
  if (key === "Home") return index(0);
  if (key === "End") return lastIndex(total) ?? index(0);
  const step = key === "ArrowDown" ? 1 : -1;
  return clampIndex(index(current + step), total);
}
