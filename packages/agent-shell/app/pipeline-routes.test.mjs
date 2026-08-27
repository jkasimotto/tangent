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

test("pipeline routes reject a report value that is not an object", async () => {
  let called = false;
  const routes = createPipelineRoutes({
    normalizeMessage: String,
    /** Must stay unreachable for every rejected report value. */
    async handoverStep() { called = true; return { status: 200, state: "reported", pipeline: {} }; },
  });
  for (const report of ['{"type":"implementation-result"}', [], true, null]) {
    const output = response();
    await routes.handle(request("POST", { session: "worker", text: "facts", report }), output, new URL("http://shell/api/goals/handover"));
    assert.equal(output.status, 400);
    assert.match(output.body.error, /Correct --report.*Nothing was submitted/);
  }
  assert.equal(called, false, "a malformed report never reaches the queue controller");
});

test("pipeline routes dispatch fenced Goal attempt replacement", async () => {
  const calls = [];
  const routes = createPipelineRoutes({
    /** Records one fenced replacement request. */
    async replaceAttempt(goal, options) {
      calls.push({ goal, options });
      return { status: 200, state: "replaced", session: "goal-r2", operation: { id: "replacement-1" }, pipeline: { revision: 8 } };
    },
  });
  const output = response();
  await routes.handle(request("POST", {
    goal: "goal.md",
    assignmentId: "assignment-1",
    expectedAttemptId: "attempt-1",
    expectedRevision: 7,
    launch: { harness: "claude", model: "fable-5", effort: "max" },
    operationId: "replacement-1",
    caller: "brain-1",
    confirmed: true,
  }), output, new URL("http://shell/api/goals/attempts/replace"));

  assert.equal(calls[0].goal, "goal.md");
  assert.equal(calls[0].options.assignmentId, "assignment-1");
  assert.equal(calls[0].options.confirmed, true);
  assert.deepEqual(calls[0].options.launch, { harness: "claude", model: "fable-5", effort: "max" });
  assert.equal(output.body.session, "goal-r2");
  assert.equal(output.body.operation.id, "replacement-1");
});
