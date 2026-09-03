import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CapturedView, ResourceEntity } from "../../kernel/kernel-types.ts";
import { LAYOUT } from "../../layout/layout-tokens.ts";
import { point, rect, size } from "../../units/frames.ts";
import type { Point } from "../../units/frames.ts";
import { areaKey, resourceId, runtimeId, shardOwner } from "../../units/ids.ts";
import { scenePx, zoom } from "../../units/units.ts";
import {
  EMPTY_PLACEMENT_STATE, boundedPlacementPoint, isArrowKey, locateSurvivesSelection, nudgedPoint, placementKeyMeaning, placementReducer, resourceLayerKey, returnTarget,
} from "./placement-store.ts";
import type { LayerOpener, Locate, Placement, PlacementBounds, PlacementState, ViewLayer } from "./placement-store.ts";

/** A scene point from raw test numbers. */
const sp = (x: number, y: number): Point<"scene"> => point("scene", scenePx(x), scenePx(y));

const ENTITY: ResourceEntity = { locator: { owner: shardOwner("otto/tangent"), id: resourceId("repo-shared") }, label: "Shared repository", target: null, representation: "never-placed" };

const VIEW: CapturedView = { camera: { scrollX: scenePx(0), scrollY: scenePx(0), zoom: zoom(1) }, locatedArea: areaKey("otto"), cameraTarget: null, cameraTrail: [], restrictionArea: null, selection: [], findRevealId: null };

const LAYER: ViewLayer = { view: VIEW, focus: {}, manualFolded: new Set() };

const NO_OPENER: LayerOpener = { element: null, resources: null, picker: false };

/** An Area box 400 by 300 at (100, 100) with a 280 by 132 Block, the size the kernel draws. */
const BOUNDS: PlacementBounds = { box: rect("scene", scenePx(100), scenePx(100), scenePx(400), scenePx(300)), size: size("scene", scenePx(280), scenePx(132)) };

/** A placement at a point with no opener. */
function placementAt(x: number, y: number, opener: LayerOpener = NO_OPENER): Placement {
  return { entity: ENTITY, area: areaKey("otto/tangent"), key: resourceLayerKey(ENTITY.locator), point: sp(x, y), layer: LAYER, opener };
}

/** The store with one placement open. */
function placing(x: number, y: number): PlacementState {
  return placementReducer(EMPTY_PLACEMENT_STATE, { kind: "begin", placement: placementAt(x, y) });
}

test("the layer key is the locator as one URL-encoded path, what the data attributes carry", () => {
  assert.equal(resourceLayerKey(ENTITY.locator), encodeURIComponent("otto/tangent/repo-shared"));
});

test("a bounded point keeps the whole Block inside the Area", () => {
  assert.deepEqual(boundedPlacementPoint(BOUNDS, sp(300, 250)), { x: 300, y: 250 });
  assert.deepEqual(boundedPlacementPoint(BOUNDS, sp(0, 0)), { x: 240, y: 166 });
  assert.deepEqual(boundedPlacementPoint(BOUNDS, sp(1000, 1000)), { x: 360, y: 334 });
  assert.deepEqual(boundedPlacementPoint(null, sp(1000, 1000)), { x: 1000, y: 1000 });
});

test("an Area narrower than the Block centres the point on that axis", () => {
  const narrow: PlacementBounds = { box: rect("scene", scenePx(100), scenePx(100), scenePx(200), scenePx(100)), size: BOUNDS.size };
  assert.deepEqual(boundedPlacementPoint(narrow, sp(0, 0)), { x: 200, y: 150 });
});

test("arrow keys move by the placement step, or the fine step with Shift", () => {
  assert.deepEqual(nudgedPoint(sp(10, 10), "ArrowRight", false), { x: 10 + LAYOUT.placementStep, y: 10 });
  assert.deepEqual(nudgedPoint(sp(10, 10), "ArrowLeft", false), { x: 10 - LAYOUT.placementStep, y: 10 });
  assert.deepEqual(nudgedPoint(sp(10, 10), "ArrowDown", true), { x: 10, y: 10 + LAYOUT.placementStepFine });
  assert.deepEqual(nudgedPoint(sp(10, 10), "ArrowUp", true), { x: 10, y: 10 - LAYOUT.placementStepFine });
  assert.equal(LAYOUT.placementStep, 16);
  assert.equal(LAYOUT.placementStepFine, 1);
});

test("while placing, Escape cancels, Enter commits, arrows nudge and other keys are not the placement's", () => {
  assert.deepEqual(placementKeyMeaning("Escape", false), { kind: "cancel" });
  assert.deepEqual(placementKeyMeaning("Enter", false), { kind: "commit" });
  assert.deepEqual(placementKeyMeaning("ArrowRight", false), { kind: "nudge", arrow: "ArrowRight", fine: false });
  assert.deepEqual(placementKeyMeaning("ArrowUp", true), { kind: "nudge", arrow: "ArrowUp", fine: true });
  assert.equal(placementKeyMeaning("b", false), null);
  assert.equal(isArrowKey("Tab"), false);
});

