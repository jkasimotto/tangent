import assert from "node:assert/strict";
import test from "node:test";

import { createUsageClient, UsageDataset } from "../dist/index.js";
import { conversationReport } from "../dist/core/conversation-report.js";
import { eventsToProjections } from "../dist/core/projections.js";

test("usage core exports dataset and in-memory client APIs", async () => {
  const dataset = new UsageDataset([]);
  assert.deepEqual(dataset.conversations.all().data, []);
  const client = createUsageClient({ events: [] });
  assert.deepEqual((await client.sessions.list()).data, []);
});

/** Builds a minimal Claude native v2 event for projection/report tests. */
function claudeBase(eventId, kind, overrides) {
  return {
    schema: "usage.event.v2",
    event_id: eventId,
    kind,
    recorded_at: "2026-06-18T00:00:00.000Z",
    observed_at: "2026-06-18T00:00:00.000Z",
    provider: "claude",
    capture: { source: "native-import", scope: "native", usage_version: "0.1.0", content_mode: "metadata-with-excerpts", confidence: "partial" },
    repo: { tracking: { enabled: true, source: "none" } },
    conversation: { id: "conv-1", provider_session_id: "sess-1", transcript_path: "/tmp/x.jsonl" },
    turn: { id: "t1" },
    ...overrides
  };
}

const thinkingPlanEvents = [
  claudeBase("e1", "message.assistant.visible", {
    actor: { role: "assistant", model: "claude-opus-4-8" },
    links: { message_id: "msg-1" },
    data: { text: "Here is my plan.", text_preview: "Here is my plan.", thinking: "reasoning here" }
  }),
  claudeBase("e2", "tool.call", {
    actor: { role: "assistant", model: "claude-opus-4-8" },
    links: { message_id: "msg-1", tool_call_id: "tu-1" },
    data: { tool_name: "ExitPlanMode", category: "plan", input: { plan: "# Plan" }, plan: "# Plan", target_paths: [] }
  })
];

test("conversation report surfaces assistant thinking and proposed plans", () => {
  const report = conversationReport({ annotatedEvents: thinkingPlanEvents }, { conversationId: "conv-1" });
  const assistant = report.messages.find((message) => message.role === "assistant");
  assert.equal(assistant.thinking, "reasoning here");
  const planCall = assistant.toolCalls.find((call) => call.category === "plan");
  assert.equal(planCall.plan, "# Plan");
});

test("projections carry thinking onto messages and plan onto tool calls", () => {
  const projections = eventsToProjections({ events: thinkingPlanEvents });
  const message = projections.messages.find((row) => row.role === "assistant");
  assert.equal(message.hasThinking, true);
  assert.equal(message.thinking, "reasoning here");
  const toolCall = projections.toolCalls.find((row) => row.category === "plan");
  assert.equal(toolCall.plan, "# Plan");
});

test("session duration falls back to wall-clock span when events carry no per-event durations", () => {
  const events = [
    claudeBase("d1", "message.assistant.visible", {
      recorded_at: "2026-06-18T00:00:00.000Z", observed_at: "2026-06-18T00:00:00.000Z",
      actor: { role: "assistant", model: "claude-opus-4-8" }, links: { message_id: "m1" }, data: { text: "start" }
    }),
    claudeBase("d2", "message.assistant.visible", {
      recorded_at: "2026-06-18T00:05:00.000Z", observed_at: "2026-06-18T00:05:00.000Z",
      actor: { role: "assistant", model: "claude-opus-4-8" }, links: { message_id: "m2" }, data: { text: "end" }
    })
  ];
  const projections = eventsToProjections({ events });
  assert.equal(projections.sessions[0].metrics.durationMs, 300_000, "Claude sessions report their first-to-last span");
});

test("session peak context is the largest single-turn resident window, not a sum of cache reads", () => {
  /** Builds one assistant token-usage turn whose resident context is dominated by cache reads. */
  const turn = (eventId, time, cacheRead) => claudeBase(eventId, "token.usage", {
    recorded_at: time, observed_at: time,
    actor: { role: "assistant", model: "claude-opus-4-8" }, links: { message_id: eventId },
    data: { usage: { input_tokens: 2, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 1000, output_tokens: 50 } }
  });
  const events = [
    turn("c1", "2026-06-18T00:00:00.000Z", 30_000),
    turn("c2", "2026-06-18T00:01:00.000Z", 78_000),
    turn("c3", "2026-06-18T00:02:00.000Z", 60_000)
  ];
  const tokens = eventsToProjections({ events }).sessions[0].metrics.tokens;
  assert.equal(tokens.context, 79_002, "context is the max per-turn (input + cacheRead + cacheCreation), i.e. the peak window");
  assert.ok(tokens.total > tokens.context * 2, "the cumulative total dwarfs the real working set, which is why the UI shows peak context instead");
});
