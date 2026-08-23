import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createAreaRoutes } from "./area-routes.mjs";

/** Creates a request double with an optional JSON body. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a JSON response recorder. */
function response() {
  return {
    /** Records status. */
    writeHead(status) { this.status = status; },
    /** Records JSON. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("Area routes dispatch reads and report mutation conflicts", async () => {
  const routes = createAreaRoutes({
    /** Returns one tree. */
    async tree() { return { root: "/vault", areas: [] }; },
    /** Rejects a conflicting move. */
    async move() { throw new Error("pending edits"); },
  });
  const tree = response();
  assert.equal(await routes.handle(request("GET"), tree, new URL("http://shell/api/tree")), true);
  assert.equal(tree.body.root, "/vault");
  const moved = response();
  await routes.handle(request("POST", { area: "otto" }), moved, new URL("http://shell/api/areas/move"));
  assert.equal(moved.status, 409);
  assert.equal(moved.body.error, "pending edits");
});
