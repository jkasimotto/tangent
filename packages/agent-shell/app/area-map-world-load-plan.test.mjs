import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { parseAreaCanvas } from "./area-canvas.mjs";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createBlockElements, createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";

test("includes full structure while eagerly loading the path and two descendant levels", async () => {
  const keys = ["neara", "neara/delivery", "neara/delivery/standards", "neara/delivery/standards/deep", "neara/hackathon", "otto"];
  const rootScene = createEmptyScene();
  rootScene.elements.push(...createRegionElements({ id: "root-neara", ref: "neara/neara.md", title: "Neara", x: 80, y: 90, width: 1100, height: 800 }));
  const ottoScene = createEmptyScene();
  ottoScene.elements.push(...createBlockElements({ id: "goal", kind: "goal", ref: "otto/goal-map.md", title: "Map", x: 500, y: 300 }));
  ottoScene.elements.push(createTextElement({ id: "ink", text: "remember", x: -100, y: -80, width: 90, height: 30 }));
  /** Reads one fixture shard. */
  async function read(area) { return { area, file: `${area}.excalidraw`, exists: true, ok: area !== "neara/hackathon", hash: area, scene: area === "@root" ? rootScene : area === "otto" ? ottoScene : createEmptyScene(), ...(area === "neara/hackathon" ? { errors: ["bad map"] } : {}) }; }
  /** Lists fixture Areas. */
  async function listAreas() { return ["@root", ...keys]; }
  const index = createAreaMapWorldIndex({ root: "/vault", repository: { read }, listAreas });
  const world = await index.snapshot("neara/delivery");
  assert.deepEqual(world.areas.map((area) => area.key), keys.slice().sort());
  assert.equal(world.areas.find((area) => area.key === "neara").shard.state, "ready");
  assert.equal(world.areas.find((area) => area.key === "neara/delivery/standards/deep").shard.state, "ready");
  assert.equal(world.areas.find((area) => area.key === "otto").shard.state, "deferred");
  assert.equal(world.areas.find((area) => area.key === "otto").shard.blockCount, 1);
  assert.deepEqual(world.areas.find((area) => area.key === "otto").shard.ownBlockHull, { x: 500, y: 300, width: 280, height: 132 });
  assert.deepEqual(world.areas.find((area) => area.key === "otto").shard.ownInkHull, { x: -100, y: -80, width: 90, height: 30 });
  assert.equal(world.areas.find((area) => area.key === "neara/hackathon").shard.state, "unreadable");
  assert.equal(world.areas.find((area) => area.key === "neara").region.sourceId, "root-neara");
  assert.deepEqual(world.areas.find((area) => area.key === "neara").region.storedRect, { x: 80, y: 90, width: 1100, height: 800 });
  assert.equal(world.rootShard.owner, "@root");
  assert.ok(world.areas.every((area) => area.region));
});

test("loads a matching deferred shard after an unrelated shard changes", async () => {
  const scenes = new Map(["@root", "root", "root/a", "root/b"].map((area) => [area, createEmptyScene()]));
  const hashes = new Map(["@root", "root", "root/a", "root/b"].map((area) => [area, `hash-${area}`]));
  /** Lists the fixture Area hierarchy. */
  async function listAreas() { return ["root", "root/a", "root/b"]; }
  const index = createAreaMapWorldIndex({ root: "/vault", listAreas, repository: {
    /** Reads the current fixture revision. */
    async read(area) { return { area, file: `${area}.excalidraw`, exists: true, ok: true, hash: hashes.get(area), scene: scenes.get(area) }; },
  } });
  const world = await index.snapshot("root/a");
  hashes.set("root/b", "changed-elsewhere");
  const loaded = await index.shard("root/b", world.worldRevision, "root/a");
  assert.equal(loaded.status, 409, "the requested shard itself changed");
  hashes.set("root/b", "hash-root/b"); hashes.set("root", "changed-unrelated");
  const stillLoaded = await index.shard("root/b", world.worldRevision, "root/a");
  assert.equal(stillLoaded.status, 200, "an unrelated shard does not invalidate matching deferred content");
});

test("an unchanged structural poll performs zero additional scene parses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-map-poll-cache-"));
  const scene = createEmptyScene();
  await mkdir(path.join(root, "@root"), { recursive: true });
  await mkdir(path.join(root, "neara"), { recursive: true });
  await writeFile(path.join(root, "@root", "@root.excalidraw"), JSON.stringify(scene));
  await writeFile(path.join(root, "neara", "neara.excalidraw"), JSON.stringify(scene));
  let parses = 0;
  const repository = createAreaCanvasRepository({
    root,
    /** Keeps the real parser while counting cache misses. */
    parseCanvas(text) { parses += 1; return parseAreaCanvas(text); },
  });
  const index = createAreaMapWorldIndex({
    root,
    repository,
    /** Supplies one unchanged structural hierarchy. */
    async listAreas() { return ["neara"]; },
  });

  const first = await index.snapshot("neara");
  const parsesAfterFirstRead = parses;
  const second = await index.snapshot("neara");

  assert.equal(parsesAfterFirstRead, 1, "one shared content hash is parsed once across root and Area scenes");
  assert.equal(parses, parsesAfterFirstRead, "the unchanged poll parses no scene again");
  assert.equal(second.worldRevision, first.worldRevision);
});
