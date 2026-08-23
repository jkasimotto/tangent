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

test("pipeline routes keep continuation and step handover on one contract", async () => {
  const calls = [];
  const routes = createPipelineRoutes({
    /** Normalizes handover facts. */
    normalizeMessage: String,
    /** Records a continuation. */
    async continueWorker(session, text) { calls.push(["continue", session, text]); return { status: 200, session: "fresh" }; },
    /** Records a step advance. */
    async handoverStep(session, text) { calls.push(["advance", session, text]); return { status: 200, state: "advanced", next: 2, pipeline: {} }; },
  });

  const continued = response();
  await routes.handle(request("POST", { session: "old", text: "facts", continue: true }), continued, new URL("http://shell/api/goals/handover"));
  const advanced = response();
  await routes.handle(request("POST", { session: "step-1", text: "more" }), advanced, new URL("http://shell/api/goals/handover"));

  assert.deepEqual(calls, [["continue", "old", "facts"], ["advance", "step-1", "more"]]);
  assert.deepEqual(continued.body, { status: "continued", session: "fresh" });
  assert.equal(advanced.body.status, "advanced");
});
