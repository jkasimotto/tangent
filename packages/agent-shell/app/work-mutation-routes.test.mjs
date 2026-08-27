import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createWorkMutationRoutes } from "./work-mutation-routes.mjs";

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

test("work mutation routes dispatch POST bodies and GET filters", async () => {
  const routes = createWorkMutationRoutes({
    /** Creates one simple Goal. */
    async createSimple(body) { return { status: 200, value: { file: body.title } }; },
    /** Lists filtered ideas. */
    async ideas(input) { return { status: 200, value: { ideas: [{ area: input.area }] } }; },
    /** Reads one Goal detail projection. */
    async detail(input) { return { status: 200, value: { goal: { file: input.goal } } }; },
  });
  const created = response();
  await routes.handle(request("POST", { title: "Goal" }), created, new URL("http://shell/api/goals/new"));
  assert.equal(created.body.file, "Goal");
  const ideas = response();
  await routes.handle(request("GET"), ideas, new URL("http://shell/api/ideas?area=otto"));
  assert.equal(ideas.body.ideas[0].area, "otto");
  const detail = response();
  await routes.handle(request("GET"), detail, new URL("http://shell/api/goals/detail?goal=otto%2Fgoal.md"));
  assert.equal(detail.body.goal.file, "otto/goal.md");
});

test("the human assignee and Area roster routes are gone", async () => {
  const routes = createWorkMutationRoutes({});
  for (const path of ["/api/goals/assignees", "/api/areas/people"]) {
    assert.equal(await routes.handle(request("POST", {}), response(), new URL(`http://shell${path}`)), false, `${path} is not routed`);
  }
});
