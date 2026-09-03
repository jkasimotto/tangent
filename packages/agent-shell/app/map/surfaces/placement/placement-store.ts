// The placement store: the two temporary resource layers the Map holds and the fences around
// them. `placing` is a resource Block waiting for its point, drawn as a dashed preview under the
// placement bar. `locating` is Show on Map: a Block brought into view that Escape returns from.
// Each layer remembers the exact view it replaced and what was open when it began, so ending it
// puts everything back. `pending` is a placement waiting for a nested Area's Map to load, and
// `pointerCommit` swallows the pointer-up that follows a pointer-down commit.
//
// The reducer is pure. The bounds a point is kept inside arrive on the action, computed by
// `placement-effects.ts` from the composition; the arrow steps are the layout tokens.

import type { CapturedView, Focus, ResourceEntity, ResourceLocator } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { delta, point } from "../../units/frames.ts";
import type { Point, Rect, Size } from "../../units/frames.ts";
import type { AreaKey, RuntimeId } from "../../units/ids.ts";
import { add, clamp, half, subtract, translate } from "../../units/scalar-math.ts";
import { scenePx } from "../../units/units.ts";
import type { ScenePx } from "../../units/units.ts";

/** The arrow keys that move the placement preview. */
export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** The Map-local view a temporary resource layer changes: camera and selection, the Focus mask, and the folds set by hand. */
export type ViewLayer = {
  readonly view: CapturedView;
  readonly focus: Focus;
  readonly manualFolded: ReadonlySet<AreaKey>;
};

/** The Resources view that was open when a layer began: the Area it listed and the Details it had open, if any. */
export type ResourcesReturn = {
  readonly area: AreaKey | null;
  readonly details: ResourceLocator | null;
};

/** What was open when a resource layer began, so ending the layer can put it back and return focus. */
export type LayerOpener = {
  /** The control that started the layer, for a start from neither the Resources view nor the picker. */
  readonly element: HTMLElement | null;
  /** The Resources panel or sheet, when it was open. */
  readonly resources: ResourcesReturn | null;
  /** True when the Block picker was open. */
  readonly picker: boolean;
};

/** The owning Area's rectangle on the canvas and the size of the Block the preview draws. The point stays inside the first by the second. */
export type PlacementBounds = {
  readonly box: Rect<"scene">;
  readonly size: Size<"scene">;
};

/** A resource Block waiting for its point. */
export type Placement = {
  readonly entity: ResourceEntity;
  /** The Area the Block lands in: the owner of the resource's catalog. */
  readonly area: AreaKey;
  /** The `data-resource-place` value of the control that started it, for returning focus after a cancel. */
  readonly key: string;
  /** Where the preview's centre is now. */
  readonly point: Point<"scene">;
  readonly layer: ViewLayer;
  readonly opener: LayerOpener;
};

/** A resource Block shown by Show on Map, until Escape returns to the prior view. */
export type Locate = {
  readonly entity: ResourceEntity;
  readonly blockId: RuntimeId;
  /** The `data-resource-show` value of the control that started it. */
  readonly key: string;
  readonly layer: ViewLayer;
  readonly opener: LayerOpener;
};

/** A placement that waits for a nested Area's deferred Map to load before it can begin. */
export type PendingPlacement = {
  readonly owner: AreaKey;
  readonly entity: ResourceEntity;
  readonly element: HTMLElement | null;
};

/** The store. */
export type PlacementState = {
  readonly placing: Placement | null;
  readonly locating: Locate | null;
  readonly pending: PendingPlacement | null;
  /** True between a pointer-down that committed a placement and the pointer-up that follows it. */
  readonly pointerCommit: boolean;
};

/** The store with no layer open. */
export const EMPTY_PLACEMENT_STATE: PlacementState = Object.freeze({ placing: null, locating: null, pending: null, pointerCommit: false });

/** The closed set of things that can happen to the store. */
export type PlacementAction =
  | { readonly kind: "begin"; readonly placement: Placement }
  | { readonly kind: "move"; readonly point: Point<"scene">; readonly bounds: PlacementBounds | null }
  | { readonly kind: "nudge"; readonly arrow: ArrowKey; readonly fine: boolean; readonly bounds: PlacementBounds | null }
  | { readonly kind: "commit"; readonly through: "pointer" | "key" }
  | { readonly kind: "pointer-released" }
  | { readonly kind: "cancel" }
  | { readonly kind: "show"; readonly locate: Locate }
  | { readonly kind: "return" }
  | { readonly kind: "forget-locate" }
  | { readonly kind: "await-load"; readonly pending: PendingPlacement }
  | { readonly kind: "load-settled" };

/** What a key means while a placement is open. Every other key is the canvas's. */
export type PlacementKeyMeaning =
  | { readonly kind: "cancel" }
  | { readonly kind: "commit" }
  | { readonly kind: "nudge"; readonly arrow: ArrowKey; readonly fine: boolean };

/** The control focus returns to when a layer ends, by the data attribute the browser suites find it by. */
export type ReturnControl = {
  readonly attribute: "resource-place" | "resource-show";
  readonly key: string;
};

