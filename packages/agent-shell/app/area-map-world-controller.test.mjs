import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import core from "./public/area-board-core.js";
import { areaMapProjectionUpdate, createAreaMapWorldController, ownerForNewAreaMapElement, selectedAreaMapRegionChanges } from "./public/area-map-world-controller.js";

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

/** Creates the current-vault-size structural fixture for deterministic budgets. */
function fortyOneAreaWorld() {
  const entries = [
    ["atlas", "@root", { x: 40, y: 40, width: 12_000, height: 8_000 }, "ready"],
    ["atlas/focus", "atlas", { x: 100, y: 100, width: 6_000, height: 5_000 }, "deferred"],
    ...Array.from({ length: 35 }, (_, index) => [
      `atlas/focus/item-${String(index).padStart(2, "0")}`,
      "atlas/focus",
      { x: 140 + index % 7 * 760, y: 180 + Math.floor(index / 7) * 720, width: 620, height: 520 },
      "deferred",
    ]),
    ["atlas/near-a", "atlas", { x: 6_300, y: 200, width: 500, height: 420 }, "deferred"],
    ["atlas/near-b", "atlas", { x: 6_900, y: 260, width: 500, height: 420 }, "deferred"],
    ["atlas/far", "atlas", { x: 10_800, y: 6_800, width: 500, height: 420 }, "deferred"],
    ["other", "@root", { x: 20_000, y: 20_000, width: 800, height: 600 }, "deferred"],
  ];
  return {
    schema: "area-map-world.v1", worldId: "world-41", treeRevision: "tree-41", worldRevision: "revision-41", locatedArea: "atlas/focus",
    rootShard: { owner: "@root", hash: "root-41", state: "deferred" },
    areas: entries.map(([key, parent, storedRect, state]) => ({
      key,
      parent,
      children: entries.filter((entry) => entry[1] === key).map((entry) => entry[0]),
      depth: key.split("/").length - 1,
      region: { key: `${parent}>${key}`, owner: parent, child: key, sourceId: `region-${key}`, labelSourceId: `region-${key}-label`, source: "stored", storedRect },
      shard: {
        owner: key, hash: `hash-${key}`, state, elementCount: 0, blockCount: 0,
        ...(state === "ready" ? { scene: core.createEmptyScene() } : {}),
      },
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

test("delayed hull projections never become stored Area moves", () => {
  const region = {
    id: "runtime-region", type: "rectangle", x: -250.9, y: 60, width: 1_230.9, height: 700, isDeleted: false,
    customData: { tangent: { role: "area-region", area: "neara" } },
  };
  const rectangles = new Map([["neara", { x: 80, y: 60, width: 900, height: 700 }]]);
  assert.deepEqual(selectedAreaMapRegionChanges([region], [], rectangles), [], "unselected automatic growth is view geometry only");
  assert.deepEqual(selectedAreaMapRegionChanges([region], [region.id], rectangles), [], "selection does not grant source authority to a projection callback");
  assert.deepEqual(selectedAreaMapRegionChanges([region], [region.id], rectangles, { geometryCommand: "fact-projection" }), [], "fact projection geometry stays derived");
  assert.deepEqual(selectedAreaMapRegionChanges([region], [region.id], rectangles, { geometryCommand: "keyboard-nudge" }), [region], "an explicit keyboard nudge can change stored geometry");
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
  controller.setRestriction(null);
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

test("Only deletes unrelated regions and owner content from the render projection", () => {
  const world = fixtureWorld();
  const delivery = world.areas.find((node) => node.key === "neara/delivery");
  delivery.shard.scene.elements.push(core.createShapeElement({
    id: "cross-scope-arrow", type: "arrow", x: 40, y: 40, width: 80, height: 40,
    customData: { tangentWorldEndpoints: { start: { owner: "neara/delivery", sourceId: "proof" }, end: { owner: "neara/elsewhere", sourceId: "elsewhere-ink" } } },
  }));
  const elsewhere = core.createEmptyScene();
  elsewhere.elements.push(core.createShapeElement({ id: "elsewhere-ink", x: 20, y: 20, width: 100, height: 70 }));
  elsewhere.elements.push(...core.createBlockElements({ id: "elsewhere-block", kind: "document", ref: "neara/elsewhere/note.md", title: "Elsewhere", x: 150, y: 30 }));
  world.areas.find((node) => node.key === "neara").children.push("neara/elsewhere");
  world.areas.push({
    key: "neara/elsewhere", parent: "neara", children: [], depth: 1,
    region: { key: "neara>neara/elsewhere", owner: "neara", child: "neara/elsewhere", sourceId: "region-neara/elsewhere", labelSourceId: "region-neara/elsewhere-label", source: "stored", storedRect: { x: 700, y: 80, width: 300, height: 240 } },
    shard: { owner: "neara/elsewhere", hash: "hash-neara/elsewhere", state: "ready", elementCount: elsewhere.elements.length, scene: elsewhere },
  });
  const controller = createAreaMapWorldController({ world, storage: memoryStorage() });
  const authority = controller.world();
  const projected = controller.snapshot().scene.elements;
  const byArea = new Map(projected.filter((element) => element.customData?.tangent?.role === "area-region").map((element) => [element.customData.tangent.area, element]));
  assert.equal(byArea.get("neara").isDeleted, false);
  assert.equal(byArea.get("neara/delivery").isDeleted, false);
  assert.equal(byArea.get("neara/elsewhere").isDeleted, true);
  for (const sourceId of ["elsewhere-ink", "elsewhere-block", "elsewhere-block-tangent-label", "cross-scope-arrow"]) {
    assert.equal(projected.find((element) => element.customData?.tangentWorld?.sourceId === sourceId)?.isDeleted, true, `${sourceId} is outside the exact projection`);
  }
  assert.deepEqual(controller.world(), authority, "the complete world stays authoritative");
  controller.destroy();
});

test("stored ancestor folds cannot hide the restricted target", () => {
  const controller = createAreaMapWorldController({ world: fortyOneAreaWorld(), storage: memoryStorage() });
  const authority = controller.world();
  controller.setRestriction(null);
  controller.toggleFold("atlas");
  controller.toggleFold("atlas/focus/item-00");
  controller.setRestriction("atlas/focus");
  const snapshot = controller.snapshot();
  assert.equal(snapshot.manualFolded.has("atlas"), true);
  assert.equal(snapshot.folded.has("atlas"), false, "the stored ancestor fold is ineffective under Only");
  assert.equal(snapshot.folded.has("atlas/focus/item-00"), true, "a descendant fold remains effective");
  assert.equal(snapshot.scene.elements.find((element) => element.customData?.tangent?.area === "atlas/focus").isDeleted, false);
  assert.equal(controller.toggleFold("atlas"), null, "a new ancestor fold is rejected while Only is active");
  controller.setRestriction(null);
  assert.deepEqual([...controller.snapshot().folded].sort(), ["atlas", "atlas/focus/item-00"]);
  assert.deepEqual(controller.world(), authority);
  controller.destroy();
});

test("Only contains the target lineage and complete subtree until Escape", () => {
  const controller = createAreaMapWorldController({ world: fortyOneAreaWorld(), storage: memoryStorage() });
  const authority = controller.world();
  assert.equal(controller.snapshot().restrictionArea, "atlas/focus", "a new visit starts restricted to its located Area");
  controller.toggleFold("atlas/near-a");
  const restricted = controller.setRestriction("atlas/focus");
  assert.deepEqual({ active: restricted.active, area: restricted.area, excludedCount: restricted.excludedCount }, { active: true, area: "atlas/focus", excludedCount: 4 });
  assert.ok(restricted.element);
  assert.deepEqual([...controller.snapshot().scopedAreas], fortyOneAreaWorld().areas.map((node) => node.key).filter((area) => area === "atlas" || area === "atlas/focus" || area.startsWith("atlas/focus/")));
  assert.equal(controller.snapshot().nextEscape, "Esc → whole map");
  controller.selectArea("atlas/focus/item-00");
  assert.equal(controller.escape().kind, "selection", "selection unwinds before the restriction");
  assert.equal(controller.escape().kind, "restriction");
  assert.equal(controller.snapshot().restrictionArea, null);
  assert.deepEqual([...controller.snapshot().folded], ["atlas/near-a"], "only the user's own fold remains");
  assert.deepEqual(controller.world(), authority, "Only never changes the unified map authority");
  controller.destroy();
});

test("Focus filters blocks without changing the isolated Area set", () => {
  const world = fixtureWorld();
  world.locatedArea = "neara";
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Supplies one inactive document for Focus projection. */
    getDocuments: () => [{ file: "neara/delivery/goal-proof.md", area: "neara/delivery", kind: "goal", title: "Proof", status: "active", live: false }],
  });
  const areasBefore = [...controller.snapshot().scopedAreas];
  controller.setFocus({ only: true, areas: ["neara/elsewhere"], activeOnly: true });
  assert.deepEqual([...controller.snapshot().scopedAreas], areasBefore);
  const visibleRegions = controller.snapshot().scene.elements.filter((element) => element.customData?.tangent?.role === "area-region" && !element.isDeleted).map((element) => element.customData.tangent.area);
  assert.deepEqual(visibleRegions, areasBefore);
  assert.equal(controller.snapshot().scene.elements.find((element) => element.customData?.tangentWorld?.sourceId === "proof")?.isDeleted, true);
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
  controller.toggleFold("neara/delivery");

  assert.equal(await controller.refreshFacts({ only: true, areas: ["neara"] }), true);
  const snapshot = controller.snapshot();
  assert.equal(controller.world().treeRevision, "tree-2");
  assert.equal(snapshot.world.areas.length, 3);
  assert.equal(snapshot.composition.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region").length, 3);
  assert.deepEqual([...snapshot.selection], selectedBefore);
  assert.deepEqual(snapshot.camera, { scrollX: 44, scrollY: -21, zoom: 0.65 });
  assert.equal(snapshot.folded.has("neara/delivery"), true);
  assert.equal(controller.undo(), false, "a changed tree clears authored history against the old topology");
  assert.ok(events.some((event) => event.name === "area_map_tree_reconciled" && event.areaCount === 3));
  controller.destroy();
});

test("Keep mine uses a new operation and reports a second external conflict", async () => {
  const attempts = [];
  const external = fixtureWorld(); external.worldRevision = "external-2"; external.rootShard.hash = "external-root";
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(),
    /** Returns the external authority used for three-way rebase. */
    reloadWorld: async () => structuredClone(external),
    /** Simulates a new external conflict on both save attempts. */
    persistWorld: async (_world, _areas, _owners, command, direction) => {
      command.operationIds ??= {};
      command.operationIds[direction] ??= `operation-${attempts.length + 1}`;
      attempts.push({ commandId: command.id, operationId: command.operationIds[direction], kind: command.kind });
      return { status: 409, conflict: true, code: "world-conflict", error: `external change ${attempts.length}` };
    },
  });
  const changed = controller.world(); changed.areas[1].region.storedRect.x += 18;
  controller.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await controller.flush();
  assert.equal(controller.snapshot().save.state, "conflict");

  const second = await controller.keepMine();
  assert.equal(second.status, 409);
  assert.equal(controller.snapshot().save.state, "conflict");
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[1].commandId, attempts[0].commandId);
  assert.notEqual(attempts[1].operationId, attempts[0].operationId);
  assert.equal(attempts[1].kind, "conflict-rebase");
  assert.ok(controller.snapshot().draft?.pending?.length, "the second conflict remains recoverable");
  controller.destroy();
});

test("selection starts its deferred shard before spatially nearby shards", async () => {
  const world = fortyOneAreaWorld();
  for (const node of world.areas) if (!["atlas/focus", "atlas/near-a", "atlas/near-b", "atlas/far"].includes(node.key)) {
    node.shard = { ...node.shard, state: "ready", scene: core.createEmptyScene() };
  }
  const calls = [];
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Records fetch start order and returns a matching shard. */
    loadShard: async (area, context) => {
      calls.push(area);
      return { owner: area, hash: `loaded-${area}`, state: "ready", worldRevision: context.worldRevision, scene: core.createEmptyScene() };
    },
  });
  controller.selectArea("atlas/focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["atlas/focus", "atlas/near-a", "atlas/near-b", "atlas/far"]);
  assert.ok(controller.world().areas.filter((node) => calls.includes(node.key)).every((node) => node.shard.state === "ready"));
  controller.destroy();
});

test("an unchanged structural poll needs no scene compose or Excal update", async () => {
  const world = fixtureWorld(); let reloads = 0;
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Returns byte-equivalent structural authority for one poll. */
    reloadWorld: async () => { reloads += 1; return structuredClone(world); },
  });
  const before = controller.snapshot();
  const appliedFingerprint = core.authoredFingerprint(before.scene.elements);
  assert.equal(await controller.refreshFacts(before.focus), false);
  const after = controller.snapshot();
  assert.equal(reloads, 1);
  assert.equal(after.composition, before.composition, "unchanged structure does not recompose or parse a scene");
  assert.equal(areaMapProjectionUpdate({
    appliedFingerprint,
    currentSelection: before.selection,
    scene: after.scene,
    selection: after.selection,
  }), null, "the browser projection performs zero Excalidraw updates");
  controller.destroy();
});

