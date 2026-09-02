import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

test("rollback keeps compatible reads while disabling refresh, discovery, and writers", async () => {
  const calls = [];
  const operations = Object.fromEntries(
    ["read", "resolve", "refresh", "discover", "inspectTarget", "apply", "representation"].map((name) => [name, async () => {
      calls.push(name);
      return { status: 200, operation: name };
    }]),
  );
  const routes = createAreaResourceRoutes({ operations, writesEnabled: false });
  const allowed = [
    ["GET", "/api/areas/map-resources?area=otto%2Ftangent", null, "read"],
    ["POST", "/api/areas/map-resources/resolve", { resources: [] }, "resolve"],
    ["POST", "/api/areas/map-resources/inspect-target", { kind: "worktree", path: "/tmp/x" }, "inspectTarget"],
  ];
  for (const [method, address, body, expected] of allowed) {
    const output = response();
    await routes.handle(body === null ? { method } : request(body, method), output, new URL(`http://local${address}`));
    assert.equal(output.status, 200);
    assert.equal(JSON.parse(output.body).operation, expected);
  }
  for (const address of [
    "/api/areas/map-resources/refresh",
    "/api/areas/map-resources/discover",
    "/api/areas/map-resources/apply",
    "/api/areas/map-resources/representation",
  ]) {
    const output = response();
    await routes.handle(request({}), output, new URL(`http://local${address}`));
    assert.equal(output.status, 503);
    assert.deepEqual(JSON.parse(output.body), {
      status: 503,
      code: "resource-unavailable",
      error: "Map resources are unavailable.",
      retryable: false,
    });
  }
  assert.deepEqual(calls, ["read", "resolve", "inspectTarget"]);
});

test("returns stable malformed, unavailable, and timeout errors", async () => {
  let cleaned = false;
  const routes = createAreaResourceRoutes({
    deadlineMs: 5,
    operations: {
      /** Completes asynchronous cleanup after the route-owned abort deadline. */
      refresh: (_body, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        setTimeout(() => {
          cleaned = true;
          reject(new Error("aborted and cleaned"));
        }, 10);
      }, { once: true })),
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
  assert.equal(cleaned, true, "the response waits until the aborted operation finishes cleanup");
});

test("route deadlines stay bounded for an abort-ignoring operation", async () => {
  const routes = createAreaResourceRoutes({
    deadlineMs: 5,
    cleanupGraceMs: 10,
    operations: {
      /** Deliberately never settles and ignores its signal. */
      discover: async () => new Promise(() => {}),
    },
  });
  const output = response();
  const started = Date.now();
  await routes.handle(request({ area: "otto/tangent" }), output, new URL("http://local/api/areas/map-resources/discover"));
  assert.ok(Date.now() - started < 200);
  assert.equal(output.status, 503);
  assert.equal(JSON.parse(output.body).code, "resource-timeout");
});

test("a deadline reaps a spawned slow operation before the route responds", async () => {
  let child = null;
  let exited = false;
  const routes = createAreaResourceRoutes({
    deadlineMs: 20,
    cleanupGraceMs: 500,
    operations: {
      /** Models the abort/reap contract used by bounded Git discovery. */
      discover: (_body, { signal }) => {
        child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        return new Promise((_resolve, reject) => {
          const stop = () => {
            child.once("exit", () => {
              exited = true;
              reject(new Error("slow child reaped"));
            });
            child.kill("SIGTERM");
          };
          if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
        });
      },
    },
  });
  const output = response();
  try {
    await routes.handle(request({ area: "otto/tangent" }), output, new URL("http://local/api/areas/map-resources/discover"));
    assert.equal(exited, true);
    assert.notEqual(child?.exitCode ?? child?.signalCode, null);
    assert.equal(output.status, 503);
    assert.equal(JSON.parse(output.body).code, "resource-timeout");
  } finally {
    if (child && !exited) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
    }
  }
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
