import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createBrainRoutes } from "./brain-routes.mjs";

/** Creates one JSON request double. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a response double that records its JSON result. */
function response() {
  return {
    /** Records the response status. */
    writeHead(status) { this.status = status; },
    /** Records and parses the response body. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("brain routes dispatch by method and path", async () => {
  const routes = createBrainRoutes({
    /** Starts the requested Area. */
    async start(area) { return { status: 200, session: `${area}-brain`, generation: 1, reattached: false, brain: { area } }; },
  });
  const output = response();
  const handled = await routes.handle(request("POST", { area: "otto/tangent" }), output, new URL("http://shell/api/brains/start"));
  assert.equal(handled, true);
  assert.equal(output.status, 200);
  assert.equal(output.body.session, "otto/tangent-brain");
  assert.equal(await routes.handle(request("GET"), response(), new URL("http://shell/api/unknown")), false);
});
