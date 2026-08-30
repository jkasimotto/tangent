import assert from "node:assert/strict";
import test from "node:test";

import core from "./public/area-board-core.js";
import { createAreaMapWorldController, ownerForNewAreaMapElement } from "./public/area-map-world-controller.js";

/** Creates one small complete world with source-owned content. */
function fixtureWorld() {
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({ id: "proof", kind: "goal", ref: "neara/delivery/goal-proof.md", title: "Proof", x: 80, y: 90 }));
  const records = [
    ["neara", "@root", { x: 60, y: 60, width: 900, height: 700 }, core.createEmptyScene()],
    ["neara/delivery", "neara", { x: 80, y: 80, width: 600, height: 440 }, scene],
  ];
  return {
    schema: "area-map-world.v1", worldId: "world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "neara/delivery",
    rootShard: { owner: "@root", hash: "root-1", state: "deferred" },
    areas: records.map(([key, parent, storedRect, source]) => ({
      key, parent, children: records.filter((entry) => entry[1] === key).map((entry) => entry[0]), depth: key.split("/").length - 1,
      region: { key: `${parent}>${key}`, owner: parent, child: key, sourceId: `region-${key}`, labelSourceId: `region-${key}-label`, source: "stored", storedRect },
      shard: { owner: key, hash: `hash-${key}`, state: "ready", elementCount: source.elements.length, scene: source },
    })),
  };
}

/** Supplies deterministic private storage without browser globals. */
function memoryStorage() {
  const values = new Map();
  return {
    /** Reads one private view value. */
    getItem: (key) => values.get(key) ?? null,
    /** Stores one private view value. */
    setItem: (key, value) => values.set(key, value),
    /** Removes one private view value. */
    removeItem: (key) => values.delete(key),
  };
}

test("duplicate, paste, and bound-arrow ownership use their explicit command boundary", () => {
  assert.equal(ownerForNewAreaMapElement({ copiedOwner: "neara", pointOwner: "neara/delivery" }), "neara");
  assert.equal(ownerForNewAreaMapElement({ copiedOwner: "neara", pasteOwner: "neara/delivery", pointOwner: "neara" }), "neara/delivery");
  assert.equal(ownerForNewAreaMapElement({ startOwner: "neara/delivery", pointOwner: "neara" }), "neara/delivery");
  assert.equal(ownerForNewAreaMapElement({ pointOwner: "neara" }), "neara");
});

test("view masks and camera history never replace complete world authority", () => {
  const saves = [];
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(),
    /** Captures unexpected authored saves. */
    persistWorld: (...args) => saves.push(args),
    /** Supplies one Focus-visible Goal. */
    getDocuments: () => [{ file: "neara/delivery/goal-proof.md", area: "neara/delivery", kind: "goal", title: "Proof", status: "active" }],
  });
  const before = controller.world();
  controller.setFocus({ only: true, areas: ["neara/elsewhere"] });
  controller.toggleFold("neara");
  controller.setCamera({ scrollX: 30, scrollY: -20, zoom: 0.5 });
  const cameraRevision = controller.snapshot().revision;
  controller.setCamera({ scrollX: 30, scrollY: -20, zoom: 0.5 });
  assert.equal(controller.snapshot().revision, cameraRevision, "an identical Excalidraw scroll callback is a no-op");
  assert.deepEqual(controller.world(), before);
  assert.equal(controller.snapshot().composition.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region").length, 2);
  assert.ok(controller.snapshot().composition.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region").every((element) => !element.locked && !element.isDeleted));
  assert.equal(saves.length, 0);

  controller.toggleFold("neara");
  controller.selectArea("neara/delivery");
  assert.equal(controller.escape().kind, "selection");
  controller.fitArea("neara");
  controller.escape();
  assert.equal(controller.escape().kind, "camera");
  assert.equal(controller.snapshot().selection.size, 0);
  assert.equal(controller.snapshot().nextEscape, "Esc → Work");
  controller.destroy();
});

