import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { createAreaMapWorldRoutes } from "./area-map-world-routes.mjs";
import { saveAreaMapGestureRequest, symmetricOverlapClosure } from "./public/area-board.js";
import { createEmptyScene, createRegionElements, createShapeElement, createTextElement } from "./public/area-board-core.js";
import { composeAreaMapWorld } from "./public/area-map-world-core.js";

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
function jsonRequest(value, method = "POST") {
  const request = Readable.from([JSON.stringify(value)]);
  request.method = method;
  return request;
}

/** Creates a source-backed map index for mutation-route tests. */
function mutationFixture({ legacyOverlap = false, recordEvent = null } = {}) {
  const root = createEmptyScene();
  root.elements.push(...createRegionElements({ id: "child-region", ref: "root/child/child.md", title: "Child", x: 80, y: 90 }));
  root.elements.push(...createRegionElements({ id: "peer-region", ref: "root/peer/peer.md", title: "Peer", x: legacyOverlap ? 180 : 680, y: 90 }));
  const child = createEmptyScene();
  child.elements.push(createTextElement({ id: "before", text: "Before", x: 10, y: 20, width: 90, height: 40 }));
  const scenes = new Map([["@root", createEmptyScene()], ["root", root], ["root/child", child], ["root/peer", createEmptyScene()]]);
  const hashes = new Map([["@root", "root-map-hash"], ["root", "parent-hash"], ["root/child", "child-hash"], ["root/peer", "peer-hash"]]);
  /** Lists the source fixture's Areas. */
  async function listAreas() { return ["root", "root/child", "root/peer"]; }
  const index = createAreaMapWorldIndex({ root: "/vault", listAreas, recordEvent, repository: {
    /** Reads one canonical source fixture. */
    async read(area) { return { area, file: `${area}/${area.split("/").at(-1)}.excalidraw`, exists: true, ok: true, hash: hashes.get(area), scene: scenes.get(area) }; },
  } });
  return { hashes, index, scenes };
}

/** Builds one valid source gesture. */
function gesture(world, mutations) {
  return { schema: "area-map-gesture.v1", operationId: "gesture-1", worldId: world.worldId, treeRevision: world.treeRevision, worldRevision: world.worldRevision, reason: "test map gesture", mutations };
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
  const putResult = response();
  await routes.handle(jsonRequest({ worldId: "world_123", view }, "PUT"), putResult, new URL("http://local/api/areas/map-view"));
  assert.equal(putResult.status, 200);
  const postResult = response();
  await routes.handle(jsonRequest({ worldId: "world_123", view }), postResult, new URL("http://local/api/areas/map-view"));
  assert.equal(postResult.status, 200, "POST remains compatible with an older browser");
  assert.deepEqual(writes, [{ worldId: "world_123", value: view }, { worldId: "world_123", value: view }]);
});

test("loads a deferred shard only against the matching world revision", async () => {
  /** Returns one revision-checked shard. */
  async function shard(_area, revision) { return revision === "current" ? { status: 200, scene: { elements: [] } } : { status: 409, error: "map world changed" }; }
  const routes = createAreaMapWorldRoutes({ index: { shard } });
  const stale = response();
  await routes.handle({ method: "GET" }, stale, new URL("http://local/api/areas/map-shard?area=otto&located=neara&worldRevision=stale"));
  assert.equal(stale.status, 409);
});

test("retries a classified head race with one correlated operation envelope", async () => {
  const calls = [];
  const events = [];
  let attempt = 0;
  /** Fails one safe pre-ref race, then acknowledges the same idempotent request. */
  async function api(path, options) {
    calls.push({ path, options });
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error("branch advanced"), { status: 409, payload: { code: "head-race", retryable: true } });
    return { status: 200, operationId: "operation-retry", worldRevision: "revision-retry" };
  }
  const request = {
    schema: "area-map-gesture.v1", operationId: "operation-retry", gestureId: "gesture-retry",
    worldId: "world-retry", treeRevision: "tree-retry", worldRevision: "revision-before-retry", mutations: [{ owner: "root", put: [], remove: [] }],
  };
  const result = await saveAreaMapGestureRequest(api, request, {
    /** Captures correlated retry and save phases. */
    onEvent: (name, fields) => events.push({ name, ...fields }),
    now: (() => { let value = 10; return () => value += 5; })(),
  });

  assert.equal(result.worldRevision, "revision-retry");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].options.body).worldRevision, "revision-before-retry");
  assert.deepEqual(calls.map((call) => call.options.headers["x-tangent-operation-id"]), ["operation-retry", "operation-retry"]);
  assert.equal(calls[0].options.body, calls[1].options.body, "a safe retry reuses exact content and idempotency identity");
  assert.deepEqual(events.map(({ name, phase, retryAttempt, failureKind }) => ({ name, phase, retryAttempt, failureKind })), [
    { name: "area_map_save_phase", phase: "request", retryAttempt: 0, failureKind: undefined },
    { name: "area_map_retry", phase: "scheduled", retryAttempt: 1, failureKind: "head-race" },
    { name: "area_map_save_phase", phase: "retry", retryAttempt: 1, failureKind: undefined },
    { name: "area_map_save_phase", phase: "acknowledged", retryAttempt: 1, failureKind: undefined },
  ]);
});

