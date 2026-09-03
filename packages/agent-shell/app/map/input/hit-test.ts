// The one place that decides what is under a scene point.
//
// The old component computed its own hit in five places, and each over the full composition, so a
// Block that fold or Find had taken off the canvas still caught a press meant for the Area behind
// it. Here the hit runs over the projected visible scene only: the composition's elements minus
// the hidden set the controller snapshot exposes (fold, scope, Find and Focus together), and the
// Area regions minus those fold or scope has taken away. `press-meaning.ts` reads the result and
// nothing else measures a press against an element.
//
// Two answers come back. The topmost visible authored element, where authored means not an Area
// region and not a disposable projection element, and the deepest visible Area. The grab padding
// from `LAYOUT` applies to authored elements only: it exists so a person can seize an element they
// already hold, and it never widens an Area. A press inside an element's own body is reported
// apart from a press that only grazes its padding, because the meaning differs: the body belongs
// to the element, the padding belongs to the Area unless the element is already selected.
//
// Design: docs/design/area-map-rebuild/code.md, "Pointer authority".

import type { Snapshot, SceneElement, Selection } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { rect } from "../units/frames.ts";
import type { Point, Rect } from "../units/frames.ts";
import type { AreaKey, RuntimeId } from "../units/ids.ts";
import { rectContains, toSceneLength } from "../units/scalar-math.ts";
import { count, scenePx } from "../units/units.ts";
import type { Count, ScenePx, Zoom } from "../units/units.ts";

/** The projected visible scene a hit runs over: what the pointer can see, and the zoom it sees it at. */
export type VisibleScene = {
  /** The composition's elements, in paint order: the last element is on top. */
  readonly elements: readonly SceneElement[];
  /** Every Area region's rectangle in the scene, from the composition. */
  readonly regionRects: ReadonlyMap<AreaKey, Rect<"scene">>;
  /** The element ids fold, scope, Find and Focus have taken off the canvas. */
  readonly hiddenIds: ReadonlySet<RuntimeId>;
  /** The Areas the Only restriction admits. */
  readonly scopedAreas: ReadonlySet<AreaKey>;
  /** The folded roots. A folded root is still drawn; its descendants are not. */
  readonly folded: ReadonlySet<AreaKey>;
  /** The camera's zoom, which the grab padding is divided by. */
  readonly zoom: Zoom;
};

/** What lies under one scene point. */
export type SceneHit = {
  /** The topmost visible authored element under the point, resolved to its container when it is bound text. Null when there is none. */
  readonly element: SceneElement | null;
  /** True when the point lies inside the element's own body rather than only inside its grab padding. */
  readonly inside: boolean;
  /** The deepest visible Area whose region holds the point. Null outside every visible region. */
  readonly area: AreaKey | null;
};

/** The hit with nothing under the point. */
export const EMPTY_HIT: SceneHit = Object.freeze({ element: null, inside: false, area: null });

/** No padding: the test against an element's own body and against an Area region. */
const NO_PADDING: ScenePx = scenePx(0);

/** Builds the visible scene of a controller snapshot, which is the scene a press lands on. */
export function visibleSceneFromSnapshot(snapshot: Snapshot): VisibleScene {
  return {
    elements: snapshot.composition.scene.elements,
    regionRects: snapshot.composition.regionRects,
    hiddenIds: snapshot.hiddenIds,
    scopedAreas: snapshot.scopedAreas,
    folded: snapshot.folded,
    zoom: snapshot.camera.zoom,
  };
}

/** Finds what is under a scene point: the topmost visible authored element and the deepest visible Area. */
export function hitTest(scene: VisibleScene, point: Point<"scene">): SceneHit {
  const candidates = scene.elements.filter((element) => isVisibleAuthored(scene, element));
  const bodyHit = topmost(candidates, point, NO_PADDING);
  const paddedHit = bodyHit ?? topmost(candidates, point, grabPaddingAt(scene.zoom));
  const element = paddedHit ? resolveContainer(scene, paddedHit) : null;
  return { element, inside: bodyHit !== null, area: deepestVisibleArea(scene, point) };
}

