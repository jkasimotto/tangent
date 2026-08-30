import test from "node:test";
import assert from "node:assert/strict";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createEmptyScene } from "./public/area-board-core.js";

test("includes full structure while eagerly loading the path and two descendant levels", async () => {
  const keys = ["neara", "neara/delivery", "neara/delivery/standards", "neara/delivery/standards/deep", "neara/hackathon", "otto"];
  /** Reads one fixture shard. */
  async function read(area) { return { area, file: `${area}.excalidraw`, exists: true, ok: area !== "neara/hackathon", hash: area, scene: createEmptyScene(), ...(area === "neara/hackathon" ? { errors: ["bad map"] } : {}) }; }
  /** Lists fixture Areas. */
  async function listAreas() { return keys; }
  const index = createAreaMapWorldIndex({ root: "/vault", repository: { read }, listAreas });
  const world = await index.snapshot("neara/delivery");
  assert.deepEqual(world.areas.map((area) => area.key), keys.slice().sort());
  assert.equal(world.areas.find((area) => area.key === "neara").shard.state, "ready");
  assert.equal(world.areas.find((area) => area.key === "neara/delivery/standards/deep").shard.state, "ready");
  assert.equal(world.areas.find((area) => area.key === "otto").shard.state, "deferred");
  assert.equal(world.areas.find((area) => area.key === "neara/hackathon").shard.state, "unreadable");
  assert.ok(world.areas.every((area) => area.region));
});