test("retries ambiguous acknowledgement loss with the exact idempotent request", async () => {
  const calls = [];
  const events = [];
  /** Simulates a committed request whose first response was lost in transport. */
  async function api(path, options) {
    calls.push({ path, options });
    if (calls.length === 1) throw Object.assign(new Error("response connection closed"), { kind: "transport", status: 0 });
    return { status: 200, operationId: "operation-ack-loss", worldRevision: "revision-after", idempotent: true };
  }
  const request = {
    schema: "area-map-gesture.v1", operationId: "operation-ack-loss", gestureId: "gesture-ack-loss",
    worldId: "world-ack-loss", treeRevision: "tree-before", worldRevision: "revision-before",
    mutations: [{ owner: "root", put: [], remove: [] }],
  };

  const result = await saveAreaMapGestureRequest(api, request, {
    /** Captures correlated retry and save phases. */
    onEvent: (name, fields) => events.push({ name, ...fields }),
  });

  assert.equal(result.idempotent, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.deepEqual(calls.map((call) => call.options.headers["x-tangent-operation-id"]), ["operation-ack-loss", "operation-ack-loss"]);
  assert.ok(events.some((event) => event.name === "area_map_retry" && event.failureKind === "transport" && event.retryable === true));
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
  assert.equal(JSON.parse(result.body).worldRevision, saved[0].options.acknowledgement.worldRevision, "the response acknowledges the projected revision for later deferred loads");
  assert.notEqual(saved[0].options.acknowledgement.worldRevision, world.worldRevision);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].writes[0].canvas.elements.map((element) => element.id), ["before", "added"]);
  assert.equal(saved[0].writes[0].area, "root/child");
  assert.equal(saved[0].writes[0].baseHash, "child-hash");
  assert.equal(saved[0].options.operationId, "gesture-1");
  assert.equal(saved[0].options.worldId, world.worldId);
  assert.equal(world.areas.find((node) => node.key === "root/child").shard.revision, "child-hash", "every shard descriptor exposes its opaque retention revision");
});

test("uses the revision captured inside the save transaction instead of a later mixed world", async () => {
  const events = [];
  const { hashes, index, scenes } = mutationFixture({
    /** Captures privacy-safe server gesture telemetry. */
    recordEvent: (event) => events.push(event),
  });
  const world = await index.snapshot("root/child");
  let transactionAcknowledgement = null;
  /** Captures the durable descriptor, then simulates a later non-overlapping shard change. */
  async function saveGesture(writes, options) {
    scenes.set(writes[0].area, structuredClone(writes[0].canvas));
    hashes.set(writes[0].area, "saved-child");
    transactionAcknowledgement = options.acknowledgement;
    hashes.set("root/peer", "later-peer");
    return { committed: true, operationId: options.operationId, hashes: { "root/child": "saved-child" }, acknowledgement: transactionAcknowledgement };
  }
  const added = createTextElement({ id: "atomic-ack", text: "Atomic", x: 160, y: 190, width: 100, height: 40 });
  const result = response();
  await createAreaMapWorldRoutes({ index, saveGesture }).handle(
    jsonRequest({ ...gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [added], remove: [] }]), gestureId: "gesture-atomic" }),
    result,
    new URL("http://local/api/areas/map-gestures"),
  );

  const body = JSON.parse(result.body);
  assert.equal(body.worldRevision, transactionAcknowledgement.worldRevision);
  assert.notEqual(body.worldRevision, (await index.snapshot("root/child")).worldRevision, "a later shard change has a distinct world revision");
  assert.ok(events.some((event) => event.name === "area_map_gesture" && event.phase === "acknowledged" && event.gestureId === "gesture-atomic" && event.status === 200));
});

