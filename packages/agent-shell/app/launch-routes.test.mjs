import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createLaunchRoutes } from "./launch-routes.mjs";

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

test("launch routes dispatch work definition and Goal starts", async () => {
  const routes = createLaunchRoutes({
    /** Opens work definition. */
    async describe(body) { return { status: 200, value: { session: body.area } }; },
    /** Starts a Goal. */
    async start(body) { return { status: 200, value: { session: body.file } }; },
  });
  const described = response();
  await routes.handle(request("POST", { area: "otto" }), described, new URL("http://shell/api/work/describe"));
  assert.equal(described.body.session, "otto");
  const started = response();
  await routes.handle(request("POST", { file: "otto/goal-one.md" }), started, new URL("http://shell/api/goals/start"));
  assert.equal(started.body.session, "otto/goal-one.md");
});
