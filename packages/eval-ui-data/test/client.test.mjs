import assert from "node:assert/strict";
import test from "node:test";

import { createEvalServerClient } from "../dist/index.js";

test("client builds compare endpoint with phase", async () => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await createEvalServerClient().getCompare({ runId: "r1", caseId: "c1", left: "a", right: "b", phase: "plan" });
    assert.equal(calls[0], "/api/eval/runs/r1/compare?caseId=c1&a=a&b=b&phase=plan");
  } finally {
    globalThis.fetch = previous;
  }
});