test("rejects a non-mutated shard interleaving before the save transaction commits", async () => {
  const { hashes, index } = mutationFixture();
  const world = await index.snapshot("root/child");
  let committed = false;
  /** Advances a different shard after gesture validation, then enters the transaction preflight. */
  async function saveGesture(_writes, options) {
    hashes.set("root/peer", "intervening-peer");
    const conflict = await options.preflight();
    if (conflict) return conflict;
    committed = true;
    return { committed: true, operationId: options.operationId, hashes: { "root/child": "saved-child" } };
  }
  const added = createTextElement({ id: "interleaved", text: "Interleaved", x: 170, y: 210, width: 100, height: 40 });
  const result = response();
  await createAreaMapWorldRoutes({ index, saveGesture }).handle(
    jsonRequest({ ...gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [added], remove: [] }]), gestureId: "gesture-interleaved" }),
    result,
    new URL("http://local/api/areas/map-gestures"),
  );

  const body = JSON.parse(result.body);
  assert.equal(result.status, 409);
  assert.deepEqual({ code: body.code, retryable: body.retryable, conflict: body.conflict }, { code: "world-race", retryable: false, conflict: true });
  assert.notEqual(body.worldRevision, world.worldRevision, "the conflict identifies the current world instead of acknowledging a mixed client state");
  assert.equal(committed, false, "the stale gesture does not commit after the different shard interleaves");
});

test("rejects a client world revision that was stale before request validation", async () => {
  const { hashes, index } = mutationFixture();
  const clientWorld = await index.snapshot("root/child");
  hashes.set("root/peer", "already-newer-peer");
  let committed = false;
  /** Runs the same transaction preflight used by the production repository. */
  async function saveGesture(_writes, options) {
    const conflict = await options.preflight();
    if (conflict) return conflict;
    committed = true;
    return { committed: true, operationId: options.operationId, hashes: { "root/child": "saved-child" } };
  }
  const added = createTextElement({ id: "stale-client", text: "Stale client", x: 180, y: 220, width: 100, height: 40 });
  const result = response();
  await createAreaMapWorldRoutes({ index, saveGesture }).handle(
    jsonRequest({ ...gesture(clientWorld, [{ owner: "root/child", baseHash: "child-hash", put: [added], remove: [] }]), gestureId: "gesture-stale-client" }),
    result,
    new URL("http://local/api/areas/map-gestures"),
  );

  const body = JSON.parse(result.body);
  assert.equal(result.status, 409);
  assert.deepEqual({ code: body.code, retryable: body.retryable, conflict: body.conflict }, { code: "world-race", retryable: false, conflict: true });
  assert.notEqual(body.worldRevision, clientWorld.worldRevision);
  assert.equal(committed, false, "a stale client cannot receive a combined acknowledgement for its different-shard world");
});

test("rejects a gesture from a stale Area tree revision", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  let calls = 0;
  /** Counts any transaction that escaped revision validation. */
  async function saveGesture() { calls += 1; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const moved = createTextElement({ id: "before", text: "Before", x: 40, y: 50, width: 90, height: 40 });
  const result = response();
  const request = { ...gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [moved], remove: [] }]), treeRevision: "stale-tree" };
  await routes.handle(jsonRequest(request), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 409);
  assert.equal(JSON.parse(result.body).code, "tree-conflict");
  assert.equal(JSON.parse(result.body).treeRevision, world.treeRevision);
  assert.equal(calls, 0);
});

test("rejects undersized regions and accepts an exact authored sibling overlap", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  const child = world.areas.find((node) => node.key === "root/child");
  const peer = world.areas.find((node) => node.key === "root/peer");
  let calls = 0;
  let saved = null;
  /** Counts any transaction that escaped structural geometry validation. */
  async function saveGesture(writes) { calls += 1; saved = writes; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });

  const [small] = createRegionElements({ id: child.region.sourceId, ref: "root/child/child.md", title: "Child", x: 80, y: 90, width: 299, height: 220 });
  const smallResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [small], remove: [] }])), smallResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(smallResult.status, 422);
  assert.match(JSON.parse(smallResult.body).error, /at least 300 by 220/);

  const layout = { schema: "area-placement.v1", priority: 12, overlapWith: ["root/peer"] };
  const [crossing] = createRegionElements({ id: child.region.sourceId, ref: "root/child/child.md", title: "Child", ...peer.region.storedRect, layout });
  const oneSidedResult = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [crossing], remove: [] }]), operationId: "gesture-one-sided" }), oneSidedResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(oneSidedResult.status, 422);
  assert.match(JSON.parse(oneSidedResult.body).error, /must be reciprocal in the final source scene/);

  const peerLayout = { schema: "area-placement.v1", priority: 11, overlapWith: ["root/child"] };
  const [crossingPeer] = createRegionElements({ id: peer.region.sourceId, ref: "root/peer/peer.md", title: "Peer", ...peer.region.storedRect, layout: peerLayout });
  const crossingResult = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [crossing, crossingPeer], remove: [] }]), operationId: "gesture-2" }), crossingResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(crossingResult.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(saved[0].canvas.elements.find((element) => element.id === child.region.sourceId).customData.tangent.layout, layout, "the compatible source region keeps placement intent");
  assert.deepEqual(saved[0].canvas.elements.find((element) => element.id === peer.region.sourceId).customData.tangent.layout, peerLayout, "the final source scene keeps the reciprocal peer intent");
});

