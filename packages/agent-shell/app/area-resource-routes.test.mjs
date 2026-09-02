import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createAreaResourceRoutes } from "./area-resource-routes.mjs";

/** Returns one minimal complete resource panel recovery fixture. */
function projection() {
  return {
    state: "current",
    rows: [],
    catalogs: [{ owner: "otto/tangent", revision: "revision-1" }],
    legacyReview: [],
    suggestions: [],
    counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
  };
}

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

test("serializes returned and thrown failures through the same closed recovery boundary", async () => {
  const routes = createAreaResourceRoutes({
    operations: {
      /** Returns the exact-transaction failure shape used by mutation operations. */
      async apply() {
        return {
          status: 409,
          code: "duplicate-resource-target",
          error: "provider body: credential=secret",
          retryable: false,
          operationId: "returned-operation",
          changedPaths: ["private/catalog/path"],
          providerBody: "private",
          credentials: "secret",
          recovery: {
            code: "duplicate-resource-target",
            existing: { owner: "otto/tangent", id: "resource-1", target: "/private" },
            projection: { ...projection(), providerBody: "private" },
            target: { kind: "worktree", path: "/private" },
          },
        };
      },
      /** Throws a future typed Branch recovery failure. */
      async representation() {
        throw Object.assign(new Error("credential=secret"), {
          status: 409,
          code: "legacy-branch-choice-required",
          operationId: "thrown-operation",
          recovery: {
            code: "legacy-branch-choice-required",
            choices: [{ owner: "otto/tangent", field: "Worktree", targetFingerprint: "choice-1", label: "topic", target: "/private" }],
            projection: projection(),
            credentials: "secret",
          },
        });
      },
    },
  });

  const returned = response();
  await routes.handle(request({}), returned, new URL("http://local/api/areas/map-resources/apply"));
  assert.equal(returned.status, 409);
  assert.deepEqual(JSON.parse(returned.body), {
    status: 409,
    code: "duplicate-resource-target",
    error: "The target is already an active Map resource.",
    retryable: false,
    operationId: "returned-operation",
    recovery: {
      code: "duplicate-resource-target",
      existing: { owner: "otto/tangent", id: "resource-1" },
      projection: projection(),
    },
  });

  const thrown = response();
  await routes.handle(request({}), thrown, new URL("http://local/api/areas/map-resources/representation"));
  assert.equal(thrown.status, 409);
  assert.deepEqual(JSON.parse(thrown.body), {
    status: 409,
    code: "legacy-branch-choice-required",
    error: "Choose the resource that owns the legacy Branch.",
    retryable: false,
    operationId: "thrown-operation",
    recovery: {
      code: "legacy-branch-choice-required",
      choices: [{ owner: "otto/tangent", field: "Worktree", targetFingerprint: "choice-1", label: "topic" }],
      projection: projection(),
    },
  });
  assert.equal(returned.body.includes("private"), false);
  assert.equal(returned.body.includes("credential"), false);
  assert.equal(thrown.body.includes("private"), false);
  assert.equal(thrown.body.includes("credential"), false);
});
