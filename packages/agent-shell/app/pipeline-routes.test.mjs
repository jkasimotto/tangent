import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createPipelineRoutes } from "./pipeline-routes.mjs";

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

test("pipeline routes reject worker replacement and accept typed queue reports", async () => {
  const calls = [];
  const routes = createPipelineRoutes({
    /** Normalizes handover facts. */
    normalizeMessage: String,
    /** Records a step advance. */
    async handoverStep(session, text) { calls.push(["advance", session, text]); return { status: 200, state: "advanced", next: 2, pipeline: {} }; },
  });

  const continued = response();
  await routes.handle(request("POST", { session: "old", text: "facts", continue: true }), continued, new URL("http://shell/api/goals/handover"));
  const advanced = response();
  await routes.handle(request("POST", { session: "step-1", text: "more" }), advanced, new URL("http://shell/api/goals/handover"));

  assert.deepEqual(calls, [["advance", "step-1", "more"]]);
  assert.equal(continued.status, 400);
  assert.match(continued.body.error, /typed context-risk/);
  assert.equal(advanced.body.status, "advanced");
});