test("a first edit to one legacy overlap writes the symmetric source closure and reloads exactly", async () => {
  const { hashes, index, scenes } = mutationFixture({ legacyOverlap: true });
  const world = await index.snapshot("root/child");
  const next = structuredClone(world);
  const child = next.areas.find((node) => node.key === "root/child");
  const peer = next.areas.find((node) => node.key === "root/peer");
  assert.deepEqual(child.region.layout.overlapWith, ["root/peer"], "read migration infers the legacy overlap");
  assert.deepEqual(peer.region.layout.overlapWith, ["root/child"]);
  child.region.storedRect.width += 120;
  child.region.layout.priority += 1;
  const expected = composeAreaMapWorld(next);
  const changed = symmetricOverlapClosure(next, new Set([child.key]));
  assert.deepEqual([...changed].sort(), ["root/child", "root/peer"], "the production persistence adapter closes the reciprocal pair");
  const put = [...changed].flatMap((area) => {
    const node = next.areas.find((candidate) => candidate.key === area);
    return createRegionElements({
      id: node.region.sourceId,
      ref: `${area}/${area.split("/").at(-1)}.md`,
      title: area.split("/").at(-1),
      layout: node.region.layout,
      ...node.region.storedRect,
    });
  });
  /** Installs the accepted source transaction so the index acknowledgement and reload read real source bytes. */
  async function saveGesture(writes, options) {
    for (const write of writes) {
      scenes.set(write.area, structuredClone(write.canvas));
      hashes.set(write.area, `saved:${options.operationId}:${write.area}`);
    }
    return { committed: true, operationId: options.operationId, hashes: Object.fromEntries(writes.map((write) => [write.area, hashes.get(write.area)])) };
  }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const result = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put, remove: [] }]), operationId: "legacy-overlap-closure" }), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 200);
  const sourceRegions = new Map(scenes.get("root").elements.filter((element) => element.customData?.tangent?.role === "region").map((element) => [element.customData.tangent.ref, element]));
  assert.deepEqual(sourceRegions.get("root/child/child.md").customData.tangent.layout, child.region.layout);
  assert.deepEqual(sourceRegions.get("root/peer/peer.md").customData.tangent.layout, peer.region.layout, "the unchanged peer receives the reciprocal metadata half");

  const reloaded = composeAreaMapWorld(await index.snapshot("root/child"));
  assert.deepEqual([...reloaded.regionRects], [...expected.regionRects], "reload derives the exact same solved regions from source");
  assert.deepEqual([...reloaded.storedRegionRects], [...expected.storedRegionRects], "reload preserves the exact authored rectangles");
});

test("the symmetric source closure follows a reciprocal overlap chain only", () => {
  /** Creates one minimal source-world node. */
  const node = (key, overlapWith, parent = "root") => ({ key, parent, region: { layout: { overlapWith } } });
  const world = { areas: [
    node("root/a", ["root/b"]),
    node("root/b", ["root/a", "root/c"]),
    node("root/c", ["root/b", "root/d"]),
    node("root/d", []),
    node("other/e", ["root/a"], "other"),
  ] };
  assert.deepEqual([...symmetricOverlapClosure(world, ["root/a"])].sort(), ["root/a", "root/b", "root/c"], "transitive reciprocal peers close, while one-sided and foreign-parent edges do not");
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

  const [invalidLayout] = createRegionElements({ id: "child-region", ref: "root/child/child.md", title: "Child", x: 80, y: 90, layout: { schema: "area-placement.v1", priority: -1, overlapWith: [] } });
  const layoutResult = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [invalidLayout], remove: [] }]), operationId: "gesture-layout" }), layoutResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(layoutResult.status, 422);
  assert.match(JSON.parse(layoutResult.body).error, /layout must use area-placement\.v1/);

  const [foreignOverlap] = createRegionElements({ id: "child-region", ref: "root/child/child.md", title: "Child", x: 80, y: 90, layout: { schema: "area-placement.v1", priority: 1, overlapWith: ["root/not-a-child"] } });
  const overlapResult = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [foreignOverlap], remove: [] }]), operationId: "gesture-overlap" }), overlapResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(overlapResult.status, 422);
  assert.match(JSON.parse(overlapResult.body).error, /only direct siblings/);
  assert.equal(calls, 0);
});

