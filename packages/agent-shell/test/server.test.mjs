import assert from "node:assert/strict";
import test from "node:test";

import { reviewedBuildRoutes } from "../dist/server.js";

test("Agent Shell routes expose Goals, Programs, Runs, and Run controls", async () => {
  const calls = [];
  const run = { id: "run-1", status: "queued", steps: [] };
  const engine = {
    /** Lists fixture Goals. */
    listGoals: async () => [{ path: "otto/widget/goal.md", title: "Widget" }],
    /** Returns the fixture Program. */
    program: async (area) => ({ id: "reviewed-build", area }),
    /** Lists fixture Runs. */
    listRuns: async () => [run],
    /** Returns the fixture Run. */
    getRun: async () => run,
    /** Returns fixture output. */
    latestOutput: async () => "working",
    /** Returns a fixture diff. */
    diff: async () => "diff --git a/a b/a\n",
    /** Records a Run start. */
    start: async (input) => { calls.push(["start", input]); return run; },
    /** Records a Run control. */
    control: async (id, input) => { calls.push(["control", id, input]); return run; },
    /** Records a pending-step update. */
    updatePendingStep: async (id, step, input) => { calls.push(["step", id, step, input]); return run; },
    /** Records saved Area defaults. */
    saveAreaDefaults: async (area, input) => { calls.push(["defaults", area, input]); return { areaPath: area }; }
  };
  const route = reviewedBuildRoutes(engine)[0];

  const goals = await route.handle(request("GET"), new URL("http://localhost/api/work/goals"), []);
  assert.deepEqual(goals.json, { goals: [{ path: "otto/widget/goal.md", title: "Widget" }] });
  const program = await route.handle(request("GET"), new URL("http://localhost/api/work/program?area=otto%2Fwidget"), []);
  assert.deepEqual(program.json, { id: "reviewed-build", area: "otto/widget" });
  const detail = await route.handle(request("GET"), new URL("http://localhost/api/work/runs/run-1"), []);
  assert.deepEqual(detail.json, { run, latestOutput: "working" });

  const start = await route.handle(request("POST", { goalPath: "otto/widget/goal.md", bindings: {}, sessions: {} }), new URL("http://localhost/api/work/runs"), []);
  assert.equal(start.status, 202);
  const update = await route.handle(request("PATCH", { binding: { id: "codex" }, session: { mode: "fresh" } }), new URL("http://localhost/api/work/runs/run-1/steps/implement"), []);
  assert.equal(update.status, 200);
  const control = await route.handle(request("POST", { action: "stop" }), new URL("http://localhost/api/work/runs/run-1/control"), []);
  assert.equal(control.status, 200);
  const defaults = await route.handle(request("PUT", { bindings: {}, sessions: {} }), new URL("http://localhost/api/work/defaults/otto%2Fwidget"), []);
  assert.equal(defaults.status, 200);
  assert.deepEqual(calls, [
    ["start", { goalPath: "otto/widget/goal.md", bindings: {}, sessions: {} }],
    ["step", "run-1", "implement", { binding: { id: "codex" }, session: { mode: "fresh" } }],
    ["control", "run-1", { action: "stop" }],
    ["defaults", "otto/widget", { bindings: {}, sessions: {} }]
  ]);
});

test("the verification harness blocks every Reviewed build mutation", async () => {
  const prior = process.env.TANGENT_VERIFY_READONLY;
  process.env.TANGENT_VERIFY_READONLY = "1";
  const route = reviewedBuildRoutes({})[0];
  try {
    const response = await route.handle(request("POST", { goalPath: "goal.md" }), new URL("http://localhost/api/work/runs"), []);
    assert.equal(response.status, 403);
    assert.match(response.json.error, /disabled/);
  } finally {
    if (prior === undefined) delete process.env.TANGENT_VERIFY_READONLY;
    else process.env.TANGENT_VERIFY_READONLY = prior;
  }
});

/** Creates the IncomingMessage subset used by route tests. */
function request(method, body) {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    /** Yields the encoded request body. */
    async *[Symbol.asyncIterator]() { yield* bytes; }
  };
}
