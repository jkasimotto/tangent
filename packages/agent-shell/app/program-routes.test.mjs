import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createProgramRoutes } from "./program-routes.mjs";

/** Creates a request double. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a response recorder. */
function response() {
  return {
    /** Records status. */
    writeHead(status) { this.status = status; },
    /** Records JSON. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("program routes dispatch lists and mutations", async () => {
  const routes = createProgramRoutes({
    /** Returns a snapshot. */
    async list() { return { programs: [] }; },
    /** Creates one program. */
    async create(body) { return { id: body.name }; },
  });
  const listed = response();
  await routes.handle(request("GET"), listed, new URL("http://shell/api/operations"));
  assert.deepEqual(listed.body, { programs: [] });
  const created = response();
  await routes.handle(request("POST", { name: "watch" }), created, new URL("http://shell/api/operations/new"));
  assert.equal(created.body.id, "watch");
});