test("server world view initializes camera but never overrides the newly opened Area", async () => {
  const world = fixtureWorld();
  world.view = { schema: "area-map-view.v2", worldId: "world", locatedArea: "neara", pan: { x: 12, y: -9 }, zoom: 0.75, foldedAreas: ["neara/delivery"], detailAreas: ["neara"] };
  const views = [];
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Captures the persisted world view. */
    persistView: async (value) => views.push(value),
  });
  assert.equal(controller.snapshot().viewRestored, true);
  assert.equal(controller.snapshot().locatedArea, "neara/delivery");
  assert.deepEqual(controller.snapshot().camera, { scrollX: 12, scrollY: -9, zoom: 0.75 });
  const authority = controller.world();
  controller.fitArea("neara");
  assert.equal(controller.snapshot().locatedArea, "neara");
  assert.deepEqual(controller.world(), authority);
  controller.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(views.at(-1).worldId, "world");
  assert.equal(Object.hasOwn(views.at(-1), "locatedArea"), false);
});

test("one immutable region gesture saves and undoes with the same owner set", async () => {
  const saves = [];
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(),
    /** Captures each gesture transaction. */
    persistWorld: async (world, changedAreas, changedOwners, _command, direction) => {
      saves.push({ world: structuredClone(world), areas: [...changedAreas], owners: [...changedOwners], direction });
      return { status: 200, hashes: { neara: `neara-${saves.length}` }, worldRevision: `world-${saves.length + 1}` };
    },
  });
  const next = controller.world();
  next.areas.find((node) => node.key === "neara/delivery").region.storedRect.x += 45;
  controller.beginGesture("pointer");
  controller.preview(next, { changedAreas: ["neara/delivery"] });
  controller.endGesture();
  await controller.flush();
  assert.deepEqual(saves.map(({ areas, owners, direction }) => ({ areas, owners, direction })), [{ areas: ["neara/delivery"], owners: [], direction: "after" }]);
  controller.undo();
  await controller.flush();
  assert.deepEqual(saves[1].areas, ["neara/delivery"]);
  assert.equal(saves[1].direction, "before");
  controller.destroy();
});

test("failed and later commands recover from world-keyed private draft storage", async () => {
  let stored = null;
  const draftStore = {
    /** Reads the matching recovery draft. */
    async load(worldId) { return stored?.worldId === worldId ? structuredClone(stored) : null; },
    /** Stores the latest recovery draft. */
    async save(record) { stored = structuredClone(record); },
    /** Removes the recovered draft. */
    async remove() { stored = null; },
  };
  const first = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Simulates one server conflict. */
    persistWorld: async () => ({ status: 409, error: "changed elsewhere" }),
  });
  const changed = first.world(); changed.areas[1].region.storedRect.x += 25;
  first.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await first.flush();
  const later = first.world(); later.areas[1].region.storedRect.y += 30;
  first.commitWorld(later, { changedAreas: ["neara/delivery"] }, "nudge");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stored.schema, "area-map-draft.v1");
  assert.equal(stored.worldId, "world");
  assert.equal(stored.locatedArea, "neara/delivery");
  assert.ok(stored.pending.length >= 2);
  assert.deepEqual(stored.owners, ["neara"]);
  first.destroy();

  const recoveredSaves = [];
  const second = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Captures each recovered command. */
    persistWorld: async (_world, areas) => { recoveredSaves.push([...areas]); return { status: 200, hashes: { neara: "saved" } }; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(second.snapshot().draft);
  assert.equal(second.restoreDraft(), true);
  await second.retry();
  assert.ok(recoveredSaves.length >= 2);
  assert.equal(stored, null);
  second.destroy();
});

test("reload cancels a stale save and preserves private world view state", async () => {
  let finishSave;
  const saving = new Promise((resolve) => { finishSave = resolve; });
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(),
    /** Holds one save until reload replaces its authority. */
    persistWorld: () => saving,
  });
  controller.setFocus({ only: true, areas: ["neara"] });
  controller.toggleFold("neara/delivery");
  controller.setCamera({ scrollX: 41, scrollY: -17, zoom: 0.8 });
  controller.fitArea("neara");
  const changed = controller.world(); changed.areas[1].region.storedRect.x += 10;
  controller.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fresh = fixtureWorld(); fresh.worldRevision = "fresh-world"; fresh.rootShard.hash = "fresh-root";
  await controller.reload(fresh);
  finishSave({ status: 200, hashes: { "@root": "stale-root" }, worldRevision: "stale-world" });
  await controller.flush();

  const snapshot = controller.snapshot();
  assert.equal(controller.world().worldRevision, "fresh-world");
  assert.equal(controller.world().rootShard.hash, "fresh-root");
  assert.deepEqual(snapshot.focus, { only: true, areas: ["neara"] });
  assert.equal(snapshot.folded.has("neara/delivery"), true);
  assert.deepEqual(snapshot.camera, { scrollX: 41, scrollY: -17, zoom: 0.8 });
  assert.equal(snapshot.locatedArea, "neara");
  assert.equal(controller.undo(), false);
  controller.destroy();
});