test("begin opens a placement and drops a pending load", () => {
  const pending = placementReducer(EMPTY_PLACEMENT_STATE, { kind: "await-load", pending: { owner: areaKey("otto/tangent"), entity: ENTITY, element: null } });
  assert.equal(pending.pending?.owner, "otto/tangent");
  const state = placementReducer(pending, { kind: "begin", placement: placementAt(300, 250) });
  assert.equal(state.pending, null);
  assert.deepEqual(state.placing?.point, { x: 300, y: 250 });
  assert.equal(placementReducer(pending, { kind: "load-settled" }).pending, null);
});

test("move and nudge keep the preview inside the bounds and return the same state when nothing moved", () => {
  const state = placing(300, 250);
  const moved = placementReducer(state, { kind: "move", point: sp(0, 0), bounds: BOUNDS });
  assert.deepEqual(moved.placing?.point, { x: 240, y: 166 });
  assert.equal(placementReducer(moved, { kind: "move", point: sp(0, 0), bounds: BOUNDS }), moved);
  const nudged = placementReducer(moved, { kind: "nudge", arrow: "ArrowRight", fine: false, bounds: BOUNDS });
  assert.deepEqual(nudged.placing?.point, { x: 240 + LAYOUT.placementStep, y: 166 });
  assert.deepEqual(placementReducer(moved, { kind: "nudge", arrow: "ArrowLeft", fine: false, bounds: BOUNDS }).placing?.point, { x: 240, y: 166 });
  assert.equal(placementReducer(EMPTY_PLACEMENT_STATE, { kind: "move", point: sp(1, 1), bounds: null }), EMPTY_PLACEMENT_STATE);
});

test("a pointer commit closes the placement and swallows the pointer-up that follows", () => {
  const committed = placementReducer(placing(300, 250), { kind: "commit", through: "pointer" });
  assert.equal(committed.placing, null);
  assert.equal(committed.pointerCommit, true);
  const released = placementReducer(committed, { kind: "pointer-released" });
  assert.equal(released.pointerCommit, false);
  assert.equal(placementReducer(released, { kind: "pointer-released" }), released);
  assert.equal(placementReducer(placing(1, 1), { kind: "commit", through: "key" }).pointerCommit, false);
  assert.equal(placementReducer(EMPTY_PLACEMENT_STATE, { kind: "commit", through: "key" }), EMPTY_PLACEMENT_STATE);
});

test("cancel closes the placement and nothing else", () => {
  const state = placing(300, 250);
  assert.equal(placementReducer(state, { kind: "cancel" }).placing, null);
  assert.equal(placementReducer(EMPTY_PLACEMENT_STATE, { kind: "cancel" }), EMPTY_PLACEMENT_STATE);
});

test("show opens a locate layer that return and forget both close", () => {
  const locate: Locate = { entity: ENTITY, blockId: runtimeId("otto/tangent::block"), key: resourceLayerKey(ENTITY.locator), layer: LAYER, opener: NO_OPENER };
  const shown = placementReducer(EMPTY_PLACEMENT_STATE, { kind: "show", locate });
  assert.equal(shown.locating, locate);
  assert.equal(placementReducer(shown, { kind: "return" }).locating, null);
  assert.equal(placementReducer(shown, { kind: "forget-locate" }).locating, null);
  assert.equal(placementReducer(EMPTY_PLACEMENT_STATE, { kind: "return" }), EMPTY_PLACEMENT_STATE);
  assert.equal(locateSurvivesSelection(shown, [locate.blockId]), true);
  assert.equal(locateSurvivesSelection(shown, [locate.blockId, runtimeId("other")]), false);
  assert.equal(locateSurvivesSelection(shown, []), false);
  assert.equal(locateSurvivesSelection(EMPTY_PLACEMENT_STATE, []), true);
});

test("a layer returns to the Resources control, else the picker, else its element, else the canvas", () => {
  const control = { attribute: "resource-place" as const, key: "k" };
  assert.deepEqual(returnTarget({ element: null, resources: { area: areaKey("otto"), details: null }, picker: true }, control), { kind: "resources", area: "otto", details: null, control });
  assert.deepEqual(returnTarget({ element: null, resources: null, picker: true }, control), { kind: "picker" });
  const element = {} as HTMLElement;
  assert.deepEqual(returnTarget({ element, resources: null, picker: false }, control), { kind: "element", element });
  assert.deepEqual(returnTarget(NO_OPENER, control), { kind: "canvas" });
});
