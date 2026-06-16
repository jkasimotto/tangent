import assert from "node:assert/strict";
import test from "node:test";

import { createUsageApiClient, createUsageUiClient } from "../dist/index.js";

test("maps usage sessions into list view models", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists list. */
      list: async () => ({
        data: [{
          id: "s1",
          provider: "codex",
          title: "Implement UI",
          models: ["gpt"],
          metrics: { tokens: { total: 10 }, durationMs: 25 },
          counts: { toolCalls: 2 },
          availability: { notes: ["partial"] }
        }],
        meta: { warnings: [] }
      })
    }
  });
  const view = await client.listSessions();
  assert.equal(view.sessions[0].title, "Implement UI");
  assert.equal(view.sessions[0].tokensTotal, 10);
});

test("browser API client fetches usage session views", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ sessions: [{ id: "s1", title: "Implement UI" }], caveats: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = createUsageApiClient("http://local");
    const view = await client.listSessions({ limit: 5 });
    assert.deepEqual(requests, ["http://local/api/usage/sessions?limit=5"]);
    assert.equal(view.sessions[0].title, "Implement UI");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("browser API client explains missing local Usage API", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html><div id=\"root\"></div>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
  try {
    const client = createUsageApiClient("http://local");
    await assert.rejects(
      () => client.listSessions(),
      /Usage API unavailable/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
