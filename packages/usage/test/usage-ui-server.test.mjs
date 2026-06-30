import assert from "node:assert/strict";
import test from "node:test";

import { createUsageUiApp, startUsageUiServer } from "../dist/server/index.js";

test("usage ui server serves app assets and session API", async () => {
  const server = await startUsageUiServer({ open: false, client: fakeUsageClient() });
  try {
    const list = await (await fetch(`${server.url}api/usage/sessions`)).json();
    assert.equal(list.sessions[0].title, "Implement UI");
    assert.equal(list.sessions[0].tokensTotal, 1200);

    const detail = await (await fetch(`${server.url}api/usage/sessions/s1`)).json();
    assert.equal(detail.session.title, "Implement UI");
    assert.equal(detail.summaryCards[1].value, 1200);

    const transcript = await (await fetch(`${server.url}api/usage/sessions/s1/transcript`)).json();
    assert.equal(transcript.messages[0].textPreview, "Done");

    const timelineView = await (await fetch(`${server.url}api/usage/sessions/s1/timeline-view`)).json();
    assert.equal(timelineView.selected.title, "Implement UI");
    assert.equal(timelineView.chart.steps[0].label, "Assistant response");

    const conversationView = await (await fetch(`${server.url}api/usage/sessions/s1/conversation-view`)).json();
    assert.equal(conversationView.selected.title, "Implement UI");
    assert.equal(conversationView.messages[0].textPreview, "Done");
    assert.equal(conversationView.chart.rows[0].segments[0].label, "Assistant response");

    const html = await (await fetch(server.url)).text();
    assert.match(html, /Tangent Usage/);
  } finally {
    await server.close();
  }
});

test("usage ui app descriptor exposes embedded assets and routes", async () => {
  const registration = await createUsageUiApp({ client: fakeUsageClient() });
  assert.deepEqual(registration.app, {
    id: "usage",
    label: "Usage",
    routePath: "/usage",
    modulePath: "/apps/usage/embedded.js",
    stylePaths: ["/apps/usage/embedded.css"]
  });
  assert.equal(registration.assetMounts[0].pathPrefix, "/apps/usage");
  assert.equal(registration.routes.length, 1);
  const response = await registration.routes[0].handle({ method: "GET" }, new URL("http://localhost/api/usage/sessions"), []);
  assert.equal(response.status, 200);
  assert.equal(response.json.sessions[0].title, "Implement UI");
});

/** Creates a fake Usage core client for server route tests. */
function fakeUsageClient() {
  const session = {
    id: "s1",
    provider: "codex",
    title: "Implement UI",
    models: ["gpt"],
    startedAt: "2026-06-15T10:00:00.000Z",
    endedAt: "2026-06-15T10:01:00.000Z",
    metrics: { durationMs: 60000, durationConfidence: "derived", tokens: { total: 1200, peakContext: 1200, confidence: "provider-reported" } },
    counts: { toolCalls: 3, filesTouched: 2, userMessages: 1, assistantMessages: 1 },
    availability: { notes: [] }
  };
  return {
    sessions: {
      /** Lists fake Usage sessions. */
      async list() {
        return result([session]);
      },
      /** Gets a fake Usage session. */
      async get() {
        return result(session);
      },
      /** Gets a fake Usage timeline. */
      async timeline() {
        return result({ schema: "tangent.usage.timeline.v1", items: [{ id: "step1", turnId: "turn1", label: "Assistant response", kind: "assistant_response", durationMs: 60000, metricValue: 60000 }] });
      },
      /** Gets a fake Usage transcript. */
      async report() {
        return result({
          schema: "tangent.usage.session_report.v1",
          session,
          messages: [{ id: "m1", turnId: "turn1", stepId: "step1", role: "assistant", textPreview: "Done", tokenUsage: { total: 1200, confidence: "provider-reported" }, toolCalls: [] }],
          totals: { userMessages: 1, assistantMessages: 1, toolCalls: 3, tokens: session.metrics.tokens },
          caveats: []
        });
      }
    },
    messages: {
      /** Queries fake Usage messages. */
      async query() {
        return result([]);
      }
    },
    providers: {
      /** Lists fake provider capabilities. */
      async list() {
        return result([]);
      }
    }
  };
}

/** Wraps data in a Usage result envelope. */
function result(data) {
  return { data, meta: { warnings: [] } };
}