test("the current 41-Area structure and planned loads stay within product budgets", async () => {
  const world = fortyOneAreaWorld();
  const events = [];
  const calls = [];
  const interactiveStart = performance.now();
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Captures the controller's coordinate-free load timing. */
    onEvent: (event) => events.push(event),
    /** Resolves one deterministic in-memory planned shard. */
    loadShard: async (area, context) => {
      calls.push(area);
      return { owner: area, hash: `loaded-${area}`, state: "ready", worldRevision: context.worldRevision, scene: core.createEmptyScene() };
    },
  });
  const interactiveDuration = performance.now() - interactiveStart;
  const worldEvent = events.find((event) => event.name === "area_map_world_loaded");
  assert.equal(controller.snapshot().world.areas.length, 41);
  assert.ok(interactiveDuration < 1_000, `41-Area controller became interactive in ${interactiveDuration.toFixed(1)} ms`);
  assert.ok(worldEvent.usableTime < 1_000, `reported usable time was ${worldEvent.usableTime.toFixed(1)} ms`);

  const plannedStart = performance.now();
  await controller.prioritizeLoads("atlas/focus", { includeDescendants: true, nearbyCount: 3 });
  const plannedDuration = performance.now() - plannedStart;
  assert.equal(calls[0], "atlas/focus", "the selected deferred shard starts first");
  assert.deepEqual(calls.slice(1, 36), world.areas.filter((node) => node.key.startsWith("atlas/focus/")).map((node) => node.key));
  assert.ok(plannedDuration < 3_000, `planned subtree loading finished in ${plannedDuration.toFixed(1)} ms`);
  controller.destroy();
});
