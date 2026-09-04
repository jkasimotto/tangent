// Area outline presentation: what counts as a restyle, and when the shape island is hidden.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneElement, Selection } from "../kernel/kernel-types.ts";
import { runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { areaOutlineRestyled, onlyAreaOutlinesHeld } from "./area-outline-style.ts";

/** One composed Area outline, with the near-transparent fill the controller derives. */
function outline(id: string, area: string): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: 0, y: 0, width: 100, height: 80, angle: 0,
    strokeColor: "#8b95a3", backgroundColor: "#ffffff01", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "dashed", roughness: 0, opacity: 100, link: null, locked: false,
    customData: { tangent: { role: "area-region", area } },
  } as unknown as SceneElement;
}

/** One Block a person drew, which the Area tree does not own. */
function block(id: string): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: 0, y: 0, width: 40, height: 20, angle: 0,
    strokeColor: "#c9d1d9", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 0, opacity: 100, link: null, locked: false,
    customData: { tangent: { kind: "area", ref: "otto" } },
  } as unknown as SceneElement;
}

/** The ids of some elements, as the Map holds a selection. */
function held(...ids: readonly string[]): Selection {
  return new Set<RuntimeId>(ids.map(runtimeId));
}

/** The same element with one field replaced, which is what a shape-properties click writes. */
function withField(element: SceneElement, field: string, value: unknown): SceneElement {
  return { ...element, [field]: value } as SceneElement;
}

test("a Background swatch on an Area outline is a restyle", () => {
  const composed = [outline("region-a", "otto"), block("block-a")];
  assert.equal(areaOutlineRestyled(composed, composed), false);
  assert.equal(areaOutlineRestyled(composed, [withField(composed[0], "backgroundColor", "#b2f2bb"), composed[1]]), true);
});

test("every other shape-properties control on an outline is a restyle too", () => {
  const composed = [outline("region-a", "otto")];
  for (const [field, value] of [["strokeColor", "#e03131"], ["fillStyle", "hachure"], ["strokeWidth", 4],
    ["strokeStyle", "solid"], ["roughness", 2], ["opacity", 30], ["link", "https://example.test"], ["locked", true]]) {
    assert.equal(areaOutlineRestyled(composed, [withField(composed[0], field, value)]), true, `${field} is presentation`);
  }
});

test("moving an Area, or styling a Block, is not a restyle of an outline", () => {
  const composed = [outline("region-a", "otto"), block("block-a")];
  assert.equal(areaOutlineRestyled(composed, [{ ...composed[0], x: 40, y: 60 } as SceneElement, composed[1]]), false);
  assert.equal(areaOutlineRestyled(composed, [composed[0], withField(composed[1], "backgroundColor", "#b2f2bb")]), false);
});

test("a scene with no outline, and an outline the change dropped, are not restyles", () => {
  assert.equal(areaOutlineRestyled([block("block-a")], [withField(block("block-a"), "backgroundColor", "#b2f2bb")]), false);
  assert.equal(areaOutlineRestyled([outline("region-a", "otto")], []), false);
});

test("the shape island is hidden for outlines alone and returns when a Block is held with them", () => {
  const elements = [outline("region-a", "otto"), outline("region-b", "otto/tangent"), block("block-a")];
  assert.equal(onlyAreaOutlinesHeld(elements, held("region-a")), true);
  assert.equal(onlyAreaOutlinesHeld(elements, held("region-a", "region-b")), true);
  assert.equal(onlyAreaOutlinesHeld(elements, held("region-a", "block-a")), false);
  assert.equal(onlyAreaOutlinesHeld(elements, held("block-a")), false);
  assert.equal(onlyAreaOutlinesHeld(elements, held()), false);
});
