import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAreaMapWorldViewStore, validAreaMapWorldId } from "./area-map-world-view-store.mjs";

test("world view state uses one atomic world-v2 file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-world-view-"));
  const store = createAreaMapWorldViewStore({ root });
  const view = { schema: "area-map-view.v2", worldId: "world_123", pan: { x: 1, y: 2 }, zoom: 0.5, foldedAreas: ["otto/old"], detailAreas: [] };
  assert.equal(await store.read(view.worldId), null);
  assert.deepEqual(await store.write(view.worldId, view), view);
  assert.deepEqual(await store.read(view.worldId), view);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "world_123.world-v2.json"), "utf8")), view);
});

test("world view state rejects traversal and ignores corrupt private state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-world-view-"));
  const store = createAreaMapWorldViewStore({ root });
  assert.equal(validAreaMapWorldId("../../vault"), false);
  await assert.rejects(store.write("../../vault", { schema: "area-map-view.v2", worldId: "../../vault" }), /worldId is invalid/);
  await writeFile(path.join(root, "safe-world.world-v2.json"), "not json", "utf8");
  assert.equal(await store.read("safe-world"), null);
});

test("world view state requires its exact schema and world identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-world-view-"));
  const store = createAreaMapWorldViewStore({ root });
  await assert.rejects(store.write("world-a", { schema: "area-map-view.v1", worldId: "world-a" }), /area-map-view\.v2/);
  await assert.rejects(store.write("world-a", { schema: "area-map-view.v2", worldId: "world-b" }), /matching worldId/);
});
