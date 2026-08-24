import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createGoalQueryRoutes } from "./goal-query-routes.mjs";

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

test("Goal query routes preserve operation status and payloads", async () => {
  const routes = createGoalQueryRoutes({
    /** Lists one Goal. */
    async list(area) { return { status: 200, value: { goals: [{ area }] } }; },
    /** Rejects an unknown Goal. */
    async show(slug) { return { status: 404, error: `no goal ${slug}` }; },
  });
  const listed = response();
  await routes.handle(request("GET"), listed, new URL("http://shell/api/goals?area=otto"));
  assert.equal(listed.body.goals[0].area, "otto");
  const shown = response();
  await routes.handle(request("GET"), shown, new URL("http://shell/api/goals/show?slug=missing"));
  assert.equal(shown.status, 404);
  assert.equal(shown.body.error, "no goal missing");
});

test("Goal brief routes carry the requested prompt mode and pipeline step", async () => {
  let received;
  const routes = createGoalQueryRoutes({
    /** Captures prompt-inspector arguments. */
    async brief(...args) {
      received = args;
      return { status: 200, value: { markdown: "prompt" } };
    },
  });
  const result = response();
  await routes.handle(request("GET"), result, new URL("http://shell/api/goals/brief?file=otto%2Fgoal-x.md&mode=pipeline&step=3"));
  assert.deepEqual(received, ["otto/goal-x.md", "pipeline", 3]);
  assert.equal(result.body.markdown, "prompt");
});

test("Goal dependency routes preserve mutation direction", async () => {
  const calls = [];
  const routes = createGoalQueryRoutes({
    /** Captures dependency mutation arguments. */
    async dependencies(body, remove) {
      calls.push({ body, remove });
      return { status: 200, value: { ok: true } };
    },
  });
  for (const [path, remove] of [["depend", false], ["undepend", true]]) {
    const result = response();
    await routes.handle(request("POST", { slug: "ship", on: ["api"] }), result, new URL(`http://shell/api/goals/${path}`));
    assert.equal(result.status, 200);
    assert.equal(calls.at(-1).remove, remove);
  }
});
