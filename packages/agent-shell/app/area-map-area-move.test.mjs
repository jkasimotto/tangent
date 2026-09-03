import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { moveArea } from "./area-operations.mjs";
import { parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { rewriteAreaMapSceneForMove } from "./area-map-area-move.mjs";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";
import { provisionalRegions } from "./public/area-map-world-core.js";

/** Writes one valid scene at its canonical Area path. */
async function writeScene(root, area, scene) {
  await mkdir(path.join(root, area), { recursive: true });
  await writeFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), serializeAreaCanvas(scene));
}

/** Reads one valid canonical Area scene. */
async function readScene(root, area) {
  const text = await readFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), "utf8");
  const parsed = parseAreaCanvas(text);
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

test("a cross-parent Area move clears persisted overlap intent", () => {
  const scene = createEmptyScene();
  scene.elements.push(...createRegionElements({
    id: "peer-region", ref: "neara/peer/peer.md", title: "Peer",
    layout: { schema: "area-placement.v1", priority: 4, overlapWith: ["neara/source"] },
  }));

  const moved = rewriteAreaMapSceneForMove(scene, [{ from: "neara/source", to: "otto/renamed" }]);

  assert.deepEqual(moved.elements[0].customData.tangent.layout, {
    schema: "area-placement.v1", priority: 4, overlapWith: [],
  });
});

test("a same-parent Area rename retains and remaps persisted overlap intent", () => {
  const scene = createEmptyScene();
  scene.elements.push(...createRegionElements({
    id: "peer-region", ref: "neara/peer/peer.md", title: "Peer",
    layout: { schema: "area-placement.v1", priority: 4, overlapWith: ["neara/source"] },
  }));

  const moved = rewriteAreaMapSceneForMove(scene, [{ from: "neara/source", to: "neara/renamed" }]);

  assert.deepEqual(moved.elements[0].customData.tangent.layout, {
    schema: "area-placement.v1", priority: 4, overlapWith: ["neara/renamed"],
  });
});

test("an Area move remaps a resource source owner without rewriting its opaque ID", () => {
  const scene = createEmptyScene();
  const resource = createTextElement({ id: "resource-block", text: "Worktree" });
  resource.customData = {
    tangent: { kind: "resource", ref: "neara/source-shaped-but-opaque" },
    tangentWorld: { owner: "neara/source", sourceId: "resource-block" },
  };
  scene.elements.push(resource);

  const moved = rewriteAreaMapSceneForMove(scene, [{ from: "neara/source", to: "otto/renamed" }]);

  assert.equal(moved.elements[0].customData.tangent.ref, "neara/source-shaped-but-opaque");
  assert.equal(moved.elements[0].customData.tangentWorld.owner, "otto/renamed");
});

