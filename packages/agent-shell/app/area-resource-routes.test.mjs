import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createAreaResourceRoutes } from "./area-resource-routes.mjs";

/** Creates a small Node response recorder. */
function response() {
  return {
    status: 0,
    body: "",
    /** Records response status. */
    writeHead(status) { this.status = status; },
    /** Records the JSON response body. */
    end(body = "") { this.body = body; },
  };
}

/** Creates one JSON request stream. */
function request(value, method = "POST") {
  const stream = Readable.from([JSON.stringify(value)]);
  stream.method = method;
  return stream;
}

test("routes every resource contract without changing operation envelopes", async () => {
  const calls = [];
  const operations = {};
  for (const name of ["read", "resolve", "refresh", "discover", "inspectTarget", "apply", "representation"]) {
    /** Captures one operation input and returns a typed fixture response. */
    operations[name] = async (input) => { calls.push({ name, input }); return { status: 200, operation: name, input }; };
  }
  const routes = createAreaResourceRoutes({ operations });
  const fixtures = [
    ["GET", "/api/areas/map-resources?area=otto%2Ftangent", null, "read"],
    ["POST", "/api/areas/map-resources/resolve", { resources: [] }, "resolve"],
    ["POST", "/api/areas/map-resources/refresh", { resources: [] }, "refresh"],
    ["POST", "/api/areas/map-resources/discover", { area: "otto/tangent" }, "discover"],
    ["POST", "/api/areas/map-resources/inspect-target", { kind: "worktree", path: "/tmp/x" }, "inspectTarget"],
    ["POST", "/api/areas/map-resources/apply", { schema: "area-map-resource-mutation.v1" }, "apply"],
    ["POST", "/api/areas/map-resources/representation", { schema: "area-map-resource-representation.v1" }, "representation"],
  ];
  for (const [method, address, body, expected] of fixtures) {
    const output = response();
    const input = body === null ? { method } : request(body, method);
    assert.equal(await routes.handle(input, output, new URL(`http://local${address}`)), true);
    assert.equal(output.status, 200);
    assert.equal(JSON.parse(output.body).operation, expected);
  }
  assert.deepEqual(calls[0], { name: "read", input: { area: "otto/tangent" } });
});

test("returns stable malformed, unavailable, and timeout errors", async () => {
  const routes = createAreaResourceRoutes({
    deadlineMs: 5,
    operations: {
      /** Waits until the route-owned abort deadline. */
      refresh: (_body, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    },
  });
  const malformed = response();
  const malformedRequest = Readable.from(["{"]); malformedRequest.method = "POST";
  await routes.handle(malformedRequest, malformed, new URL("http://local/api/areas/map-resources/apply"));
  assert.equal(malformed.status, 400);
  assert.equal(JSON.parse(malformed.body).code, "invalid-resource-request");

  const unavailable = response();
  await routes.handle(request({}), unavailable, new URL("http://local/api/areas/map-resources/apply"));
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.parse(unavailable.body).code, "resource-unavailable");

  const timedOut = response();
  await routes.handle(request({ resources: [] }), timedOut, new URL("http://local/api/areas/map-resources/refresh"));
  assert.equal(timedOut.status, 503);
  assert.equal(JSON.parse(timedOut.body).code, "resource-timeout");
});
