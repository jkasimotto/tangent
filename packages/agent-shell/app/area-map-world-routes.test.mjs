import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createAreaMapWorldRoutes } from "./area-map-world-routes.mjs";
import { createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";

/** Creates a small Node response fixture. */
function response() {
  return {
    status: 0, headers: {}, body: "",
    /** Records status and headers. */
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    /** Records the response body. */
    end(body = "") { this.body = body; },
  };
}

/** Creates one JSON request stream. */
function jsonRequest(value) {
  const request = Readable.from([JSON.stringify(value)]);
  request.method = "POST";
  return request;
}

/** Creates a source-backed map index for mutation-route tests. */
function mutationFixture() {
  const root = createEmptyScene();
  root.elements.push(...createRegionElements({ id: "child-region", ref: "root/child/child.md", title: "Child", x: 80, y: 90 }));
  const child = createEmptyScene();
  child.elements.push(createTextElement({ id: "before", text: "Before", x: 10, y: 20, width: 90, height: 40 }));
  const scenes = new Map([["@root", createEmptyScene()], ["root", root], ["root/child", child]]);
  const hashes = new Map([["@root", "root-map-hash"], ["root", "parent-hash"], ["root/child", "child-hash"]]);
  /** Lists the source fixture's Areas. */
  async function listAreas() { return ["root", "root/child"]; }
  const index = createAreaMapWorldIndex({ root: "/vault", listAreas, repository: {
    /** Reads one canonical source fixture. */
    async read(area) { return { area, file: `${area}/${area.split("/").at(-1)}.excalidraw`, exists: true, ok: true, hash: hashes.get(area), scene: scenes.get(area) }; },
  } });
  return { index, scenes };
}

/** Builds one valid source gesture. */
function gesture(world, mutations) {
  return { schema: "area-map-gesture.v1", operationId: "gesture-1", worldId: world.worldId, treeRevision: world.treeRevision, reason: "test map gesture", mutations };
}

test("returns the complete hierarchy from one world request", async () => {
  const expected = { schema: "area-map-world.v1", areas: [{ key: "neara" }, { key: "neara/delivery" }, { key: "neara/delivery/standards" }] };
  /** Returns one fixture world. */
  async function snapshot(located) { return located === "neara/delivery/standards" ? expected : null; }
  const routes = createAreaMapWorldRoutes({ index: { snapshot } });
  const result = response();
  assert.equal(await routes.handle({ method: "GET" }, result, new URL("http://local/api/areas/map-world?located=neara%2Fdelivery%2Fstandards")), true);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), expected);
});

test("loads and saves private view state by world identity", async () => {
  const expected = { schema: "area-map-world.v1", worldId: "world_123", areas: [] };
  const view = { schema: "area-map-view.v2", worldId: "world_123", pan: { x: 4, y: 8 }, zoom: 0.75, foldedAreas: [], detailAreas: [] };
  const writes = [];
  const routes = createAreaMapWorldRoutes({
    index: {
      /** Returns one complete world fixture. */
      async snapshot() { return { ...expected }; },
    },
    viewStore: {
      /** Returns private state for the matching world. */
      async read(worldId) { return worldId === "world_123" ? view : null; },
      /** Records one private view write. */
      async write(worldId, value) { writes.push({ worldId, value }); },
    },
  });
  const worldResult = response();
  await routes.handle({ method: "GET" }, worldResult, new URL("http://local/api/areas/map-world?located=otto"));
  assert.deepEqual(JSON.parse(worldResult.body).view, view);
  const saveResult = response();
  await routes.handle(jsonRequest({ worldId: "world_123", view }), saveResult, new URL("http://local/api/areas/map-view"));
  assert.equal(saveResult.status, 200);
  assert.deepEqual(writes, [{ worldId: "world_123", value: view }]);
});

test("loads a deferred shard only against the matching world revision", async () => {
  /** Returns one revision-checked shard. */
  async function shard(_area, revision) { return revision === "current" ? { status: 200, scene: { elements: [] } } : { status: 409, error: "map world changed" }; }
  const routes = createAreaMapWorldRoutes({ index: { shard } });
  const stale = response();
  await routes.handle({ method: "GET" }, stale, new URL("http://local/api/areas/map-shard?area=otto&located=neara&worldRevision=stale"));
  assert.equal(stale.status, 409);
});

