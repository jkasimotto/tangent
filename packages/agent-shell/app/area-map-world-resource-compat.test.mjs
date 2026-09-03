import test from "node:test";
import assert from "node:assert/strict";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createBlockElements, createEmptyScene } from "./public/area-board-core.js";

const resourceId = "0198e8c5-2be6-7d6a-a142-f0903a13a23b";

/** Creates one source-backed index without any catalog/provider integration. */
function fixture() {
  const scenes = new Map([["@root", createEmptyScene()], ["root", createEmptyScene()]]);
  const index = createAreaMapWorldIndex({
    root: "/ephemeral/vault",
    /** Lists the one physical Area in the fixture. */
    async listAreas() { return ["root"]; },
    repository: {
      /** Reads one immutable source-scene fixture. */
      async read(area) { return { area, exists: true, ok: true, hash: `hash:${area}`, scene: structuredClone(scenes.get(area)) }; },
    },
  });
  return { index, scenes };
}

/** Builds the exact source mutation envelope used by the index boundary. */
function request(world, owner, put, operationId) {
  return {
    schema: "area-map-gesture.v1", operationId, gestureId: operationId,
    worldId: world.worldId, treeRevision: world.treeRevision, worldRevision: world.worldRevision,
    reason: "resource compatibility", mutations: [{ owner, baseHash: `hash:${owner}`, put, remove: [] }],
  };
}

test("the source authority accepts a safe inert resource ID without resolving it as a vault path", async () => {
  const { index } = fixture();
  const world = await index.snapshot("root");
  const elements = createBlockElements({ id: "resource", kind: "resource", ref: resourceId, title: "Compatibility", x: 20, y: 30 });
  let saved = null;
  const result = await index.applyGesture(request(world, "root", elements, "resource-safe"), async (writes) => {
    saved = writes;
    return { committed: true, hashes: { root: "saved:root" } };
  });
  assert.equal(result.status, 200);
  assert.equal(saved[0].canvas.elements.find((element) => element.id === "resource").customData.tangent.ref, resourceId);
});

test("the source authority rejects path-like IDs and root-owned resource associations", async () => {
  const { index } = fixture();
  const world = await index.snapshot("root");
  const unsafe = createBlockElements({ id: "unsafe-resource", kind: "resource", ref: "../mistaken-vault-file.md", title: "Unsafe", x: 20, y: 30 });
  let calls = 0;
  /** Counts any transaction that escapes compatibility validation. */
  async function save() { calls += 1; return { committed: true }; }
  const unsafeResult = await index.applyGesture(request(world, "root", unsafe, "resource-unsafe"), save);
  assert.equal(unsafeResult.status, 422);
  assert.match(unsafeResult.error, /unsafe Tangent resource reference/);

  const valid = createBlockElements({ id: "root-resource", kind: "resource", ref: resourceId, title: "Root", x: 20, y: 30 });
  const rootResult = await index.applyGesture(request(world, "@root", valid, "resource-root"), save);
  assert.equal(rootResult.status, 422);
  assert.match(rootResult.error, /cannot be owned by @root/);
  assert.equal(calls, 0);
});