test("rejects traversal references and unsafe cross-Area endpoint identities", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  let calls = 0;
  /** Counts any unexpected transaction call. */
  async function saveGesture() { calls += 1; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const traversal = createTextElement({ id: "traversal", text: "Outside", x: 10, y: 20 });
  traversal.customData = { tangent: { kind: "document", ref: "root/child/../../outside.md" } };
  const traversalResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [traversal], remove: [] }])), traversalResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(traversalResult.status, 422);
  assert.match(JSON.parse(traversalResult.body).error, /unsafe Tangent reference/);

  const unsafeEndpoint = createShapeElement({ id: "unsafe-endpoint", type: "arrow", x: 20, y: 30, width: 80, height: 40 });
  unsafeEndpoint.customData = { tangentWorldEndpoints: { end: { owner: "root/../outside", sourceId: "before" } } };
  const endpointResult = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [unsafeEndpoint], remove: [] }])), endpointResult, new URL("http://local/api/areas/map-gestures"));
  assert.equal(endpointResult.status, 422);
  assert.match(JSON.parse(endpointResult.body).error, /endpoint owner/);
  assert.equal(calls, 0);
});

test("keeps cross-Area bindings in metadata while the start endpoint owns the arrow", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  const saved = [];
  /** Captures an accepted metadata-only endpoint. */
  async function saveGesture(writes) { saved.push(writes); return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const arrow = createShapeElement({ id: "cross-arrow", type: "arrow", x: 20, y: 30, width: 80, height: 40 });
  arrow.startBinding = { elementId: "before", focus: 0, gap: 1 };
  arrow.customData = { tangentWorldEndpoints: { start: { owner: "root/child", sourceId: "before" } } };
  const foreignBinding = response();
  await routes.handle(jsonRequest(gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [arrow], remove: [] }])), foreignBinding, new URL("http://local/api/areas/map-gestures"));
  assert.equal(foreignBinding.status, 422);
  assert.match(JSON.parse(foreignBinding.body).error, /binds across source owners/);

  arrow.startBinding = null;
  const wrongOwner = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root", baseHash: "parent-hash", put: [arrow], remove: [] }]), operationId: "gesture-2" }), wrongOwner, new URL("http://local/api/areas/map-gestures"));
  assert.equal(wrongOwner.status, 422);
  assert.match(JSON.parse(wrongOwner.body).error, /start endpoint owner/);

  const metadataOnly = response();
  await routes.handle(jsonRequest({ ...gesture(world, [{ owner: "root/child", baseHash: "child-hash", put: [arrow], remove: [] }]), operationId: "gesture-3" }), metadataOnly, new URL("http://local/api/areas/map-gestures"));
  assert.equal(metadataOnly.status, 200);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0][0].canvas.elements.find((element) => element.id === "cross-arrow").customData.tangentWorldEndpoints.start, { owner: "root/child", sourceId: "before" });
});

test("rejects a source element transfer between owners", async () => {
  const { index } = mutationFixture();
  const world = await index.snapshot("root/child");
  let calls = 0;
  /** Counts any transaction that escaped semantic ownership validation. */
  async function saveGesture() { calls += 1; return { committed: true }; }
  const routes = createAreaMapWorldRoutes({ index, saveGesture });
  const transferred = createTextElement({ id: "before", text: "Before", x: 40, y: 50, width: 90, height: 40 });
  const result = response();
  await routes.handle(jsonRequest(gesture(world, [
    { owner: "root/child", baseHash: "child-hash", put: [], remove: ["before"] },
    { owner: "root", baseHash: "parent-hash", put: [transferred], remove: [] },
  ])), result, new URL("http://local/api/areas/map-gestures"));
  assert.equal(result.status, 422);
  assert.match(JSON.parse(result.body).error, /cannot move between source owners/);
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