test("applies source mutations to complete canonical shards through the transaction adapter", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  const saved = [];
  /** Captures one validated source gesture. */
  async function saveGesture(writes, options) {
    saved.push({ writes, options });
    return { committed: true, operationId: options.operationId, hashes: { "root/child": "new-child-hash" } };
  }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const added = createTextElement({ id: "added", text: "Added", x: 140, y: 180, width: 110, height: 44 });
  const result = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [added], remove: [] }])), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).worldRevision, world.worldRevision, "the response acknowledges the revision for later deferred loads");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].writes[0].canvas.elements.map((element) => element.id), ["before", "added"]);
  assert.equal(saved[0].writes[0].area, "root/child");
  assert.equal(saved[0].writes[0].baseHash, "child-hash");
  assert.equal(saved[0].options.operationId, "gesture-1");
  assert.equal(saved[0].options.worldId, world.worldId);
});

test("writes a top-level region through the special root source shard", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  const top = world.areas.find((node) => node.key === "root");
  const [region] = createRegionElements({ id: top.region.sourceId, ref: "root/root.md", title: "Root", x: 120, y: 130, width: 740, height: 520 });
  let captured = null;
  /** Captures the root-source write. */
  async function saveGesture(writes) { captured = writes; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const result = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "@root", baseHash: "root-map-hash", put: [region], remove: [] }])), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 200);
  assert.equal(captured[0].area, "@root");
  assert.equal(captured[0].canvas.elements[0].id, top.region.sourceId);
});

test("rejects runtime IDs and invalid direct-child regions", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  let calls = 0;
  /** Counts any unexpected transaction call. */
  async function saveGesture() { calls += 1; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const runtime = createTextElement({ id: "tw-composed", text: "Runtime", x: 10, y: 20 });
  const runtimeResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [runtime], remove: [] }])), runtimeResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(runtimeResult.status, 422);
  assert.match(JSON.parse(runtimeResult.body).error, /runtime IDs/);

  const composed = createTextElement({ id: "source-looking", text: "Composed", x: 10, y: 20 });
  composed.customData = { tangentWorld: { owner: "root/child", sourceId: "source-looking" } };
  const composedResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [composed], remove: [] }])), composedResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(composedResult.status, 422);

  const [wrongRegion] = createRegionElements({ id: "wrong-region", ref: "root/child/child.md", title: "Child", x: 80, y: 90 });
  const relationResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [wrongRegion], remove: [] }])), relationResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(relationResult.status, 409);
  assert.equal(JSON.parse(relationResult.body).code, "tree-conflict");
  assert.equal(calls, 0);
});

test("rejects duplicate source owners and source IDs", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  const ink = createTextElement({ id: "ink", text: "Ink", x: 10, y: 20 });
  /** Returns an unused successful transaction result. */
  async function saveGesture() { return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const owners = response();
  await routes.handle(jsonRequest(gesture(world, [
    { owner: "root/child", baseHash: "child-hash", put: [ink], remove: [] },
    { owner: "root/child", baseHash: "child-hash", put: [], remove: [] },
  ])), owners, new URL("http://local/api/areas/map-gestures"));
  assert.equal(owners.status, 422);
  const ids = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [ink, ink], remove: [] }])), ids, new URL("http://local/api/areas/map-gestures"));
  assert.equal(ids.status, 422);
});

test("returns every transaction conflict in one 409", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  /** Returns all transaction conflicts together. */
  async function saveGesture() { return { status: 409, conflict: true, currentHashes: { root: "external-parent", "root/child": "external-child" } }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const parentInk = createTextElement({ id: "parent-ink", text: "Parent", x: 20, y: 30 });
  const childInk = createTextElement({ id: "child-ink", text: "Child", x: 40, y: 50 });
  const result = response();
  await routes.handle(jsonRequest(gesture(world, [
    { owner: "root", baseHash: "parent-hash", put: [parentInk], remove: [] },
    { owner: "root/child", baseHash: "child-hash", put: [childInk], remove: [] },
  ])), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 409);
  assert.deepEqual(JSON.parse(result.body).currentHashes, { root: "external-parent", "root/child": "external-child" });
});
