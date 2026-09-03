import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { point } from "../units/frames.ts";
import { areaKey, runtimeId } from "../units/ids.ts";
import { scenePx } from "../units/units.ts";
import { EMPTY_HIT } from "./hit-test.ts";
import type { SceneHit } from "./hit-test.ts";
import { PRESS_RULES, meaningOfPress } from "./press-meaning.ts";
import type { PressContext } from "./press-meaning.ts";

const POINT = point("scene", scenePx(40), scenePx(50));
const CARD = runtimeId("card");
const OTTO = areaKey("otto");
const TANGENT = areaKey("otto/tangent");

/** The smallest element the hit can name; only its id matters to the rules. */
const cardElement = { id: CARD, type: "rectangle" } as SceneElement;

/** A hit on the card, inside its body unless said otherwise, over the tangent Area. */
function cardHit(inside = true): SceneHit {
  return { element: cardElement, inside, area: TANGENT };
}

/** A hit on the tangent Area's open body. */
const AREA_HIT: SceneHit = { element: null, inside: false, area: TANGENT };

/** A plain press with the selection tool on empty canvas, with nothing held and nothing open. */
function context(overrides: Partial<PressContext> = {}): PressContext {
  return {
    point: POINT, modifiers: { shift: false, cmdOrCtrl: false }, spaceHeld: false, tool: "selection", placementOpen: false, editingText: false,
    selection: new Set(), selectedArea: null, command: { kind: "move", handle: null }, hit: EMPTY_HIT, ...overrides,
  };
}

test("rule 1: Space held or the hand tool pans before anything else", () => {
  assert.deepEqual(meaningOfPress(context({ spaceHeld: true, hit: cardHit(), selectedArea: TANGENT })), { kind: "pan" });
  assert.deepEqual(meaningOfPress(context({ tool: "hand", placementOpen: true })), { kind: "pan" });
  assert.deepEqual(meaningOfPress(context({ spaceHeld: true, editingText: true, tool: "text" })), { kind: "pan" });
});

test("rule 2: an open placement lands the resource where the press is", () => {
  assert.deepEqual(meaningOfPress(context({ placementOpen: true, hit: cardHit() })), { kind: "place-resource", point: POINT });
  assert.deepEqual(meaningOfPress(context({ placementOpen: true, tool: "text" })), { kind: "place-resource", point: POINT });
});

test("rule 3: the text tool starts text where the press is", () => {
  assert.deepEqual(meaningOfPress(context({ tool: "text", hit: cardHit() })), { kind: "text", point: POINT });
  assert.deepEqual(meaningOfPress(context({ tool: "text", editingText: true })), { kind: "text", point: POINT });
});

test("rule 4: a press while text is edited is ignored", () => {
  assert.deepEqual(meaningOfPress(context({ editingText: true, hit: cardHit() })), { kind: "ignore", reason: "editing-text" });
});

test("rule 5: Shift or Cmd with an element under the point adds it, grab padding included", () => {
  const shift = { shift: true, cmdOrCtrl: false };
  const cmd = { shift: false, cmdOrCtrl: true };
  assert.deepEqual(meaningOfPress(context({ modifiers: shift, hit: cardHit() })), { kind: "add-to-selection", id: CARD });
  assert.deepEqual(meaningOfPress(context({ modifiers: cmd, hit: cardHit(false) })), { kind: "add-to-selection", id: CARD });
  assert.deepEqual(meaningOfPress(context({ modifiers: shift, hit: cardHit(), selectedArea: TANGENT, command: { kind: "resize", handle: "se" } })), { kind: "add-to-selection", id: CARD });
});

test("rule 6: the selected Area's resize handle resizes it and its rotation handle is refused", () => {
  const selected = { selectedArea: TANGENT, selection: new Set([runtimeId("region")]) };
  assert.deepEqual(meaningOfPress(context({ ...selected, command: { kind: "resize", handle: "nw" }, hit: cardHit() })), { kind: "resize-area", area: TANGENT, handle: "nw" });
  assert.deepEqual(meaningOfPress(context({ ...selected, command: { kind: "ignore", handle: "rotation" }, hit: cardHit() })), { kind: "ignore", reason: "rotation" });
  assert.deepEqual(meaningOfPress(context({ ...selected, command: { kind: "move", handle: null }, hit: cardHit() })), { kind: "grab-element", id: CARD }, "a plain move falls through");
});

test("rule 6 needs a selected Area: a Block's handles fall through to the grab", () => {
  const held = { selection: new Set([CARD]) };
  assert.deepEqual(meaningOfPress(context({ ...held, command: { kind: "resize", handle: "se" }, hit: cardHit(false) })), { kind: "grab-element", id: CARD });
  assert.deepEqual(meaningOfPress(context({ ...held, command: { kind: "ignore", handle: "rotation" }, hit: cardHit(false) })), { kind: "grab-element", id: CARD });
});

test("rule 7: a press inside an element's body grabs it; a graze grabs it only when it is already held", () => {
  assert.deepEqual(meaningOfPress(context({ hit: cardHit() })), { kind: "grab-element", id: CARD });
  assert.deepEqual(meaningOfPress(context({ hit: cardHit(false) })), { kind: "move-area", area: TANGENT }, "a graze belongs to the Area");
  assert.deepEqual(meaningOfPress(context({ hit: cardHit(false), selection: new Set([CARD]) })), { kind: "grab-element", id: CARD });
  assert.deepEqual(meaningOfPress(context({ hit: { element: cardElement, inside: true, area: null } })), { kind: "grab-element", id: CARD });
});

test("rule 8: the deepest visible Area moves, selected or not, and Shift on open canvas rubber-bands", () => {
  assert.deepEqual(meaningOfPress(context({ hit: AREA_HIT })), { kind: "move-area", area: TANGENT });
  assert.deepEqual(meaningOfPress(context({ hit: AREA_HIT, selectedArea: TANGENT })), { kind: "move-area", area: TANGENT });
  assert.deepEqual(meaningOfPress(context({ hit: AREA_HIT, selectedArea: OTTO })), { kind: "move-area", area: TANGENT }, "the press selects the deeper Area");
  assert.deepEqual(meaningOfPress(context({ hit: AREA_HIT, modifiers: { shift: true, cmdOrCtrl: false } })), { kind: "rubber-band" });
  assert.deepEqual(meaningOfPress(context({ hit: AREA_HIT, modifiers: { shift: false, cmdOrCtrl: true } })), { kind: "rubber-band" });
});

test("rule 9: nothing under the point, or a drawing tool, is a rubber band", () => {
  assert.deepEqual(meaningOfPress(context()), { kind: "rubber-band" });
  assert.deepEqual(meaningOfPress(context({ tool: "rectangle", hit: cardHit(), selectedArea: TANGENT })), { kind: "rubber-band" });
  assert.deepEqual(meaningOfPress(context({ tool: "arrow", hit: AREA_HIT })), { kind: "rubber-band" });
  assert.deepEqual(meaningOfPress(context({ tool: "custom", hit: cardHit() })), { kind: "rubber-band" });
});

test("the rule table is the nine rules in the design's order, and the last always answers", () => {
  assert.deepEqual(PRESS_RULES.map((rule) => rule.name), [
    "pan", "place-resource", "text", "editing-text", "add-to-selection", "transform-selected-area", "grab-element", "move-deepest-area", "rubber-band",
  ]);
  assert.ok(Object.isFrozen(PRESS_RULES));
  assert.deepEqual(PRESS_RULES.at(-1)?.decide(context({ tool: "hand", spaceHeld: true, hit: cardHit() })), { kind: "rubber-band" });
});