/** The deepest visible Area whose region holds the point, or null. Fold and scope never let a hidden Area win a point. */
export function deepestVisibleArea(scene: VisibleScene, point: Point<"scene">): AreaKey | null {
  let deepest: AreaKey | null = null;
  for (const [area, bounds] of scene.regionRects) {
    if (!isVisibleArea(scene, area) || !rectContains(bounds, point, NO_PADDING)) continue;
    if (deepest === null || depthOf(area) > depthOf(deepest)) deepest = area;
  }
  return deepest;
}

/** The Area whose region is in the selection, when that Area is visible. Null when no region is selected or it is hidden. */
export function selectedVisibleArea(scene: VisibleScene, selection: Selection): AreaKey | null {
  const region = scene.elements.find((element) => selection.has(element.id) && regionAreaOf(element) !== null && !scene.hiddenIds.has(element.id));
  const area = region ? regionAreaOf(region) : null;
  return area !== null && isVisibleArea(scene, area) ? area : null;
}

/** True when an Area is on the canvas: admitted by the restriction and not under a folded root. */
export function isVisibleArea(scene: VisibleScene, area: AreaKey): boolean {
  return scene.scopedAreas.has(area) && !hiddenByFold(scene.folded, area);
}

/** True when fold has taken an Area off the canvas: a folded root is still drawn, so only its descendants are hidden. */
export function hiddenByFold(folded: ReadonlySet<AreaKey>, area: AreaKey): boolean {
  for (const root of folded) if (area.startsWith(`${root}/`)) return true;
  return false;
}

/** The Area an Area region element stands for, or null for any other element. */
export function regionAreaOf(element: SceneElement): AreaKey | null {
  const tangent = element.customData?.tangent;
  return tangent?.role === "area-region" && tangent.area !== undefined ? tangent.area : null;
}

/** True for a disposable projection element: a figure icon, a success rail or an endpoint dot. */
export function isEphemeral(element: SceneElement): boolean {
  return Boolean(element.customData?.tangentWorldEphemeral) || element.customData?.tangent?.role === "endpoint-dot";
}

/** The rectangle an element covers in the scene. */
export function elementRect(element: SceneElement): Rect<"scene"> {
  return rect("scene", element.x, element.y, element.width, element.height);
}

/** The grab padding in scene pixels at a zoom: the screen padding divided by the zoom, floored so a tiny zoom cannot grow it without bound. */
export function grabPaddingAt(zoom: Zoom): ScenePx {
  const effective = zoom < LAYOUT.grabZoomFloor ? LAYOUT.grabZoomFloor : zoom;
  return toSceneLength(LAYOUT.grabPadding, effective);
}

/** True for an element a press may land on: drawn, authored, and not hidden. */
function isVisibleAuthored(scene: VisibleScene, element: SceneElement): boolean {
  return !element.isDeleted && !scene.hiddenIds.has(element.id) && regionAreaOf(element) === null && !isEphemeral(element);
}

/** The last element in paint order whose rectangle, grown by the padding, holds the point. */
function topmost(candidates: readonly SceneElement[], point: Point<"scene">, padding: ScenePx): SceneElement | null {
  for (let position = candidates.length - 1; position >= 0; position -= 1) {
    const element = candidates[position];
    if (element !== undefined && rectContains(elementRect(element), point, padding)) return element;
  }
  return null;
}

/** Bound text stands for its container: a press on a Block's label is a press on the Block. The text stands alone when its container is not a visible authored element. */
function resolveContainer(scene: VisibleScene, element: SceneElement): SceneElement {
  if (!element.containerId) return element;
  const container = scene.elements.find((candidate) => candidate.id === element.containerId);
  return container && isVisibleAuthored(scene, container) ? container : element;
}

/** How deep an Area sits in the tree: the number of segments in its key. */
function depthOf(area: AreaKey): Count {
  return count(area.split("/").length);
}
