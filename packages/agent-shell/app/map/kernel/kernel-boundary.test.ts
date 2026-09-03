import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as boundary from "./kernel-boundary.ts";
import { delta, rect } from "../units/frames.ts";
import { areaKey, shardOwner, sourceId } from "../units/ids.ts";
import { scenePx, sourcePx } from "../units/units.ts";
import type { GestureBaseline, Region } from "./kernel-types.ts";

/** Every name the boundary promises, grouped by the kernel module it comes from. */
const EXPECTED_EXPORTS = {
  controller: ["createAreaMapWorldController", "areaMapPointerCommand", "areaMapProjectionUpdate", "selectedAreaMapRegionChanges", "ownerForNewAreaMapElement", "areaMapStructuralHullChanged", "areaMapDeferredLoadPlan"],
  worldCore: ["AREA_MAP_LAYOUT", "composeAreaMapWorld", "solveAreaMapGesture", "solveOwnedElementGesture", "nearestFreeRectangle", "placeBlockAtNearestFreePoint", "placeBlockInSourceScene", "splitComposed", "unionRects", "inflateRect", "runtimeId", "regionId", "regionKey", "shardHulls", "detachCrossOwnerTextBindings", "reprioritizeAreaPlacement", "protectAreaRegions", "sourceAreaContentBounds"],
  boardCore: ["areaForBlock", "authoredFingerprint", "createEmptyScene", "entityChoices", "insertionPoint", "isAreaBoundary", "isAreaRegion", "referenceFromText", "sceneForSave", "setBlockHidden", "tangentOf"],
  entities: ["resolveMapEntity", "resourceLocatorKey", "runMapEntityAction", "selectedMapEntityElement", "isMapEntityBlock", "mapEntityLocator", "isSafeResourceId"],
  figures: ["figureIconFiles", "restoreFigurePresentation", "themeInkColor", "figureIconFileId"],
  find: ["mapFindMatches", "mapFindTextMatches", "areaInRestriction"],
  picker: ["pickerSections", "filterChoices", "wideChoices"],
  keyboard: ["resolveKeyboardContext", "keyboardEventIsComposing"],
} as const;

/** Reads one boundary export by name without the compiler narrowing the module shape. */
function exported(name: string): unknown {
  return (boundary as Record<string, unknown>)[name];
}

test("every promised export exists and is a function or an object", () => {
  for (const [module, names] of Object.entries(EXPECTED_EXPORTS)) {
    for (const name of names) {
      const value = exported(name);
      assert.ok(value !== undefined, `${module}: ${name} is missing from kernel-boundary.ts`);
      assert.ok(["function", "object"].includes(typeof value), `${module}: ${name} is a ${typeof value}, not a function or object`);
    }
  }
});

test("the boundary exports nothing the test does not name", () => {
  const promised = new Set<string>(Object.values(EXPECTED_EXPORTS).flat());
  const unexpected = Object.keys(boundary).filter((name) => !promised.has(name));
  assert.deepEqual(unexpected, [], "add each new export to EXPECTED_EXPORTS so its presence is proved");
});

test("the layout constant carries the kernel's named numbers", () => {
  assert.equal(typeof boundary.AREA_MAP_LAYOUT.spacing, "number");
  assert.equal(boundary.AREA_MAP_LAYOUT.placementSchema, "area-placement.v1");
});

test("ids minted through the boundary are the kernel's own strings", () => {
  const owner = shardOwner("otto");
  const child = areaKey("otto/tangent");
  assert.match(boundary.runtimeId(owner, sourceId("block-1")), /^tw-/);
  assert.match(boundary.regionId(owner, child), /^tangent-region-/);
  assert.equal(boundary.regionKey(owner, child), "otto>otto/tangent");
});

/** One stored region for the solver tests, in its parent's source frame. */
function region(parent: string, child: string): Region {
  return {
    key: boundary.regionKey(shardOwner(parent), areaKey(child)),
    owner: shardOwner(parent),
    child: areaKey(child),
    sourceId: boundary.regionId(shardOwner(parent), areaKey(child)),
    labelSourceId: sourceId(`${boundary.regionId(shardOwner(parent), areaKey(child))}-label`),
    source: "stored",
    storedRect: rect("source", sourcePx(60), sourcePx(60), sourcePx(460), sourcePx(320)),
  };
}

/** A one-Area baseline with no content hulls. */
function baseline(): GestureBaseline {
  return {
    areas: [areaKey("otto/tangent")],
    regions: new Map([[areaKey("otto/tangent"), region("otto", "otto/tangent")]]),
    blockHulls: new Map(),
    inkHulls: new Map(),
  };
}

test("the Area solver reads a scene delta and answers with one", () => {
  const moved = boundary.solveAreaMapGesture(baseline(), { selectedAreas: [areaKey("otto/tangent")], handle: null, desiredWorldDelta: delta("scene", scenePx(10), scenePx(-5)) });
  assert.deepEqual(moved.appliedDelta, { dx: 10, dy: -5 });
  assert.equal(moved.valid, true);
  assert.ok(moved.changedAreas.has(areaKey("otto/tangent")));
  assert.equal(moved.regions.get(areaKey("otto/tangent"))?.storedRect.x, 70);
  const still = boundary.solveAreaMapGesture(baseline(), { selectedAreas: [], handle: null, desiredWorldDelta: delta("scene", scenePx(0), scenePx(0)) });
  assert.deepEqual(still.appliedDelta, { dx: 0, dy: 0 });
});

test("the owned-element solver applies an ink move in full and reports no geometry", () => {
  const solved = boundary.solveOwnedElementGesture(baseline(), {
    owner: shardOwner("otto/tangent"),
    kind: "ink",
    rect: rect("source", sourcePx(0), sourcePx(0), sourcePx(20), sourcePx(20)),
    remainingBlockHull: null,
    desiredWorldDelta: delta("scene", scenePx(3), scenePx(4)),
  });
  assert.deepEqual(solved.appliedDelta, { dx: 3, dy: 4 });
  assert.equal(solved.geometry, null);
  assert.deepEqual(solved.rect, { x: 3, y: 4, width: 20, height: 20 });
});

test("an empty scene has no hulls and an empty fingerprint", () => {
  const empty = boundary.createEmptyScene();
  assert.equal(boundary.authoredFingerprint(empty.elements), "[]");
  assert.deepEqual(boundary.shardHulls(empty), { blocks: null, ink: null });
});
