import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createAgentRoutes } from "./agent-routes.mjs";

/** Creates one request double. */
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

test("agent context passes the exact session to the read-only projection", async () => {
  let received = null;
  const routes = createAgentRoutes({
    /** Returns a durable context fixture. */
    async context(session) {
      received = session;
      return { schema: "tangent-agent-context.v1", session, role: "worker", area: "otto/tangent" };
    },
  });
  const output = response();
  const handled = await routes.handle(request("GET"), output, new URL("http://shell/api/agents/context?session=worker%20one"));
  assert.equal(handled, true);
  assert.equal(received, "worker one");
  assert.equal(output.status, 200);
  assert.equal(output.body.context.session, "worker one");
});

test("agent context rejects a missing session and names missing durable work", async () => {
  const routes = createAgentRoutes({
    /** No durable record matches this fixture. */
    async context() { return null; },
  });
  const missing = response();
  await routes.handle(request("GET"), missing, new URL("http://shell/api/agents/context"));
  assert.equal(missing.status, 400);

  const unknown = response();
  await routes.handle(request("GET"), unknown, new URL("http://shell/api/agents/context?session=gone"));
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /no durable brain or Goal assignment/);
  assert.equal(await routes.handle(request("GET"), response(), new URL("http://shell/api/unknown")), false);
});

test("agent context returns a valid unassigned projection instead of a missing-record error", async () => {
  const routes = createAgentRoutes({
    /** Represents the server's read-only live-session fallback. */
    async context(session) {
      return { schema: "tangent-agent-context.v1", source: "live-session", session, role: "unassigned", area: null, current: true };
    },
  });
  const output = response();
  await routes.handle(request("GET"), output, new URL("http://shell/api/agents/context?session=plain-shell"));
  assert.equal(output.status, 200);
  assert.equal(output.body.context.role, "unassigned");
});
