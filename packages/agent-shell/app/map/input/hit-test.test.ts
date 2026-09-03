import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SceneElement, Snapshot } from "../kernel/kernel-types.ts";
import { point, rect } from "../units/frames.ts";
import type { Point, Rect } from "../units/frames.ts";
import { areaKey, runtimeId } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import { scenePx, zoom } from "../units/units.ts";
import {
  EMPTY_HIT, deepestVisibleArea, elementRect, grabPaddingAt, hiddenByFold, hitTest, isEphemeral, isVisibleArea, regionAreaOf, selectedVisibleArea, visibleSceneFromSnapshot,
} from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";

/** A scene point from raw test numbers. */
const at = (x: number, y: number): Point<"scene"> => point("scene", scenePx(x), scenePx(y));

/** A scene rect from raw test numbers. */
const box = (x: number, y: number, width: number, height: number): Rect<"scene"> => rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));

/** One composed element with the fields Excalidraw requires and the geometry the test names. */
function element(id: string, bounds: Rect<"scene">, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    angle: 0 as SceneElement["angle"], strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, ...extra,
  };
}

/** A Block owned by an Area. */
function block(id: string, bounds: Rect<"scene">, owner: string): SceneElement {
  return element(id, bounds, { customData: { tangent: { kind: "goal", ref: id }, tangentWorld: { owner: owner as never, sourceId: id as never } } });
}

/** An Area region element. */
function region(area: string, bounds: Rect<"scene">): SceneElement {
  return element(`region-${area}`, bounds, { customData: { tangent: { role: "area-region", area: areaKey(area) } } });
}

/** A visible scene over the given elements, with every named Area in scope and nothing folded unless said. */
function scene(elements: SceneElement[], options: Partial<VisibleScene> = {}): VisibleScene {
  const regionRects = new Map<AreaKey, Rect<"scene">>();
  for (const candidate of elements) {
    const area = regionAreaOf(candidate);
    if (area !== null) regionRects.set(area, elementRect(candidate));
  }
  return {
    elements, regionRects, hiddenIds: new Set(), scopedAreas: new Set(regionRects.keys()), folded: new Set(), zoom: zoom(1), ...options,
  };
}

const OTTO = box(0, 0, 1000, 1000);
const TANGENT = box(100, 100, 400, 400);
const MAP = box(150, 150, 100, 100);

test("nothing under the point is the empty hit", () => {
  assert.deepEqual(hitTest(scene([]), at(5, 5)), EMPTY_HIT);
  assert.deepEqual(hitTest(scene([region("otto", OTTO)]), at(2000, 2000)), EMPTY_HIT);
});

test("the topmost authored element wins and a press in its body is inside", () => {
  const lower = block("lower", box(10, 10, 100, 100), "otto");
  const upper = block("upper", box(50, 50, 100, 100), "otto");
  const hit = hitTest(scene([region("otto", OTTO), lower, upper]), at(60, 60));
  assert.equal(hit.element?.id, "upper");
  assert.equal(hit.inside, true);
  assert.equal(hit.area, "otto");
});

test("regions, ephemeral, hidden and deleted elements are never element hits", () => {
  const ephemeral = element("dot", box(10, 10, 20, 20), { customData: { tangent: { role: "endpoint-dot" } } });
  const icon = element("icon", box(10, 10, 20, 20), { customData: { tangentWorldEphemeral: { kind: "figure-icon" } } });
  const hidden = block("hidden", box(10, 10, 20, 20), "otto");
  const deleted = block("deleted", box(10, 10, 20, 20), "otto", );
  const visible = scene([region("otto", OTTO), ephemeral, icon, hidden, { ...deleted, isDeleted: true }], { hiddenIds: new Set([runtimeId("hidden")]) });
  const hit = hitTest(visible, at(15, 15));
  assert.equal(hit.element, null);
  assert.equal(hit.inside, false);
  assert.equal(hit.area, "otto");
  assert.ok(isEphemeral(ephemeral));
  assert.ok(isEphemeral(icon));
  assert.equal(isEphemeral(hidden), false);
});

test("the grab padding reaches past an element's edge by the layout padding divided by the zoom", () => {
  const target = block("target", box(100, 100, 50, 50), "otto");
  assert.equal(grabPaddingAt(zoom(1)), 10);
  assert.equal(grabPaddingAt(zoom(2)), 5);
  assert.equal(grabPaddingAt(zoom(0.05)), 100, "a zoom under the floor is divided as the floor");
  const atOne = scene([target]);
  assert.equal(hitTest(atOne, at(160, 125)).element?.id, "target");
  assert.equal(hitTest(atOne, at(160, 125)).inside, false, "a graze is not inside");
  assert.equal(hitTest(atOne, at(161, 125)).element, null);
  const atTwo = scene([target], { zoom: zoom(2) });
  assert.equal(hitTest(atTwo, at(155, 125)).element?.id, "target");
  assert.equal(hitTest(atTwo, at(156, 125)).element, null);
});

test("an element whose body holds the point beats a higher element that only grazes it", () => {
  const lower = block("lower", box(0, 0, 100, 100), "otto");
  const upper = block("upper", box(105, 0, 100, 100), "otto");
  const hit = hitTest(scene([lower, upper]), at(99, 50));
  assert.equal(hit.element?.id, "lower");
  assert.equal(hit.inside, true);
});

