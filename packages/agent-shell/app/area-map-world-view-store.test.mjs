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

test("concurrent world view writes finish with the newest invocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-world-view-"));
  let releaseFirst;
  const firstPaused = new Promise((resolve) => { releaseFirst = resolve; });
  let enterFirst;
  const firstEntered = new Promise((resolve) => { enterFirst = resolve; });
  const entered = [];
  const store = createAreaMapWorldViewStore({
    root,
    /** Holds the first replacement open so a concurrent newer write can queue. */
    async beforeWrite(_worldId, view) {
      entered.push(view.pan.x);
      if (view.pan.x === 1) { enterFirst(); await firstPaused; }
    },
  });
  const older = { schema: "area-map-view.v2", worldId: "world_ordered", pan: { x: 1, y: 0 }, zoom: 1, foldedAreas: [], detailAreas: [] };
  const newest = { ...older, pan: { x: 2, y: 0 } };

  const first = store.write(older.worldId, older);
  await firstEntered;
  const second = store.write(newest.worldId, newest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, [1], "the newer replacement waits for the active write");
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(entered, [1, 2]);
  assert.deepEqual(await store.read(newest.worldId), newest, "the newest invocation owns the durable view");
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
