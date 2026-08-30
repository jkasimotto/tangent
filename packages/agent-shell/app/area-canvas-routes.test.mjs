import assert from "node:assert/strict"; import { EventEmitter } from "node:events"; import { Readable } from "node:stream"; import test from "node:test"; import { createAreaCanvasRoutes } from "./area-canvas-routes.mjs";
/** Creates a small response recorder for route tests. */
function response() { const result = new EventEmitter(); result.headers = {}; result.writeHead = (status, headers = {}) => { result.status = status; result.headers = headers; }; result.end = (body = "") => { result.body = body ? JSON.parse(body) : null; }; return result; }
test("derives the Area, returns ETags, and reports stale saves", async () => {
  const calls = []; const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: {}, files: {} }; const repository = {
    /** Returns a canonical saved scene. */
    async read(area) { calls.push(area); return { area, file: `${area}/tangent.excalidraw`, exists: true, hash: "abc", ok: true, canvas: scene, scene, warnings: [] }; },
    /** Returns the stale-save conflict used by this route proof. */
    async save(area, _canvas, options) { calls.push([area, options]); return { status: 409, currentHash: "new" }; },
  };
  const routes = createAreaCanvasRoutes({ repository }); const get = response(); await routes.handle({ method: "GET", headers: {} }, get, new URL("http://x/api/areas/canvas?area=otto/tangent")); assert.equal(get.status, 200); assert.equal(get.headers.ETag, '"abc"');
  const post = response(); const request = Readable.from([JSON.stringify({ area: "otto/tangent", baseHash: "old", canvas: scene })]); request.method = "POST"; request.headers = { "content-type": "application/json" }; await routes.handle(request, post, new URL("http://x/api/areas/canvas")); assert.equal(post.status, 409); assert.equal(post.body.currentHash, "new");
});

test("routes one multi-file gesture through the repository transaction", async () => {
  const calls = []; const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: {}, files: {} };
  const repository = {
    /** Records the atomic repository call. */
    async saveMany(writes, options) { calls.push({ writes, options }); return { committed: true, hashes: { neara: "n", "neara/delivery": "d" } }; },
  };
  const routes = createAreaCanvasRoutes({ repository });
  const request = Readable.from([JSON.stringify({ area: "neara/delivery", operationId: "gesture-1", writes: [{ area: "neara", baseHash: "old-n", canvas: scene }, { area: "neara/delivery", baseHash: "old-d", canvas: scene, reason: "standards extent" }] })]);
  request.method = "POST"; request.headers = { "content-type": "application/json" };
  const post = response(); await routes.handle(request, post, new URL("http://x/api/areas/canvas"));
  assert.equal(post.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].writes.length, 2); assert.equal(calls[0].options.operationId, "gesture-1");
});
