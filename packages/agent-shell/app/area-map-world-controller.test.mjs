import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import core from "./public/area-board-core.js";
import worldCore from "./public/area-map-world-core.js";
import { areaMapPointerCommand, areaMapProjectionUpdate, areaMapStructuralHullChanged, createAreaMapWorldController, ownerForNewAreaMapElement, selectedAreaMapRegionChanges } from "./public/area-map-world-controller.js";

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

test("Excalidraw pointer state creates one exact structural command", () => {
  for (const handle of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    assert.deepEqual(areaMapPointerCommand({ resize: { isResizing: true, handleType: handle } }), { kind: "resize", handle });
  }
  assert.deepEqual(areaMapPointerCommand({ resize: { isResizing: true, handleType: "rotation" } }), { kind: "ignore", handle: "rotation" });
  assert.deepEqual(areaMapPointerCommand({ resize: { isResizing: false, handleType: false } }), { kind: "move", handle: null });
  assert.deepEqual(areaMapPointerCommand({}), { kind: "move", handle: null });
});

test("only a structural block-hull change can reprioritize an Area branch", () => {
  const hull = { x: 80, y: 90, width: 280, height: 132 };
  assert.equal(areaMapStructuralHullChanged(null, null), false);
  assert.equal(areaMapStructuralHullChanged(hull, { ...hull }), false, "style, text, and free ink can change without changing the block hull");
  assert.equal(areaMapStructuralHullChanged(hull, { ...hull, x: 81 }), true, "moving a structural block changes the branch extent");
  assert.equal(areaMapStructuralHullChanged(hull, null), true, "removing the final structural block changes the branch extent");
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

test("resource fact projection updates shared Block words and treatment without Map authority", () => {
  const world = fixtureWorld();
  const owner = "neara/delivery";
  const id = "11111111-1111-4111-8111-111111111111";
  world.areas.find((node) => node.key === owner).shard.scene.elements.push(
    ...core.createBlockElements({ id: "review-block", kind: "resource", ref: id, title: "Cached", x: 210, y: 190 }),
  );
  const controller = createAreaMapWorldController({ world, storage: memoryStorage() });
  const authoritative = controller.world();
  const before = controller.snapshot().scene.elements.find((element) => core.tangentOf(element)?.kind === "resource");
  const beforeGeometry = { x: before.x, y: before.y, width: before.width, height: before.height };
  const resolution = {
    state: "current",
    value: {
      locator: { owner, id },
      label: "Map entities review",
      target: { kind: "link", url: "https://github.com/otto/tangent/pull/42" },
      local: null,
      link: {
        kind: "github-pr", owner: "otto", repository: "tangent", number: 42,
        lifecycle: { state: "current", value: { stateLabel: "Merged", treatment: "success", providerUpdatedAt: "2026-09-02T00:00:00.000Z" } },
      },
      representation: { state: "current", value: "on-map" },
      origin: null,
      warnings: [],
    },
  };
  assert.equal(controller.setResourceResolutions([resolution]), true);
  const snapshot = controller.snapshot();
  const block = snapshot.scene.elements.find((element) => core.tangentOf(element)?.kind === "resource");
  const labelId = block.boundElements.find((entry) => entry.type === "text").id;
  const label = snapshot.scene.elements.find((element) => element.id === labelId);
  const rail = snapshot.scene.elements.find((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-success-rail");
  assert.match(label.text, /^GITHUB PR  ✓\nMap entities review\notto\/tangent#42 · Merged$/);
  assert.equal(rail.customData.tangentWorldEphemeral.sourceId, block.id);
  assert.deepEqual({ x: block.x, y: block.y, width: block.width, height: block.height }, beforeGeometry);
  assert.deepEqual(controller.world(), authoritative, "fact projection leaves every source shard exact");
  assert.equal(snapshot.save.state, "saved");
  assert.equal(controller.undo(), false, "fact projection creates no Map history entry");
  assert.equal(controller.snapshot().composition.scene.elements.some((element) => element.customData?.tangentWorldEphemeral), false, "the composed world never owns the rail");
  assert.equal(controller.setResourceResolutions([resolution]), false, "an identical fact response is a no-op");
  controller.destroy();
});

test("resource source updates preserve authored geometry and rebase retained semantic Undo", async () => {
  const owner = "neara/delivery";
  const previousId = "11111111-1111-4111-8111-111111111111";
  const currentId = "22222222-2222-4222-8222-222222222222";
  const world = fixtureWorld();
  world.areas.find((node) => node.key === owner).shard.scene.elements.push(
    ...core.createBlockElements({ id: "resource-block", kind: "resource", ref: previousId, title: "Worktree", x: 210, y: 190 }),
  );
  const saves = [];
  const controller = createAreaMapWorldController({
    world,
    storage: memoryStorage(),
    /** Captures the exact source authority written by Undo. */
    persistWorld: async (next, _areas, _owners, _command, direction) => {
      saves.push({ next: structuredClone(next), direction });
      return {
        status: 200,
        hashes: { [owner]: `saved-${saves.length}` },
        treeRevision: "tree-saved",
        worldRevision: `world-saved-${saves.length}`,
      };
    },
  });

  const styled = controller.world();
  const styledBlock = styled.areas.find((node) => node.key === owner).shard.scene.elements.find((element) => element.id === "resource-block");
  styledBlock.x += 35;
  styledBlock.strokeColor = "#7048e8";
  styledBlock.customData.note = "kept";
  controller.commitWorld(styled, { changedOwners: [owner] }, "style");
  await controller.flush();

  const source = controller.world().areas.find((node) => node.key === owner).shard.scene;
  source.elements.find((element) => element.id === "resource-block").customData.tangent.ref = currentId;
  const revisionBefore = controller.snapshot().revision;
  assert.equal(controller.installResourceSourceUpdates([{
    owner,
    hash: "resource-source-hash",
    serializedSource: JSON.stringify(source),
    treeRevision: "tree-resource",
    worldRevision: "world-resource",
  }]), true);

  const installed = controller.world();
  const installedBlock = installed.areas.find((node) => node.key === owner).shard.scene.elements.find((element) => element.id === "resource-block");
  assert.equal(installedBlock.customData.tangent.ref, currentId);
  assert.equal(installedBlock.x, 245);
  assert.equal(installedBlock.strokeColor, "#7048e8");
  assert.equal(installedBlock.customData.note, "kept");
  assert.equal(installed.areas.find((node) => node.key === owner).shard.hash, "resource-source-hash");
  assert.equal(installed.treeRevision, "tree-resource");
  assert.equal(installed.worldRevision, "world-resource");
  assert.ok(controller.snapshot().revision > revisionBefore);

  assert.equal(controller.undo(), true, "the earlier style command remains the next Map history word");
  const undoneBlock = controller.world().areas.find((node) => node.key === owner).shard.scene.elements.find((element) => element.id === "resource-block");
  assert.equal(undoneBlock.customData.tangent.ref, currentId, "Undo preserves the newer resource association");
  assert.equal(undoneBlock.x, 210);
  assert.notEqual(undoneBlock.strokeColor, "#7048e8");
  assert.equal(undoneBlock.customData.note, undefined);
  await controller.flush();
  assert.equal(saves.at(-1).direction, "before");
  const persistedUndo = saves.at(-1).next.areas.find((node) => node.key === owner).shard.scene.elements.find((element) => element.id === "resource-block");
  assert.equal(persistedUndo.customData.tangent.ref, currentId, "a later Map save cannot restore the stale resource ID");
  assert.equal(controller.undo(), false, "the source update did not add a Map history entry");
  controller.destroy();
});

test("resource source updates reject invalid authority and pending Map work", () => {
  const owner = "neara/delivery";
  const world = fixtureWorld();
  world.areas.find((node) => node.key === owner).shard.scene.elements.push(
    ...core.createBlockElements({ id: "resource-block", kind: "resource", ref: "11111111-1111-4111-8111-111111111111", title: "Worktree", x: 210, y: 190 }),
  );
  const controller = createAreaMapWorldController({ world, storage: memoryStorage() });
  assert.throws(() => controller.installResourceSourceUpdates([{ owner, hash: "next", serializedSource: "{}" }]), { code: "resource-source-invalid" });

  const dirty = controller.world();
  dirty.areas.find((node) => node.key === owner).region.storedRect.x += 10;
  controller.beginGesture("pointer");
  controller.preview(dirty, { changedAreas: [owner] });
  assert.throws(() => controller.installResourceSourceUpdates([{
    owner,
    hash: "next",
    serializedSource: JSON.stringify(dirty.areas.find((node) => node.key === owner).shard.scene),
  }]), { code: "resource-representation-conflict" });
  controller.endGesture();
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

test("Only contains the target lineage and complete subtree until its explicit control clears it", () => {
  const controller = createAreaMapWorldController({ world: fortyOneAreaWorld(), storage: memoryStorage() });
  const authority = controller.world();
  assert.equal(controller.snapshot().restrictionArea, "atlas/focus", "a new visit starts restricted to its located Area");
  controller.toggleFold("atlas/near-a");
  const restricted = controller.setRestriction("atlas/focus");
  assert.deepEqual({ active: restricted.active, area: restricted.area, excludedCount: restricted.excludedCount }, { active: true, area: "atlas/focus", excludedCount: 4 });
  assert.ok(restricted.element);
  assert.deepEqual([...controller.snapshot().scopedAreas], fortyOneAreaWorld().areas.map((node) => node.key).filter((area) => area === "atlas" || area === "atlas/focus" || area.startsWith("atlas/focus/")));
  assert.equal(controller.snapshot().nextEscape, "Esc → Work", "Only is not an Escape stage");
  controller.selectArea("atlas/focus/item-00");
  assert.equal(controller.escape().kind, "selection", "controller selection can unwind without changing Only");
  controller.navigateArea("atlas", { select: false });
  assert.equal(controller.snapshot().restrictionArea, "atlas/focus", "navigation inside the projection does not retarget Only");
  controller.escape();
  assert.equal(controller.snapshot().restrictionArea, "atlas/focus", "Escape cannot clear Only");
  controller.setRestriction(null);
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

test("server world view restores the durable Map camera, location, folds, and selection", async () => {
  const world = fixtureWorld();
  const regionId = worldCore.composeAreaMapWorld(world).scene.elements.find((element) => element.customData?.tangent?.area === "neara")?.id;
  world.view = {
    schema: "area-map-view.v2", worldId: "world", locatedArea: "neara", cameraTarget: "neara", cameraTrail: ["neara/delivery"],
    pan: { x: 12, y: -9 }, zoom: 0.75, foldedAreas: ["neara/delivery"], detailAreas: ["neara"], restrictionArea: null, selection: [regionId],
  };
  const views = [];
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Captures the persisted world view. */
    persistView: async (value) => views.push(value),
  });
  assert.equal(controller.snapshot().viewRestored, true);
  assert.deepEqual({
    camera: controller.snapshot().camera,
    locatedArea: controller.snapshot().locatedArea,
    cameraTarget: controller.snapshot().cameraTarget,
    cameraTrail: controller.snapshot().cameraTrail,
    folded: [...controller.snapshot().folded],
    restrictionArea: controller.snapshot().restrictionArea,
    selection: [...controller.snapshot().selection],
  }, {
    camera: { scrollX: 12, scrollY: -9, zoom: 0.75 },
    locatedArea: "neara",
    cameraTarget: "neara",
    cameraTrail: ["neara/delivery"],
    folded: ["neara/delivery"],
    restrictionArea: null,
    selection: [regionId],
  });
  assert.equal(controller.snapshot().detailAreas.has("neara"), true);
  const authority = controller.world();
  controller.setCamera({ scrollX: 19, scrollY: -14, zoom: 0.85 });
  assert.deepEqual(controller.world(), authority);
  controller.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(views.at(-1).worldId, "world");
  assert.equal(views.at(-1).locatedArea, "neara");
  assert.deepEqual(views.at(-1).selection, [regionId]);
});

test("private Map view survives controller teardown and exact stable-ID restoration", () => {
  const storage = memoryStorage();
  const first = createAreaMapWorldController({ world: fixtureWorld(), storage });
  first.setRestriction(null);
  first.toggleFold("neara/delivery");
  first.setCamera({ scrollX: 73, scrollY: -28, zoom: 0.625 });
  first.fitArea("neara");
  const durable = first.captureView();
  const selected = [...first.snapshot().selection];
  first.destroy();

  const restored = createAreaMapWorldController({ world: fixtureWorld(), storage });
  assert.equal(restored.snapshot().viewRestored, true);
  assert.deepEqual(restored.captureView(), durable);
  assert.deepEqual(restored.snapshot().camera, { scrollX: 73, scrollY: -28, zoom: 0.625 });
  assert.equal(restored.snapshot().folded.has("neara/delivery"), true);
  assert.equal(restored.snapshot().locatedArea, "neara");
  assert.deepEqual([...restored.snapshot().selection], selected);
  restored.destroy();
});

test("captureView and restoreView round-trip the exact temporary Map return point", () => {
  const controller = createAreaMapWorldController({ world: fixtureWorld(), storage: memoryStorage() });
  const authority = controller.world();
  controller.setRestriction(null);
  controller.setCamera({ scrollX: 31, scrollY: -22, zoom: 0.7 });
  controller.fitArea("neara");
  const proof = controller.snapshot().scene.elements.find((element) => element.customData?.tangentWorld?.sourceId === "proof");
  controller.setFindReveal(proof.id);
  const returnPoint = controller.captureView();

  controller.setFindReveal(null);
  controller.setCamera({ scrollX: -400, scrollY: 250, zoom: 1.5 });
  controller.navigateArea("neara/delivery");
  controller.setRestriction("neara/delivery");
  controller.setSelection([]);
  const restored = controller.restoreView(returnPoint);

  assert.deepEqual(controller.captureView(), returnPoint);
  assert.deepEqual({
    camera: restored.camera,
    locatedArea: restored.locatedArea,
    cameraTarget: restored.cameraTarget,
    cameraTrail: restored.cameraTrail,
    restrictionArea: restored.restrictionArea,
    selection: [...restored.selection],
    findRevealId: restored.findRevealId,
  }, {
    ...returnPoint,
    selection: returnPoint.selection,
  });
  assert.deepEqual(controller.world(), authority, "temporary return state cannot change authored Map authority");
  assert.equal(controller.undo(), false, "temporary return state cannot enter authored history");
  controller.destroy();
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

test("an exhausted retryable head race keeps its draft until Retry succeeds", async () => {
  const events = [];
  let attempts = 0;
  let reloads = 0;
  let stored = null;
  const draftStore = {
    /** Starts without an earlier recovery draft. */
    async load() { return null; },
    /** Captures the draft that Keep mine must retain. */
    async save(record) { stored = structuredClone(record); },
    /** Clears recovery only after Retry saves the command. */
    async remove() { stored = null; },
    /** Releases the in-memory store. */
    close() {},
  };
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Captures the classified save and retry lifecycle. */
    onEvent: (event) => events.push(event),
    /** A retryable race has already exhausted the request-layer retries, then succeeds on the user's Retry. */
    persistWorld: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("branch advanced"), {
        status: 409,
        payload: { code: "head-race", retryable: true, operationId: "operation-head-race" },
      });
      return { status: 200, hashes: { neara: "retry-saved" }, worldRevision: "world-retried", operationId: "operation-head-race" };
    },
    /** Must not be used for a safe head race. */
    reloadWorld: async () => { reloads += 1; return fixtureWorld(); },
  });
  const changed = controller.world(); changed.areas[1].region.storedRect.x += 17;
  controller.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await controller.flush();

  assert.equal(controller.snapshot().save.state, "blocked");
  const kept = await controller.keepMine();
  assert.equal(kept.retained, true);
  assert.equal(controller.snapshot().save.state, "blocked");
  assert.equal(controller.snapshot().draft?.pending.length, 1);
  assert.equal(stored?.pending.length, 1);
  assert.equal(attempts, 1, "Keep mine retains the local recovery draft without issuing a blind save");
  assert.equal(reloads, 0);
  assert.ok(events.some((event) => event.name === "area_map_save" && event.phase === "failed" && event.failureKind === "head-race" && event.saveState === "blocked"));
  assert.ok(events.some((event) => event.name === "area_map_draft" && event.phase === "kept"));

  await controller.retry();
  await controller.flush();
  assert.equal(controller.snapshot().save.state, "saved");
  assert.equal(attempts, 2);
  assert.equal(stored, null);
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

test("draft stored, found, restored, and cleared events retain safe save correlation", async () => {
  let stored = null;
  const draftStore = {
    /** Returns the last private recovery record. */
    async load(worldId) { return stored?.worldId === worldId ? structuredClone(stored) : null; },
    /** Stores recovery without exposing its authored body to telemetry. */
    async save(record) { stored = structuredClone(record); },
    /** Clears recovery after an explicit discard. */
    async remove() { stored = null; },
    /** Closes the in-memory recovery store. */
    close() {},
  };
  const firstEvents = [];
  const first = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Captures draft lifecycle telemetry from the first controller. */
    onEvent: (event) => firstEvents.push(event),
    /** Returns one correlated unavailable result. */
    persistWorld: async () => ({ status: 503, error: "offline", operationId: "operation-draft-1" }),
  });
  const changed = first.world(); changed.areas[1].region.storedRect.y += 19;
  first.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await first.flush();
  const gestureId = stored.pending[0].command.id;
  const storedEvent = firstEvents.find((event) => event.name === "area_map_draft" && event.phase === "stored");
  assert.deepEqual({ operationId: storedEvent.operationId, gestureId: storedEvent.gestureId }, { operationId: "operation-draft-1", gestureId });
  assert.equal(firstEvents.filter((event) => event.name === "area_map_draft" && event.phase === "stored").length, 1, "one failed save writes one draft");
  first.destroy();

  const recoveredEvents = [];
  const recovered = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Captures draft lifecycle telemetry from the recovered controller. */
    onEvent: (event) => recoveredEvents.push(event),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const found = recoveredEvents.find((event) => event.name === "area_map_draft" && event.phase === "found");
  assert.deepEqual({ operationId: found.operationId, gestureId: found.gestureId }, { operationId: "operation-draft-1", gestureId });
  assert.equal(recovered.restoreDraft(), true);
  const restored = recoveredEvents.find((event) => event.name === "area_map_draft" && event.phase === "restored");
  assert.deepEqual({ operationId: restored.operationId, gestureId: restored.gestureId }, { operationId: "operation-draft-1", gestureId });
  recovered.discardDraft();
  await recovered.flush();
  const cleared = recoveredEvents.find((event) => event.name === "area_map_draft" && event.phase === "cleared");
  assert.deepEqual({ operationId: cleared.operationId, gestureId: cleared.gestureId }, { operationId: "operation-draft-1", gestureId });
  recovered.destroy();
});

test("a stale startup draft cannot reappear after newer work saves", async () => {
  let finishLoad;
  const calls = [];
  const stale = {
    schema: "area-map-draft.v1", worldId: "world", savedAt: "2026-08-01T00:00:00.000Z",
    locatedArea: "neara/delivery", world: fixtureWorld(), pending: [], history: { undo: [], redo: [] },
  };
  const draftStore = {
    /** Holds the startup read until a newer save has cleared recovery. */
    load: () => new Promise((resolve) => { finishLoad = resolve; }),
    /** Records any unexpected new recovery write. */
    async save() { calls.push("save"); },
    /** Records the durable clear after the authored command saves. */
    async remove() { calls.push("remove"); },
    /** Closes the in-memory recovery store. */
    close() {},
  };
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Acknowledges the newer authored command. */
    persistWorld: async () => ({ status: 200, hashes: { neara: "newer" }, worldRevision: "world-newer" }),
  });
  const changed = controller.world(); changed.areas[1].region.storedRect.x += 20;
  controller.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  await controller.flush();
  finishLoad(stale);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["remove"]);
  assert.equal(controller.snapshot().save.state, "saved");
  assert.equal(controller.snapshot().draft, null, "the older startup read cannot resurrect cleared recovery");
  controller.destroy();
});

test("draft save and clear stay ordered through immediate map teardown", async () => {
  let finishDraftWrite;
  const events = [];
  const draftStore = {
    /** Starts with no prior recovery. */
    async load() { return null; },
    /** Holds the failed-command draft write across retry and teardown. */
    async save() {
      events.push("save:start");
      await new Promise((resolve) => { finishDraftWrite = resolve; });
      events.push("save:end");
    },
    /** Records the later successful clear. */
    async remove() { events.push("remove"); },
    /** Records recovery-store teardown. */
    close() { events.push("close"); },
  };
  let attempt = 0;
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Fails the original request and accepts its explicit retry. */
    persistWorld: async () => ++attempt === 1
      ? { status: 503, error: "temporarily unavailable" }
      : { status: 200, hashes: { neara: "recovered" }, worldRevision: "world-recovered" },
  });
  const changed = controller.world(); changed.areas[1].region.storedRect.y += 20;
  controller.commitWorld(changed, { changedAreas: ["neara/delivery"] }, "pointer");
  for (let attempt = 0; attempt < 20 && controller.snapshot().save.state !== "blocked"; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(controller.snapshot().save.state, "blocked");
  assert.deepEqual(events, ["save:start"]);

  await controller.retry();
  controller.destroy();
  finishDraftWrite();
  await controller.flush();
  assert.deepEqual(events, ["save:start", "save:end", "remove", "close"], "a late failed-save write cannot outlive its clear or database close");
});

test("flush stops at a failed save with a later command and preserves complete recovery", async () => {
  let stored = null;
  let removes = 0;
  let writes = 0;
  let attempts = 0;
  const draftStore = {
    /** Starts without recovery. */
    async load() { return null; },
    /** Captures every ordered recovery update. */
    async save(record) { writes += 1; stored = structuredClone(record); },
    /** Must not clear a failed save. */
    async remove() { removes += 1; stored = null; },
    /** Closes the in-memory recovery store. */
    close() {},
  };
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(), draftStore,
    /** Leaves the first command blocked so the later command must remain recovery-only. */
    persistWorld: async () => { attempts += 1; return { status: 503, error: "offline", operationId: "operation-failed" }; },
  });
  const first = controller.world(); first.areas[1].region.storedRect.x += 11;
  controller.commitWorld(first, { changedAreas: ["neara/delivery"] }, "pointer");
  for (let index = 0; index < 20 && controller.snapshot().save.state !== "blocked"; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const later = controller.world(); later.areas[1].region.storedRect.y += 13;
  controller.commitWorld(later, { changedAreas: ["neara/delivery"] }, "nudge");
  await new Promise((resolve) => setImmediate(resolve));

  const settled = await Promise.race([
    controller.flush().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  try {
    assert.equal(settled, true, "teardown flush cannot wait for a Retry decision");
    assert.equal(controller.snapshot().save.state, "blocked");
    assert.equal(attempts, 1, "the later command is not persisted ahead of the failed command");
    assert.equal(removes, 0);
    assert.equal(writes, 2, "the failure and later command each update recovery once; flush does not rewrite it");
    assert.equal(stored.pending.length, 2, "the recovery draft contains the failed and later command");
  } finally {
    controller.destroy();
  }
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
  const selectedBefore = [...controller.snapshot().selection];
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
  assert.deepEqual([...snapshot.selection], selectedBefore);
  assert.equal(controller.undo(), false);
  controller.destroy();
});

test("a live preview is dirty and a changed legacy revision cannot retain a stale loaded scene", async () => {
  const initial = fixtureWorld();
  const loaded = initial.areas.find((node) => node.key === "neara/delivery");
  loaded.shard.hash = null;
  loaded.shard.revision = "legacy:old";
  const controller = createAreaMapWorldController({ world: initial, storage: memoryStorage() });
  const baseline = controller.world();
  controller.beginGesture("pointer");
  controller.preview(structuredClone(baseline), { changedOwners: ["neara/delivery"] });
  assert.equal(controller.snapshot().save.state, "dirty", "the UI cannot claim Saved while a gesture preview is open");
  controller.endGesture("pointer");
  assert.equal(controller.snapshot().save.state, "saved", "a no-op release restores truthful saved status");

  const fresh = structuredClone(baseline);
  fresh.worldRevision = "world-legacy-new";
  const deferred = fresh.areas.find((node) => node.key === "neara/delivery");
  deferred.shard = { ...deferred.shard, hash: null, revision: "legacy:new", state: "deferred" };
  delete deferred.shard.scene;
  await controller.reload(fresh);
  assert.equal(controller.world().areas.find((node) => node.key === "neara/delivery").shard.state, "deferred");
  assert.equal(controller.world().areas.find((node) => node.key === "neara/delivery").shard.scene, undefined, "null hashes do not preserve stale legacy bytes across revisions");
  controller.destroy();
});

test("an earlier acknowledgement cannot claim Saved over a newer open gesture", async () => {
  let releaseFirst;
  const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let saves = 0;
  const controller = createAreaMapWorldController({
    world: fixtureWorld(), storage: memoryStorage(),
    /** Holds only the first command while a second pointer preview opens. */
    persistWorld: async () => {
      saves += 1;
      if (saves === 1) { firstStarted(); await firstHeld; }
      return { status: 200, hashes: {}, worldRevision: `world-save-${saves}` };
    },
  });
  const first = controller.world(); first.areas[1].region.storedRect.x += 10;
  controller.commitWorld(first, { changedAreas: ["neara/delivery"] }, "pointer");
  await started;
  const second = controller.world(); second.areas[1].region.storedRect.y += 12;
  controller.beginGesture("pointer"); controller.preview(second, { changedAreas: ["neara/delivery"] });
  releaseFirst();
  await controller.flush();
  assert.equal(controller.snapshot().save.state, "dirty", "the first acknowledgement leaves the live second gesture pending");
  controller.endGesture("pointer");
  await controller.flush();
  assert.equal(controller.snapshot().save.state, "saved");
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
  assert.deepEqual(events.map(({ name, shardState }) => [name, shardState]), [
    ["area_map_world_loaded", undefined],
    ["area_map_shard_loaded", "load-error"],
    ["area_map_shard_loaded", "ready"],
  ]);
  assert.ok(events.filter((event) => event.name === "area_map_shard_loaded").every((event) => event.worldRevision === "world-1"));
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

test("a missing nested shard outside the eager set materializes its projected empty scene", async () => {
  const world = fixtureWorld();
  const missing = world.areas.find((node) => node.key === "neara/delivery");
  missing.shard = { owner: missing.key, hash: null, state: "missing", elementCount: 0, blockCount: 0 };
  const calls = [];
  const controller = createAreaMapWorldController({
    world, storage: memoryStorage(),
    /** Returns the projected empty scene the shard route supplies for a file that does not exist yet. */
    loadShard: async (area, context) => {
      calls.push(area);
      return { owner: area, state: "missing", hash: null, worldRevision: context.worldRevision, scene: core.createEmptyScene() };
    },
  });
  assert.equal(controller.world().areas.find((node) => node.key === missing.key).shard.scene, undefined, "a missing shard starts without a scene");
  const loaded = await controller.materialize(missing.key);
  assert.equal(loaded.state, "missing");
  assert.ok(Array.isArray(loaded.scene?.elements), "the missing shard now carries a scene that placement can extend");
  assert.deepEqual(calls, [missing.key]);
  assert.equal((await controller.materialize(missing.key)).state, "missing", "a loaded missing shard is not fetched again");
  assert.deepEqual(calls, [missing.key]);
  controller.destroy();
});
