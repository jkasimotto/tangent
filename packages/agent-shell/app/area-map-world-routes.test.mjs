import test from "node:test";
import assert from "node:assert/strict";
import { createAreaMapWorldRoutes } from "./area-map-world-routes.mjs";

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

test("loads a deferred shard only against the matching world revision", async () => {
  /** Returns one revision-checked shard. */
  async function shard(_area, revision) { return revision === "current" ? { status: 200, scene: { elements: [] } } : { status: 409, error: "map world changed" }; }
  const routes = createAreaMapWorldRoutes({ index: { shard } });
  const stale = response();
  await routes.handle({ method: "GET" }, stale, new URL("http://local/api/areas/map-shard?area=otto&located=neara&worldRevision=stale"));
  assert.equal(stale.status, 409);
});