test("bound text resolves to its container, unless the container is not a visible authored element", () => {
  const container = block("card", box(0, 0, 200, 100), "otto");
  const label = element("label", box(10, 10, 100, 20), { type: "text", containerId: runtimeId("card"), text: "Card" });
  assert.equal(hitTest(scene([container, label]), at(20, 20)).element?.id, "card");
  const orphan = scene([container, label], { hiddenIds: new Set([runtimeId("card")]) });
  assert.equal(hitTest(orphan, at(20, 20)).element?.id, "label");
  const stray = element("stray", box(10, 10, 100, 20), { type: "text", containerId: runtimeId("missing"), text: "Stray" });
  assert.equal(hitTest(scene([stray]), at(20, 20)).element?.id, "stray");
});

test("the deepest visible Area wins, edges included", () => {
  const nested = scene([region("otto", OTTO), region("otto/tangent", TANGENT), region("otto/tangent/map", MAP)]);
  assert.equal(deepestVisibleArea(nested, at(175, 175)), "otto/tangent/map");
  assert.equal(deepestVisibleArea(nested, at(120, 120)), "otto/tangent");
  assert.equal(deepestVisibleArea(nested, at(20, 20)), "otto");
  assert.equal(deepestVisibleArea(nested, at(150, 150)), "otto/tangent/map", "the top-left edge counts");
  assert.equal(deepestVisibleArea(nested, at(250, 250)), "otto/tangent/map", "the bottom-right edge counts");
  assert.equal(deepestVisibleArea(nested, at(1001, 20)), null);
});

test("fold hides an Area's descendants but not the folded root, and scope hides what Only excludes", () => {
  const elements = [region("otto", OTTO), region("otto/tangent", TANGENT), region("otto/tangent/map", MAP)];
  const folded = scene(elements, { folded: new Set([areaKey("otto/tangent")]) });
  assert.equal(deepestVisibleArea(folded, at(175, 175)), "otto/tangent");
  assert.ok(isVisibleArea(folded, areaKey("otto/tangent")));
  assert.equal(isVisibleArea(folded, areaKey("otto/tangent/map")), false);
  const scoped = scene(elements, { scopedAreas: new Set([areaKey("otto")]) });
  assert.equal(deepestVisibleArea(scoped, at(175, 175)), "otto");
  assert.equal(hiddenByFold(new Set([areaKey("otto/tangent")]), areaKey("otto/tangent")), false);
  assert.equal(hiddenByFold(new Set([areaKey("otto/tangent")]), areaKey("otto/tangent2")), false, "a sibling with a longer name is not a descendant");
  assert.ok(hiddenByFold(new Set([areaKey("otto")]), areaKey("otto/tangent/map")));
});

test("the selected visible Area is the Area of the selected region, or null", () => {
  const elements = [region("otto", OTTO), region("otto/tangent", TANGENT), block("card", box(10, 10, 50, 50), "otto")];
  const plain = scene(elements);
  assert.equal(selectedVisibleArea(plain, new Set([runtimeId("region-otto/tangent")])), "otto/tangent");
  assert.equal(selectedVisibleArea(plain, new Set([runtimeId("card")])), null, "a Block is not an Area");
  assert.equal(selectedVisibleArea(plain, new Set()), null);
  const folded = scene(elements, { folded: new Set([areaKey("otto")]) });
  assert.equal(selectedVisibleArea(folded, new Set([runtimeId("region-otto/tangent")])), null, "a folded-away region is not visible");
  const hidden = scene(elements, { hiddenIds: new Set([runtimeId("region-otto/tangent")]) });
  assert.equal(selectedVisibleArea(hidden, new Set([runtimeId("region-otto/tangent")])), null, "a hidden region element is not visible");
  const scoped = scene(elements, { scopedAreas: new Set([areaKey("otto")]) });
  assert.equal(selectedVisibleArea(scoped, new Set([runtimeId("region-otto/tangent")])), null, "a region outside Only is not visible");
});

test("visibleSceneFromSnapshot reads the projected scene, the hidden set, scope, fold and the zoom", () => {
  const elements = [region("otto", OTTO)];
  const regionRects = new Map([[areaKey("otto"), OTTO]]);
  const snapshot = {
    composition: { scene: { elements }, regionRects },
    hiddenIds: new Set([runtimeId("gone")]),
    scopedAreas: new Set([areaKey("otto")]),
    folded: new Set([areaKey("otto/tangent")]),
    camera: { scrollX: scenePx(0), scrollY: scenePx(0), zoom: zoom(1.5) },
  } as unknown as Snapshot;
  const visible = visibleSceneFromSnapshot(snapshot);
  assert.equal(visible.elements, elements);
  assert.equal(visible.regionRects, regionRects);
  assert.equal(visible.hiddenIds, snapshot.hiddenIds);
  assert.equal(visible.scopedAreas, snapshot.scopedAreas);
  assert.equal(visible.folded, snapshot.folded);
  assert.equal(visible.zoom, 1.5);
});
