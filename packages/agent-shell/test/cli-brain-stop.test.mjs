import assert from "node:assert/strict";
import test from "node:test";

import { runBrainCli } from "../dist/cli/index.js";

/** One complete brain projection returned by the stop command's authoritative lookup. */
function brain(overrides = {}) {
  return {
    area: "otto/tangent",
    status: "active",
    live: true,
    generation: 7,
    session: "tangent-brain-session",
    currentAttemptId: "tangent-brain-attempt-7",
    planFile: "otto/tangent/plan.md",
    foundingInstruction: { text: "Run the Area.", createdAt: "2026-08-27T00:00:00.000Z" },
    checkpoint: null,
    latestHandover: null,
    ...overrides,
  };
}

test("tangent brain stop fences the exact current attempt with a fresh operation id", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  console.log = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    requests.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET") return Response.json({ brain: brain() });
    return Response.json({ status: "stopped" });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runBrainCli(["stop", "otto/tangent"]);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url.pathname, "/api/brains/show");
  assert.equal(requests[0].url.searchParams.get("area"), "otto/tangent");
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].url.pathname, "/api/brains/stop");
  assert.equal(requests[1].body.area, "otto/tangent");
  assert.equal(requests[1].body.expectedAttemptId, "tangent-brain-attempt-7");
  assert.notEqual(requests[1].body.expectedAttemptId, "tangent-brain-session");
  assert.match(requests[1].body.operationId, /^[0-9a-f-]{36}$/);
});

test("tangent brain stop does not POST for an inactive brain", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const lines = [];
  console.log = (line) => lines.push(String(line));
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: new URL(String(input)), method: String(init.method ?? "GET").toUpperCase() });
    return Response.json({ brain: brain({ status: "inactive", live: false, currentAttemptId: null }) });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runBrainCli(["stop", "otto/tangent"]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url.pathname, "/api/brains/show");
  assert.deepEqual(lines, ["otto/tangent brain is already inactive."]);
});

test("tangent brain stop rejects a missing Area and session before HTTP", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousTmux = process.env.TMUX;
  let requests = 0;
  delete process.env.TMUX;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("HTTP must not run without an Area or session");
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });

  await assert.rejects(
    runBrainCli(["stop"]),
    /brain stop needs an Area, or run it inside the brain's tmux session/,
  );
  assert.equal(requests, 0);
});
