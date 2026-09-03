import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAreaMapWorldController, createEmptyScene, runtimeId } from "../../kernel/kernel-boundary.ts";
import type { AreaMapController, RegionKey, ResourcePanelRow, ShardHash, TreeDigest, VaultDocument, World, WorldDigest, WorldId } from "../../kernel/kernel-types.ts";
import { visibleSceneFromSnapshot } from "../../input/hit-test.ts";
import { point, rect, size } from "../../units/frames.ts";
import { areaKey, resourceId, shardOwner, sourceId } from "../../units/ids.ts";
import type { AreaKey } from "../../units/ids.ts";
import { count, scenePx, screenPx, sourcePx, zoom } from "../../units/units.ts";
import type { PickerEntry } from "./picker-choices.ts";
import { openPicker, pasteReference, pickerCorpus, placeBlock, placeFirst, placementSpotOf, searchVault } from "./picker-effects.ts";
import type { PickerEnvironment, PlacementView } from "./picker-effects.ts";
import { EMPTY_PICKER_STATE, pickerReducer } from "./picker-store.ts";
import type { PickerAction, PickerState } from "./picker-store.ts";

const OTTO = areaKey("otto");
const TANGENT = areaKey("otto/tangent");
const DOCUMENTS: VaultDocument[] = [
  { file: "otto/goal-ship.md", area: OTTO, kind: "goal", title: "Ship the map", goal: true },
  { file: "otto/tangent/tangent.md", area: TANGENT, kind: "area", title: "Tangent" },
];

/** One Area node; `ready` shards carry an empty scene, `deferred` ones none. */
function areaNode(key: AreaKey, parent: string, state: "ready" | "deferred"): World["areas"][number] {
  return {
    key, parent: shardOwner(parent), children: [], depth: count(key.split("/").length - 1),
    region: { key: `${parent}>${key}` as RegionKey, owner: shardOwner(parent), child: key, sourceId: sourceId(`region-${key}`), labelSourceId: sourceId(`region-${key}-label`), source: "stored", storedRect: rect("source", sourcePx(0), sourcePx(0), sourcePx(1200), sourcePx(800)) },
    shard: { owner: shardOwner(key), hash: `hash-${key}` as ShardHash, revision: null, state, elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null, ...(state === "ready" ? { scene: createEmptyScene() } : {}) },
  };
}

/** A world where otto is loaded and otto/tangent is deferred with no loader. */
function world(): World {
  return {
    schema: "area-map-world.v1", worldId: "world" as WorldId, treeRevision: "tree" as TreeDigest, worldRevision: "rev" as WorldDigest, locatedArea: OTTO,
    rootShard: { owner: shardOwner("@root"), hash: null, revision: null, state: "deferred", elementCount: count(0), blockCount: count(0), ownBlockHull: null, ownInkHull: null },
    areas: [areaNode(OTTO, "@root", "ready"), areaNode(TANGENT, "otto", "deferred")],
  };
}

/**
 * What the Map shows in the tests: a 1280 by 800 canvas at zoom 1 showing the scene from (-100,
 * -100), with the pointer inside otto's region but left of its child's, so the deepest visible Area
 * under the placement point is otto and the dock is the right half.
 */
function placementView(controller: AreaMapController): PlacementView {
  const snapshot = controller.snapshot();
  return {
    camera: { scrollX: scenePx(100), scrollY: scenePx(100), zoom: zoom(1) },
    viewport: size("screen", screenPx(1280), screenPx(800)),
    lastPointer: point("scene", scenePx(-30), scenePx(10)),
    scene: visibleSceneFromSnapshot(snapshot),
    locatedArea: snapshot.world.locatedArea,
  };
}

/** A recording environment over a real controller. */
function harness(search?: PickerEnvironment["searchDocuments"]): { env: PickerEnvironment; controller: AreaMapController; log: string[]; state: () => PickerState } {
  const controller = createAreaMapWorldController({ world: world() });
  const log: string[] = [];
  let stored = EMPTY_PICKER_STATE;
  const env: PickerEnvironment = {
    controller,
    /** The two vault records the picker chooses from. */
    documents: () => DOCUMENTS,
    /** What the Map shows now, from which the placement spot is derived. */
    placementView: () => placementView(controller),
    /** No Resource rows; the Resource path is exercised with an explicit entry. */
    resourceChoices: () => [],
    ...(search === undefined ? {} : { searchDocuments: search }),
    /** Records that a Resource choice was handed to the placement bar. */
    placeResource: (row) => { log.push(`place-resource:${row.entity.label}`); },
    /** Records that an Area with a region was selected instead of placed again. */
    selectArea: (area) => { log.push(`select-area:${area}`); },
    /** Records the Area whose Resources the picker asked for on open. */
    loadResources: (area) => { log.push(`load-resources:${area}`); },
    /** Records the label the canvas was asked to start editing. */
    editLabel: (labelId) => { log.push(`edit-label:${labelId}`); },
    /** A fixed source id, so the placed Block's runtime id is predictable. */
    mintId: () => sourceId("block-new"),
    /** Records a spoken sentence. */
    announce: (text) => { log.push(`say:${text}`); },
    /** Applies the action through the real reducer and records its kind. */
    dispatch: (action: PickerAction) => { stored = pickerReducer(stored, action); log.push(`do:${action.kind}`); },
  };
  /** The store state the recorded dispatches have built up. */
  const state = (): PickerState => stored;
  return { env, controller, log, state };
}

