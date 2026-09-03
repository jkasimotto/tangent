import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ProjectionReason, ProjectionRequest, ProjectionToken } from "../canvas/projection.ts";
import type { SceneElement, Selection } from "../kernel/kernel-types.ts";
import { rect } from "../units/frames.ts";
import type { Rect } from "../units/frames.ts";
import { areaKey, runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { scenePx } from "../units/units.ts";
import { applySubordination, regionIdsOf, selectionForMeaning } from "./excalidraw-subordination.ts";
import type { SelectionWriter } from "./excalidraw-subordination.ts";
import { elementRect, hitTest } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";
import { nudgeMeaning } from "./nudge.ts";
import { meaningOfPress } from "./press-meaning.ts";
import type { PressMeaning } from "./press-meaning.ts";

const OTTO = areaKey("otto");
const TANGENT = areaKey("otto/tangent");

/** A scene rect from raw test numbers. */
const box = (x: number, y: number, width: number, height: number): Rect<"scene"> => rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));

/** One composed element with the fields the subordination and the hit test read. */
function element(id: string, bounds: Rect<"scene">, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id: runtimeId(id), type: "rectangle", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    angle: 0 as SceneElement["angle"], strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, ...extra,
  };
}

/** An Area region element, the thing `move-area` must leave selected alone. */
function region(area: string, bounds: Rect<"scene">): SceneElement {
  return element(`region-${area}`, bounds, { customData: { tangent: { role: "area-region", area: areaKey(area) } } });
}

/** The nested world every test here presses into: a parent Area holding a child Area holding a Block. */
const ELEMENTS: readonly SceneElement[] = [
  region("otto", box(0, 0, 1000, 1000)),
  region("otto/tangent", box(100, 100, 400, 400)),
  element("block", box(150, 150, 100, 100), { customData: { tangent: { kind: "goal", ref: "block" } } }),
];

const REGIONS = regionIdsOf(ELEMENTS);
const PARENT_REGION = runtimeId("region-otto");
const CHILD_REGION = runtimeId("region-otto/tangent");

/** The visible scene over those elements, with both Areas in scope. */
function scene(): VisibleScene {
  const regionRects = new Map([[OTTO, elementRect(ELEMENTS[0] as SceneElement)], [TANGENT, elementRect(ELEMENTS[1] as SceneElement)]]);
  return { elements: ELEMENTS, regionRects, hiddenIds: new Set(), scopedAreas: new Set([OTTO, TANGENT]), folded: new Set(), zoom: 1 as VisibleScene["zoom"] };
}

/** One recorded projection push. */
type Push = { request: ProjectionRequest; reason: ProjectionReason };

/** A projection that records what the subordination pushed instead of touching Excalidraw. */
function writer(): { writer: SelectionWriter; pushes: Push[] } {
  const pushes: Push[] = [];
  /** Records one push instead of touching Excalidraw. */
  const project = (request: ProjectionRequest, reason: ProjectionReason): ProjectionToken | null => {
    pushes.push({ request, reason });
    return null;
  };
  return { writer: { project }, pushes };
}

/** The ids one subordination holds, as a sorted list, so a test compares selections by value. */
function held(selection: Selection | undefined): string[] {
  return [...(selection ?? new Set<RuntimeId>())].sort();
}

test("a press that moves a sub-Area selects that sub-Area alone while its parent is selected", () => {
  const parentSelected: Selection = new Set([PARENT_REGION]);
  const subordination = selectionForMeaning({ kind: "move-area", area: TANGENT }, parentSelected, REGIONS);
  assert.ok(subordination !== null);
  assert.deepEqual(held(subordination.ids), [CHILD_REGION]);
  assert.equal(subordination.reason, "pointer-down-selection");
});

test("the sub-Area is written into Excalidraw before any move frame", () => {
  const excalidraw = writer();
  const parentSelected: Selection = new Set([PARENT_REGION]);
  applySubordination(excalidraw.writer, selectionForMeaning({ kind: "move-area", area: TANGENT }, parentSelected, REGIONS));
  assert.equal(excalidraw.pushes.length, 1);
  const push = excalidraw.pushes[0];
  assert.deepEqual(held(push?.request.selection as Selection | undefined), [CHILD_REGION]);
  assert.equal(push?.request.elements, undefined, "a subordination writes the selection and nothing else");
  assert.equal(push?.reason, "pointer-down-selection");
});

