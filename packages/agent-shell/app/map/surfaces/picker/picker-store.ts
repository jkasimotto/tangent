// The picker store: where the picker opened (the Area under the pointer, the scene point a Block
// lands at, whether that point is outside every Area, and which side of the Map the dialog docks
// to), the typed query, whether the whole vault is shown, and the vault search results. The
// reducer is pure: the kernel's choices and the placement run in `picker-effects.ts`.

import type { VaultDocument } from "../../kernel/kernel-types.ts";
import type { Point, Rect } from "../../units/frames.ts";
import type { AreaKey } from "../../units/ids.ts";
import { rectContains } from "../../units/scalar-math.ts";
import { scenePx } from "../../units/units.ts";

/** Where a new Block lands: the deepest visible Area under the point, and the point itself. */
export type PlacementSpot = { readonly area: AreaKey; readonly point: Point<"scene"> };

/** The side of the Map the dialog docks to, away from the pointer. */
export type PickerDock = "left" | "right";

/** Everything the picker remembers about where it opened. */
export type PickerTarget = PlacementSpot & {
  /** True when the point is outside every Area region, so the heading says so. */
  readonly outside: boolean;
  readonly dock: PickerDock;
};

/** The store. The picker is open while `target` is set. */
export type PickerState = {
  readonly target: PickerTarget | null;
  readonly query: string;
  /** True while the whole vault is searched instead of the target Area's context. */
  readonly wide: boolean;
  /** The vault search results for the wide picker, merged over the known documents. */
  readonly entities: readonly VaultDocument[];
};

/** The closed set of things that can happen to the picker. */
export type PickerAction =
  | { readonly kind: "open"; readonly target: PickerTarget }
  | { readonly kind: "close" }
  | { readonly kind: "set-query"; readonly query: string }
  | { readonly kind: "toggle-wide" }
  | { readonly kind: "set-entities"; readonly entities: readonly VaultDocument[] }
  /** A Block was placed: the query clears, and the picker stays open only for "place another". */
  | { readonly kind: "placed"; readonly keepOpen: boolean };

/** The picker before it was ever opened. */
export const EMPTY_PICKER_STATE: PickerState = Object.freeze({ target: null, query: "", wide: false, entities: Object.freeze([]) });

/** The pure reducer: (state, action) -> state. */
export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.kind) {
    case "open": return { ...state, target: action.target, query: "", wide: false };
    case "close": return state.target === null && state.query === "" ? state : { ...state, target: null, query: "" };
    case "set-query": return state.query === action.query ? state : { ...state, query: action.query };
    case "toggle-wide": return { ...state, wide: !state.wide };
    case "set-entities": return { ...state, entities: action.entities };
    case "placed": return action.keepOpen ? { ...state, query: "" } : { ...state, target: null, query: "" };
  }
}

/** True while the picker is open. */
export function isPickerOpen(state: PickerState): boolean {
  return state.target !== null;
}

/**
 * Where the picker opens from a placement spot: outside when no region holds the point, docked to
 * the right when the point sits on the left half of the view so the dialog never covers it.
 */
export function pickerTarget(spot: PlacementSpot, regionRects: readonly Rect<"scene">[], viewportCenter: Point<"scene">): PickerTarget {
  const outside = !regionRects.some((box) => rectContains(box, spot.point, scenePx(0)));
  return { area: spot.area, point: spot.point, outside, dock: spot.point.x < viewportCenter.x ? "right" : "left" };
}
