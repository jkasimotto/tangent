import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createMapKindsRoutes } from "./map-kinds-routes.mjs";

/** Creates a response recorder. */
function response() {
  const value = new EventEmitter();
  value.writeHead = (status) => { value.status = status; };
  value.end = (body) => { value.body = JSON.parse(body); };
  return value;
}

/** Creates one GET request. */
function request(method = "GET") { return { method, headers: {} }; }

test("the catalog route serves the definition, the icons, and the problems", async () => {
  const catalog = { revision: "r1", source: "vault", kinds: [{ id: "worktree", problems: [] }], icons: { worktree: { name: "worktree" } }, problems: [] };
  const routes = createMapKindsRoutes({
    catalog: {
      /** Returns the fixture catalog. */
      read: async () => catalog,
    },
  });
  const answered = response();
  assert.equal(await routes.handle(request(), answered, new URL("http://x/api/areas/map-kinds")), true);
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.body, catalog);

  const other = response();
  assert.equal(await routes.handle(request(), other, new URL("http://x/api/areas/map-resources")), false);
  assert.equal(await routes.handle(request("POST"), other, new URL("http://x/api/areas/map-kinds")), false, "the catalog is read-only");
});

test("a filesystem failure is a 500 that names nothing private", async () => {
  const errors = [];
  const routes = createMapKindsRoutes({
    catalog: {
      /** Fails the way a filesystem error would. */
      read: async () => { throw Object.assign(new Error("EACCES /Users/private/trees"), { code: "EACCES" }); },
    },
    /** Records the server-side report. */
    reportError: (message) => errors.push(message),
  });
  const failed = response();
  assert.equal(await routes.handle(request(), failed, new URL("http://x/api/areas/map-kinds")), true);
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: "Map kinds could not be read." });
  assert.equal(errors.length, 1);
});
