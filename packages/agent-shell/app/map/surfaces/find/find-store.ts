// The Find store: the query, the current match, whether the match stays revealed after the hang
// closes, and the view Cancel returns to. The reducer is pure: matching runs through the kernel in
// `find-effects.ts`, which hands the reducer how many rows the query found so the position can be
// clamped and wrapped here. The window of rows the hang shows is arithmetic over the position and
// the row count, sized by a layout token the render passes in.

import type { CapturedView } from "../../kernel/kernel-types.ts";
import { clamp } from "../../units/scalar-math.ts";
import type { Count, Index } from "../../units/units.ts";
import { count, index } from "../../units/units.ts";

/** Which way a step through the matches goes. */
export type FindDirection = "next" | "previous";

/** The store. `kept` is true while the current match stays highlighted on the Map after the hang closes. */
export type FindState = {
  readonly open: boolean;
  readonly query: string;
  readonly index: Index;
  readonly kept: boolean;
  /** The view captured when the hang opened; Cancel restores it, Enter forgets it. */
  readonly origin: CapturedView | null;
};

/** The closed set of things that can happen to Find. `total` is how many rows the query matched. */
export type FindAction =
  | { readonly kind: "open"; readonly origin: CapturedView }
  | { readonly kind: "set-query"; readonly query: string; readonly total: Count }
  | { readonly kind: "step"; readonly direction: FindDirection; readonly total: Count }
  | { readonly kind: "select"; readonly position: Index }
  | { readonly kind: "confirm" }
  | { readonly kind: "cancel" };

/** The rows of the match list the hang shows: `rows.slice(start, end)`. */
export type FindWindow = { readonly start: Index; readonly end: Index };

/** Find before it was ever opened. */
export const EMPTY_FIND_STATE: FindState = Object.freeze({ open: false, query: "", index: index(0), kept: false, origin: null });

/** The pure reducer: (state, action) -> state. */
export function findReducer(state: FindState, action: FindAction): FindState {
  switch (action.kind) {
    case "open": return state.open ? state : { ...state, open: true, kept: true, origin: action.origin };
    case "set-query": return { ...state, query: action.query, index: index(0), kept: action.total > 0 };
    case "step": return action.total > 0 ? { ...state, index: steppedFindIndex(state.index, action.direction, action.total), kept: true } : state;
    case "select": return { ...state, index: action.position, kept: true };
    case "confirm": return { ...state, open: false, kept: true, origin: null };
    case "cancel": return { ...state, open: false, kept: false, origin: null };
  }
}

/** The position of the current match, kept inside the rows the query found now. Zero when there are none. */
export function activeFindIndex(current: Index, total: Count): Index {
  return total > 0 ? clamp(current, index(0), index(total - 1)) : index(0);
}

/** The position one step from the current one, wrapping at either end. Zero when there are no rows. */
export function steppedFindIndex(current: Index, direction: FindDirection, total: Count): Index {
  if (total <= 0) return index(0);
  const step = direction === "next" ? 1 : -1;
  return index((activeFindIndex(current, total) + step + total) % total);
}

/** The row under the cursor while the hang is open or the match is kept, else null. */
export function activeFindRow<Row>(state: FindState, rows: readonly Row[]): Row | null {
  if (!state.open && !state.kept) return null;
  return rows[activeFindIndex(state.index, count(rows.length))] ?? null;
}

/**
 * The window of `size` rows that keeps the active row visible: the window ends at the active row
 * once the list is longer than the window, and never runs past the last row.
 */
export function findWindow(active: Index, total: Count, size: Count): FindWindow {
  const latestStart = Math.max(0, total - size);
  const start = index(Math.min(Math.max(0, active - size + 1), latestStart));
  return { start, end: index(Math.min(total, start + size)) };
}