test("a resize keeps the region it drags", () => {
  const selected: Selection = new Set([CHILD_REGION]);
  const subordination = selectionForMeaning({ kind: "resize-area", area: TANGENT, handle: "se" }, selected, REGIONS);
  assert.deepEqual(held(subordination?.ids), [CHILD_REGION]);
});

test("a grab takes the element, and keeps the group when the element is already in it", () => {
  const alone = selectionForMeaning({ kind: "grab-element", id: runtimeId("block") }, new Set([PARENT_REGION]), REGIONS);
  assert.deepEqual(held(alone?.ids), ["block"]);
  assert.equal(alone?.reason, "stale-region-release");
  const group: Selection = new Set([runtimeId("block"), runtimeId("other")]);
  const kept = selectionForMeaning({ kind: "grab-element", id: runtimeId("block") }, group, REGIONS);
  assert.deepEqual(held(kept?.ids), ["block", "other"]);
});

test("a modifier press adds to the selection it found", () => {
  const subordination = selectionForMeaning({ kind: "add-to-selection", id: runtimeId("block") }, new Set([PARENT_REGION]), REGIONS);
  assert.deepEqual(held(subordination?.ids), ["block", PARENT_REGION].sort());
  assert.equal(subordination?.reason, "additive-pointer-selection");
});

test("a rubber band and a pan clear what the Map held", () => {
  const selected: Selection = new Set([CHILD_REGION]);
  assert.deepEqual(held(selectionForMeaning({ kind: "rubber-band" }, selected, REGIONS)?.ids), []);
  assert.deepEqual(held(selectionForMeaning({ kind: "pan" }, selected, REGIONS)?.ids), []);
});

test("a meaning with no opinion writes nothing at all", () => {
  const excalidraw = writer();
  const selected: Selection = new Set([CHILD_REGION]);
  const quiet: PressMeaning[] = [
    { kind: "ignore", reason: "rotation" },
    { kind: "ignore", reason: "hidden" },
    { kind: "ignore", reason: "editing-text" },
    { kind: "text", point: { x: scenePx(0), y: scenePx(0) } as never },
    { kind: "place-resource", point: { x: scenePx(0), y: scenePx(0) } as never },
  ];
  for (const meaning of quiet) {
    assert.equal(selectionForMeaning(meaning, selected, REGIONS), null);
    assert.equal(applySubordination(excalidraw.writer, selectionForMeaning(meaning, selected, REGIONS)), null);
  }
  assert.equal(excalidraw.pushes.length, 0);
});

test("an Area with no region in the scene subordinates nothing", () => {
  assert.equal(selectionForMeaning({ kind: "move-area", area: areaKey("otto/absent") }, new Set(), REGIONS), null);
});

test("the region table names every Area region and nothing else", () => {
  assert.deepEqual([...REGIONS.entries()].sort(), [[OTTO, PARENT_REGION], [TANGENT, CHILD_REGION]].sort());
  assert.equal(regionIdsOf([]).size, 0);
});

test("a keyboard nudge subordinates the same way a press does", () => {
  const selected: Selection = new Set([CHILD_REGION]);
  const meaning = nudgeMeaning(scene(), selected);
  assert.ok(meaning !== null);
  assert.deepEqual(held(selectionForMeaning(meaning, selected, REGIONS)?.ids), [CHILD_REGION]);
});

test("the whole press path, from the point to the write, hands a sub-Area press to that sub-Area", () => {
  const visible = scene();
  const parentSelected: Selection = new Set([PARENT_REGION]);
  const inside = { x: scenePx(400), y: scenePx(400) } as never;
  const meaning = meaningOfPress({
    point: inside, modifiers: { shift: false, cmdOrCtrl: false }, spaceHeld: false, tool: "selection", placementOpen: false,
    editingText: false, selection: parentSelected, selectedArea: OTTO, command: { kind: "move", handle: null }, hit: hitTest(visible, inside),
  });
  assert.deepEqual(meaning, { kind: "move-area", area: TANGENT });
  const excalidraw = writer();
  applySubordination(excalidraw.writer, selectionForMeaning(meaning, parentSelected, REGIONS));
  assert.deepEqual(held(excalidraw.pushes[0]?.request.selection as Selection | undefined), [CHILD_REGION]);
});