test("an explicit Area move preserves source IDs and remaps every map owner and reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-map-move-"));
  for (const area of ["neara", "neara/source", "neara/source/child", "otto"]) {
    await mkdir(path.join(root, area), { recursive: true });
    await writeFile(path.join(root, area, `${path.posix.basename(area)}.md`), `# ${path.posix.basename(area)}\n`);
  }
  const source = createEmptyScene();
  const sourceBlock = createTextElement({ id: "source-id", text: "kept", x: 10, y: 20, width: 80, height: 30 });
  sourceBlock.customData = {
    tangent: { kind: "document", ref: "neara/source/child/note.md#part" },
    endpoint: { owner: "neara/source/child", sourceId: "child-id" },
  };
  source.elements.push(sourceBlock);
  await writeScene(root, "neara/source", source);
  const child = createEmptyScene(); child.elements.push(createTextElement({ id: "child-id", text: "child", x: 30, y: 40, width: 80, height: 30 }));
  await writeScene(root, "neara/source/child", child);
  const oldParent = createEmptyScene(); oldParent.elements.push(...createRegionElements({ id: "old-region", ref: "neara/source/source.md", title: "Source" }));
  await writeScene(root, "neara", oldParent);
  const outside = createEmptyScene();
  const endpoint = createTextElement({ id: "outside-id", text: "outside" });
  endpoint.customData = { endpoint: { owner: "neara/source", sourceId: "source-id" } };
  outside.elements.push(endpoint);
  await writeScene(root, "otto", outside);

  const moved = await moveArea({
    treesRoot: root, area: "neara/source", parent: "otto", name: "Renamed",
    /** Uses filesystem fallbacks in this isolated vault. */
    runGit: async (_args, fallback) => fallback(),
  });

  assert.equal(moved.destination, "otto/renamed");
  await assert.rejects(access(path.join(root, "otto/renamed/source.excalidraw")), { code: "ENOENT" });
  const movedSource = await readScene(root, "otto/renamed");
  assert.equal(movedSource.elements[0].id, "source-id");
  assert.deepEqual({ x: movedSource.elements[0].x, y: movedSource.elements[0].y }, { x: 10, y: 20 });
  assert.equal(movedSource.elements[0].customData.tangent.ref, "otto/renamed/child/note.md#part");
  assert.equal(movedSource.elements[0].customData.endpoint.owner, "otto/renamed/child");
  assert.equal((await readScene(root, "otto/renamed/child")).elements[0].id, "child-id");
  assert.equal((await readScene(root, "otto")).elements[0].customData.endpoint.owner, "otto/renamed");
  assert.equal((await readScene(root, "neara")).elements[0].customData.tangent.ref, "otto/renamed/renamed.md");
  assert.ok(moved.mapChangedPaths.includes("otto/renamed/renamed.excalidraw"));
  assert.ok(moved.mapChangedPaths.includes("otto/otto.excalidraw"));

  const regions = provisionalRegions(["neara", "otto", "otto/renamed", "otto/renamed/child"]);
  assert.equal(regions.has("neara/source"), false, "the old Area key has no structural authority");
  assert.equal(regions.get("otto/renamed").owner, "otto", "the new parent supplies the structural region");
  assert.equal(regions.get("otto/renamed").source, "provisional");
});

test("the old parent's next authored mutation removes its stale moved-Area region", async () => {
  const oldParent = createEmptyScene();
  oldParent.elements.push(
    ...createRegionElements({ id: "stale-region", ref: "root/new/moved/moved.md", title: "Moved" }),
    createTextElement({ id: "kept", text: "Keep", x: 20, y: 30 }),
  );
  const scenes = new Map([
    ["@root", createEmptyScene()],
    ["root", createEmptyScene()],
    ["root/old", oldParent],
    ["root/new", createEmptyScene()],
    ["root/new/moved", createEmptyScene()],
  ]);
  const index = createAreaMapWorldIndex({
    root: "/vault",
    /** Lists the tree after the Area move. */
    async listAreas() { return ["root", "root/old", "root/new", "root/new/moved"]; },
    repository: {
      /** Reads one canonical source fixture. */
      async read(area) { return { area, exists: true, ok: true, hash: `hash:${area}`, scene: scenes.get(area) }; },
    },
  });
  const world = await index.snapshot("root/new/moved");
  assert.equal(world.areas.find((entry) => entry.key === "root/new/moved").region.owner, "root/new");
  let saved = null;
  const authored = createTextElement({ id: "authored", text: "Authored", x: 80, y: 90 });
  const result = await index.applyGesture({
    schema: "area-map-gesture.v1", operationId: "clean-old-parent", worldId: world.worldId, treeRevision: world.treeRevision, reason: "edit old parent",
    mutations: [{ owner: "root/old", baseHash: "hash:root/old", put: [authored], remove: [] }],
  }, async (writes) => { saved = writes[0]; return { committed: true }; });
  assert.equal(result.status, 200);
  assert.deepEqual(saved.canvas.elements.map((element) => element.id), ["kept", "authored"]);
});
