import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { createAreaMapRoutes } from "./area-map-routes.mjs";

/** Creates a response recorder. */
function response() { const value = new EventEmitter(); value.writeHead = (status) => { value.status = status; }; value.end = (body) => { value.body = JSON.parse(body); }; return value; }
/** Creates a JSON request. */
function request(body) { const value = Readable.from([JSON.stringify(body)]); value.method = "POST"; value.headers = {}; return value; }

test("accepts the exact Area brain and rejects another caller", async () => {
  const calls = [];
  const routes = createAreaMapRoutes({ pictures: { async present(...args) { calls.push(args); return { status: 200 }; } }, proposals: {}, promotions: {}, areaExists: async () => true, authorizeBrain: async (_area, session) => session === "exact" ? { session, generation: 2 } : null });
  const accepted = response(); await routes.handle(request({ area: "otto", session: "exact", picture: { area: "otto" } }), accepted, new URL("http://x/api/areas/picture")); assert.equal(accepted.status, 200); assert.equal(calls[0][2].generation, 2);
  const rejected = response(); await routes.handle(request({ area: "otto", session: "parent" }), rejected, new URL("http://x/api/areas/picture")); assert.equal(rejected.status, 403);
});
