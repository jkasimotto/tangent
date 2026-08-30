import assert from "node:assert/strict";
import test from "node:test";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createAreaBoundary, createBlockElements, createEmptyScene, createRegionElements } from "./public/area-board-core.js";

test("emits coordinate-free migration counts for legacy, recovered, and provisional reads", async () => {
  const rootScene = createEmptyScene();
  rootScene.elements.push(...createRegionElements({ id: "root-region", ref: "root/root.md", title: "Root", x: 60, y: 60, width: 1_400, height: 900 }));
  rootScene.elements.push(createAreaBoundary("@root", { x: 0, y: 0, width: 1_600, height: 1_100 }));
  const ownerScene = createEmptyScene();
  ownerScene.elements.push(...createBlockElements({ id: "legacy-child", kind: "area", ref: "root/child/child.md", title: "Child", x: 100, y: 120 }));
  const scenes = new Map([
    ["@root", rootScene],
    ["root", ownerScene],
    ["root/child", createEmptyScene()],
    ["root/provisional", createEmptyScene()],
  ]);
  const events = [];
  const index = createAreaMapWorldIndex({
    root: "/vault",
    /** Lists the complete observable fixture hierarchy. */
    listAreas: async () => ["root", "root/child", "root/provisional"],
    repository: {
      /** Reads one immutable migration fixture shard. */
      async read(area) { return { area, file: `${area}.excalidraw`, exists: true, ok: true, hash: `hash:${area}`, scene: scenes.get(area) }; },
    },
    /** Captures one coordinate-free migration event. */
    recordEvent: (event) => events.push(event),
  });

  await index.snapshot("root/child");
  await index.snapshot("root/child");

  assert.deepEqual(events.map(({ name, legacyCards, boundaries, provisionalRegions, recoveredPlacements }) => ({ name, legacyCards, boundaries, provisionalRegions, recoveredPlacements })), [{
    name: "area_map_migration_read",
    legacyCards: 1,
    boundaries: 1,
    provisionalRegions: 1,
    recoveredPlacements: 1,
  }], "an unchanged migration read emits no duplicate event");
});