test("a failed deferred shard stays structural and retries against the current revision", async () => {
  const world = fixtureWorld();
  const deferred = world.areas.find((node) => node.key === "neara/delivery");
  deferred.shard = { owner: deferred.key, hash: "deferred-hash", state: "deferred", elementCount: 2, blockCount: 1 };
  const calls = [];
  const events = [];
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Captures coordinate-free load events. */
    onEvent: (event) => events.push(event),
    /** Fails once and then returns the current shard revision. */
    loadShard: async (area, context) => {
      calls.push({ area, ...context });
      if (calls.length === 1) throw new Error("offline");
      return { owner: area, state: "ready", hash: "loaded", worldRevision: context.worldRevision, scene: core.createEmptyScene() };
    },
  });
  const regionId = controller.snapshot().composition.scene.elements.find((element) => element.customData?.tangent?.area === deferred.key).id;
  assert.equal((await controller.materialize(deferred.key)).state, "load-error");
  assert.ok(controller.snapshot().composition.scene.elements.some((element) => element.id === regionId && !element.isDeleted && !element.locked));
  assert.equal((await controller.materialize(deferred.key)).state, "ready");
  assert.deepEqual(calls.map(({ worldRevision }) => worldRevision), ["world-1", "world-1"]);
  assert.deepEqual(events.map(({ name, state }) => [name, state]), [
    ["area_map_world_loaded", undefined],
    ["area_map_shard_loaded", "load-error"],
    ["area_map_shard_loaded", "ready"],
  ]);
  assert.ok(events.every((event) => !Object.hasOwn(event, "x") && !Object.hasOwn(event, "y")));
  const composition = controller.snapshot().composition;
  controller.refreshFacts({ only: true, areas: ["neara"] });
  assert.equal(controller.snapshot().composition, composition, "fact polling keeps the mounted composition authority");
  controller.destroy();
});

test("a structural fact poll reconciles a changed tree without replacing session view", async () => {
  const initial = fixtureWorld();
  const fresh = fixtureWorld();
  fresh.treeRevision = "tree-2"; fresh.worldRevision = "world-2";
  fresh.areas.find((node) => node.key === "neara/delivery").children.push("neara/delivery/standards");
  fresh.areas.push({
    key: "neara/delivery/standards", parent: "neara/delivery", children: [], depth: 2,
    region: {
      key: "neara/delivery>neara/delivery/standards", owner: "neara/delivery", child: "neara/delivery/standards",
      sourceId: "region-neara/delivery/standards", labelSourceId: "region-neara/delivery/standards-label", source: "stored",
      storedRect: { x: 100, y: 100, width: 360, height: 260 },
    },
    shard: { owner: "neara/delivery/standards", hash: "hash-standards", state: "ready", elementCount: 0, blockCount: 0, scene: core.createEmptyScene() },
  });
  const events = [];
  const controller = createAreaMapWorldController({
    world: initial, storage: memoryStorage(),
    /** Returns one changed structural authority. */
    reloadWorld: async () => structuredClone(fresh),
    /** Captures structural reconciliation events. */
    onEvent: (event) => events.push(event),
  });
  controller.selectArea("neara/delivery");
  const selectedBefore = [...controller.snapshot().selection];
  controller.setCamera({ scrollX: 44, scrollY: -21, zoom: 0.65 });
  controller.toggleFold("neara");

  assert.equal(await controller.refreshFacts({ only: true, areas: ["neara"] }), true);
  const snapshot = controller.snapshot();
  assert.equal(controller.world().treeRevision, "tree-2");
  assert.equal(snapshot.world.areas.length, 3);
  assert.equal(snapshot.composition.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region").length, 3);
  assert.deepEqual([...snapshot.selection], selectedBefore);
  assert.deepEqual(snapshot.camera, { scrollX: 44, scrollY: -21, zoom: 0.65 });
  assert.equal(snapshot.folded.has("neara"), true);
  assert.equal(controller.undo(), false, "a changed tree clears authored history against the old topology");
  assert.ok(events.some((event) => event.name === "area_map_tree_reconciled" && event.areaCount === 3));
  controller.destroy();
});
