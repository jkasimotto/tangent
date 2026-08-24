import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createWorkMutationRoutes } from "./work-mutation-routes.mjs";

test("the assignee route calls only the assignee operation", async () => {
  const calls = [];
  const routes = createWorkMutationRoutes(new Proxy({}, {
    /** Records the one operation that the route selects. */
    get(_target, name) {
      return async (body) => {
        calls.push({ name, body });
        return { status: 200, value: { ok: true } };
      };
    },
  }));
  const request = Readable.from([JSON.stringify({ file: "otto/goal-work.md", assignees: ["Troy"] })]);
  request.method = "POST";
  const response = {
    /** Ignores the response status in this routing test. */
    writeHead() {},
    /** Ignores the response body in this routing test. */
    end() {},
  };
  assert.equal(await routes.handle(request, response, new URL("http://localhost/api/goals/assignees")), true);
  assert.deepEqual(calls, [{ name: "assignees", body: { file: "otto/goal-work.md", assignees: ["Troy"] } }]);
});
