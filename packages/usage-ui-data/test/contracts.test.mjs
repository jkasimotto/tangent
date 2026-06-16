import assert from "node:assert/strict";
import test from "node:test";

import { buildUsageCockpitView, createUsageApiClient, createUsageUiClient } from "../dist/index.js";

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

test("builds cockpit view without mixing session envelope into trace lanes", () => {
  const view = buildUsageCockpitView(
    {
      id: "s1",
      provider: "codex",
      title: "Implement UI",
      status: "active",
      startedAt: "2026-06-15T10:00:00.000Z",
      endedAt: "2026-06-15T11:00:00.000Z",
      metrics: { durationMs: 3_600_000, durationConfidence: "derived", tokens: { total: 12_000_000, confidence: "exact" } },
      counts: { toolCalls: 2, filesTouched: 1 },
      availability: { notes: ["partial timing"] }
    },
    [
      { id: "session", kind: "session", label: "codex session", durationMs: 3_600_000, selfDurationMs: 1_800_000, status: "success", metrics: {} },
      { id: "read", kind: "file_read", label: "Read app", durationMs: 10_000, selfDurationMs: 10_000, status: "success", targetPaths: ["src/app.ts"], metrics: {} },
      { id: "model", kind: "assistant_response", label: "Implementation plan", durationMs: 20_000, selfDurationMs: 20_000, status: "success", metrics: { tokens: { total: 12_000_000 } } }
    ],
    [
      { id: "m1", role: "user", textPreview: "Please redesign the usage UI." },
      { id: "m2", role: "assistant", textPreview: "I will inspect the current UI first.", tokenUsage: { total: 12_000_000 } }
    ],
    { range: { startedAt: "2026-06-15T10:00:00.000Z", endedAt: "2026-06-15T11:00:00.000Z", durationMs: 3_600_000 }, items: [] }
  );

  assert.equal(view.session.title, "Implement UI");
  assert.equal(view.storyline.chapters.some((chapter) => chapter.title === "Prompt & setup"), true);
  assert.equal(view.trace.lanes.flatMap((lane) => lane.items).some((item) => item.kind === "session"), false);
  assert.equal(view.trace.totals.sessionDurationMs, 3_600_000);
  assert.equal(view.diagnostics.some((card) => card.label === "Tokens" && card.tone === "warning"), true);
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