/** Where focus and the surfaces go when a layer ends. `MapRoot.tsx` turns this into stack changes and one kit focus call. */
export type ReturnTarget =
  | { readonly kind: "resources"; readonly area: AreaKey | null; readonly details: ResourceLocator | null; readonly control: ReturnControl }
  | { readonly kind: "picker" }
  | { readonly kind: "element"; readonly element: HTMLElement }
  | { readonly kind: "canvas" };

const ARROW_KEYS: ReadonlySet<string> = new Set<ArrowKey>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** True when a key name is one of the four arrows. */
export function isArrowKey(key: string): key is ArrowKey {
  return ARROW_KEYS.has(key);
}

/** The value the Place and Show controls carry in their data attribute: the locator, URL-encoded as one path. */
export function resourceLayerKey(locator: ResourceLocator): string {
  return encodeURIComponent(`${locator.owner}/${locator.id}`);
}

/** Keeps one axis of the point inside the Area by half the Block, or centres it when the Area is narrower than the Block. */
function boundedAxis(start: ScenePx, extent: ScenePx, blockExtent: ScenePx, target: ScenePx): ScenePx {
  if (extent <= blockExtent) return add(start, half(extent));
  const reach = half(blockExtent);
  return clamp(target, add(start, reach), subtract(add(start, extent), reach));
}

/** Keeps a preview centre inside the owning Area's rectangle so the whole Block lands in the Area. No bounds means no constraint. */
export function boundedPlacementPoint(bounds: PlacementBounds | null, target: Point<"scene">): Point<"scene"> {
  if (bounds === null) return target;
  return point(
    "scene",
    boundedAxis(bounds.box.x, bounds.box.width, bounds.size.width, target.x),
    boundedAxis(bounds.box.y, bounds.box.height, bounds.size.height, target.y),
  );
}

/** Where an arrow key moves the preview: one placement step, or one fine step with Shift held. */
export function nudgedPoint(current: Point<"scene">, arrow: ArrowKey, fine: boolean): Point<"scene"> {
  const step = fine ? LAYOUT.placementStepFine : LAYOUT.placementStep;
  const zero = scenePx(0);
  const dx = arrow === "ArrowLeft" ? subtract(zero, step) : arrow === "ArrowRight" ? step : zero;
  const dy = arrow === "ArrowUp" ? subtract(zero, step) : arrow === "ArrowDown" ? step : zero;
  return translate(current, delta("scene", dx, dy));
}

/** What a key does while a placement is open, or null when the key is not the placement's. */
export function placementKeyMeaning(key: string, shiftKey: boolean): PlacementKeyMeaning | null {
  if (key === "Escape") return { kind: "cancel" };
  if (key === "Enter") return { kind: "commit" };
  if (isArrowKey(key)) return { kind: "nudge", arrow: key, fine: shiftKey };
  return null;
}

/** Where a layer returns to: the Resources view and its control, the picker, the opening element, or the canvas. */
export function returnTarget(opener: LayerOpener, control: ReturnControl): ReturnTarget {
  if (opener.resources) return { kind: "resources", area: opener.resources.area, details: opener.resources.details, control };
  if (opener.picker) return { kind: "picker" };
  if (opener.element) return { kind: "element", element: opener.element };
  return { kind: "canvas" };
}

/** True when a selection change leaves the located Block as the whole selection, so the locate layer stays. */
export function locateSurvivesSelection(state: PlacementState, selection: Iterable<RuntimeId>): boolean {
  if (!state.locating) return true;
  const ids = [...selection];
  return ids.length === 1 && ids[0] === state.locating.blockId;
}

/** Moves the preview to the bounded point. The same state comes back when the point did not change. */
function movePreview(state: PlacementState, target: Point<"scene">, bounds: PlacementBounds | null): PlacementState {
  if (!state.placing) return state;
  const next = boundedPlacementPoint(bounds, target);
  if (next.x === state.placing.point.x && next.y === state.placing.point.y) return state;
  return { ...state, placing: { ...state.placing, point: next } };
}

/** The pure reducer: (state, action) -> state. */
export function placementReducer(state: PlacementState, action: PlacementAction): PlacementState {
  switch (action.kind) {
    case "begin": return { ...state, placing: action.placement, pending: null, pointerCommit: false };
    case "move": return movePreview(state, action.point, action.bounds);
    case "nudge": return state.placing ? movePreview(state, nudgedPoint(state.placing.point, action.arrow, action.fine), action.bounds) : state;
    case "commit": return state.placing ? { ...state, placing: null, pointerCommit: action.through === "pointer" } : state;
    case "pointer-released": return state.pointerCommit ? { ...state, pointerCommit: false } : state;
    case "cancel": return state.placing ? { ...state, placing: null } : state;
    case "show": return { ...state, locating: action.locate };
    case "return":
    case "forget-locate": return state.locating ? { ...state, locating: null } : state;
    case "await-load": return { ...state, pending: action.pending };
    case "load-settled": return state.pending ? { ...state, pending: null } : state;
  }
}