/** The composed Blocks of one owner in the controller's world now. */
function blocksOf(controller: AreaMapController, area: AreaKey): string[] {
  return (controller.world().areas.find((node) => node.key === area)?.shard.scene?.elements ?? [])
    .filter((element) => element.customData?.tangent !== undefined && element.customData.tangent.role === undefined && element.containerId == null)
    .map((element) => element.id);
}

test("openPicker opens at the placement spot, docked away from the pointer, and asks for the Area's Resources", () => {
  const { env, state, log } = harness();
  const target = openPicker(env);
  assert.deepEqual([target.area, target.outside, target.dock], [OTTO, false, "right"]);
  assert.equal(state().target, target);
  assert.ok(log.includes(`load-resources:${OTTO}`));
});

test("placeBlock lands a Goal in the spot's shard, selects it and starts editing its label", async () => {
  const { env, controller, state, log } = harness();
  const target = openPicker(env);
  const goal: PickerEntry = { kind: "goal", ref: "otto/goal-ship.md", title: "Ship the map" };
  assert.equal(await placeBlock(env, goal, target, false), true);
  assert.deepEqual(blocksOf(controller, OTTO), ["block-new"]);
  const placedId = runtimeId(shardOwner("otto"), sourceId("block-new"));
  assert.deepEqual([...controller.snapshot().selection], [placedId]);
  assert.ok(log.includes(`edit-label:${runtimeId(shardOwner("otto"), sourceId("block-new-tangent-label"))}`), log.join("\n"));
  assert.equal(state().target, null);
  assert.equal(controller.undo(), true, "the placement is one command in the Map's history");
  assert.deepEqual(blocksOf(controller, OTTO), []);
});

test("placementSpotOf lands on the pointer when it is on screen and names the visible Area under it", () => {
  const { env, controller } = harness();
  const view = placementView(controller);
  assert.deepEqual(placementSpotOf(view), { area: OTTO, point: view.lastPointer });
  const panned: PlacementView = { ...view, lastPointer: point("scene", scenePx(90_000), scenePx(90_000)) };
  assert.deepEqual(placementSpotOf(panned).point, { x: 540, y: 300 }, "a pointer left off screen falls back to the viewport centre");
  assert.equal(openPicker(env).area, OTTO);
});

test("Shift keeps the picker open and skips the label edit", async () => {
  const { env, state, log } = harness();
  const target = openPicker(env);
  await placeBlock(env, { kind: "document", ref: "otto/design.md", title: "Design" }, target, true);
  assert.notEqual(state().target, null);
  assert.ok(!log.some((entry) => entry.startsWith("edit-label:")));
});

test("a Resource choice goes to the placement bar and an existing Area is selected instead of placed", async () => {
  const { env, log, controller } = harness();
  const target = openPicker(env);
  const row: ResourcePanelRow = { viewedFrom: OTTO, relation: { kind: "own" }, launchMatch: { state: "current", value: false }, entity: { locator: { owner: shardOwner("otto"), id: resourceId("wt-a") }, label: "Checkout A", target: null, representation: "never-placed" } };
  await placeBlock(env, { kind: "resource", ref: "wt-a", title: "Checkout A", resourceRow: row }, target, false);
  assert.ok(log.includes("place-resource:Checkout A"));
  await placeBlock(env, { kind: "area", ref: "otto/tangent/tangent.md", title: "Tangent", area: TANGENT }, target, false);
  assert.ok(log.includes(`select-area:${TANGENT}`));
  assert.deepEqual(blocksOf(controller, OTTO), []);
});

test("a shard that cannot load refuses placement and says so", async () => {
  const { env, log } = harness();
  const target = openPicker(env);
  const placed = await placeBlock(env, { kind: "goal", ref: "x.md", title: "X", owner: shardOwner("otto/tangent") }, target, false);
  assert.equal(placed, false);
  assert.equal(log.at(-1), "say:Placement is unavailable until the source Map loads.");
});

test("placeFirst places the first entry and is false with none", async () => {
  const { env, controller } = harness();
  const target = openPicker(env);
  assert.equal(await placeFirst(env, [], target, false), false);
  assert.equal(await placeFirst(env, [{ kind: "goal", ref: "otto/goal-ship.md", title: "Ship the map" }], target, false), true);
  assert.equal(blocksOf(controller, OTTO).length, 1);
});

test("pasteReference claims a vault reference and leaves plain prose alone", async () => {
  const { env, controller } = harness();
  assert.equal(pasteReference(env, "just some words"), false);
  assert.equal(pasteReference(env, "otto/goal-ship.md"), true);
  await Promise.resolve();
  assert.equal(blocksOf(controller, OTTO).length, 1);
});

test("searchVault dispatches results while wide, says when the search fails, and aborts on cleanup", async () => {
  const found = harness(async () => [{ file: "neara/goal.md", kind: "goal", title: "Found" }]);
  const stop = searchVault(found.env, true, "fo");
  await Promise.resolve();
  assert.equal(found.state().entities.length, 1);
  assert.equal(pickerCorpus(found.env, found.state()).length, DOCUMENTS.length + 1);
  stop();
  const failed = harness(async () => { throw new Error("offline"); });
  searchVault(failed.env, true, "x");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(failed.log.at(-1), "say:Vault search is unavailable; showing known Map entities");
  const aborted = harness(async (_query, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError"))); }));
  searchVault(aborted.env, true, "x")();
  await Promise.resolve();
  assert.equal(aborted.log.length, 0);
  assert.equal(harness().env.searchDocuments, undefined);
  searchVault(harness().env, true, "x")();
});
