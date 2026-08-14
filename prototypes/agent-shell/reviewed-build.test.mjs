import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createReviewedBuildBridge } from "./reviewed-build.mjs";

/** Creates one request body that supports async iteration. */
function request(method = "GET", body) {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return Object.assign(Readable.from(source), { method });
}

/** Captures one bridge response. */
function response() {
  return {
    status: 0,
    headers: {},
    body: "",
    /** Records the HTTP status and headers. */
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    /** Records the response body. */
    end(body = "") { this.body = String(body); },
  };
}

/** Sends one request through the bridge. */
async function send(bridge, method, target, body) {
  const output = response();
  const matched = await bridge.handle(request(method, body), output, new URL(target, "http://agent-shell.test"));
  const json = output.body && output.headers["content-type"]?.startsWith("application/json")
    ? JSON.parse(output.body)
    : undefined;
  return { matched, ...output, json };
}

test("the standalone Agent Shell bridge exposes Reviewed build state and controls", async () => {
  const calls = [];
  const run = { id: "run-1", status: "running", goalPath: "otto/tangent/goal-build.md" };
  const engine = {
    /** Lists Goals. */
    async listGoals() { return [{ path: run.goalPath, title: "Build it" }]; },
    /** Returns the Program. */
    async program(area) { return { id: "reviewed-build", area, steps: Array.from({ length: 8 }, (_, index) => ({ order: index + 1 })) }; },
    /** Lists Runs. */
    async listRuns() { return [run]; },
    /** Gets one Run. */
    async getRun() { return run; },
    /** Gets the latest output. */
    async latestOutput() { return "working"; },
    /** Starts one Run. */
    async start(input) { calls.push(["start", input]); return run; },
    /** Controls one Run. */
    async control(id, input) { calls.push(["control", id, input]); return { ...run, status: "stopped" }; },
    /** Changes one pending step. */
    async updatePendingStep(id, step, input) { calls.push(["step", id, step, input]); return run; },
    /** Saves Area defaults. */
    async saveAreaDefaults(area, input) { calls.push(["defaults", area, input]); return { areaPath: area }; },
    /** Reads one diff. */
    async diff() { return "diff --git"; },
    /** Reads one artifact. */
    async artifact() { return { path: "docs/design.md", content: "# Design\n" }; },
  };
  const bridge = createReviewedBuildBridge({ engine });

  const program = await send(bridge, "GET", "/api/reviewed-build/program?area=otto%2Ftangent");
  assert.equal(program.status, 200);
  assert.equal(program.json.steps.length, 8);
  assert.equal(program.json.area, "otto/tangent");

  const detail = await send(bridge, "GET", "/api/reviewed-build/runs/run-1");
  assert.deepEqual(detail.json, { run, latestOutput: "working" });

  const started = await send(bridge, "POST", "/api/reviewed-build/runs", { goalPath: run.goalPath });
  assert.equal(started.status, 202);
  assert.deepEqual(calls[0], ["start", { goalPath: run.goalPath, bindings: undefined, sessions: undefined }]);

  const stopped = await send(bridge, "POST", "/api/reviewed-build/runs/run-1/control", { action: "stop" });
  assert.equal(stopped.json.run.status, "stopped");

  const artifact = await send(bridge, "GET", "/api/reviewed-build/runs/run-1/artifacts/design/1/0");
  assert.equal(artifact.body, "# Design\n");
  assert.equal(artifact.headers["content-type"], "text/markdown; charset=utf-8");

  const unrelated = await send(bridge, "GET", "/api/vault");
  assert.equal(unrelated.matched, false);
});
