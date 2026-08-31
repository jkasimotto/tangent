import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createJobRoutes } from "./job-routes.mjs";

/** Builds a minimal readable HTTP request fixture. */
function request(body = null, method = "GET") {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  req.method = method;
  req.headers = { "content-type": "application/json" };
  return req;
}

/** Captures a minimal JSON HTTP response fixture. */
function response() {
  const chunks = [];
  return {
    statusCode: 0,
    /** Records the response status. */
    writeHead(status) { this.statusCode = status; },
    /** Records one response body chunk. */
    end(value = "") { chunks.push(String(value)); },
    /** Parses the captured JSON response. */
    value() { return JSON.parse(chunks.join("")); },
  };
}

test("canonical Job routes return Job nouns and no pipeline field", async () => {
  const routes = createJobRoutes({
    /** Returns the fixture Job. */
    show: async () => ({ status: 200, job: { run: 2, revision: 4, assignments: [] }, runs: [] }),
  });
  const res = response();
  assert.equal(await routes.handle(request(), res, new URL("http://local/api/jobs/show?goal=a%2Fgoal-x.md&run=2")), true);
  assert.equal(res.value().job.run, 2);
  assert.equal(Object.hasOwn(res.value(), "pipeline"), false);
});

test("canonical Job mutation forwards operation and revision fences", async () => {
  let received;
  const routes = createJobRoutes({
    /** Captures the append request. */
    append: async (goal, body) => { received = { goal, body }; return { status: 200, job: { run: 3, revision: 8 } }; },
  });
  const res = response();
  const body = { goal: "a/goal-x.md", expectedRun: 3, expectedRevision: 7, operationId: "append-1", steps: [{ instruction: "Review." }] };
  await routes.handle(request(body, "POST"), res, new URL("http://local/api/jobs/append"));
  assert.deepEqual(received, { goal: body.goal, body });
  assert.equal(res.value().job.revision, 8);
});
