import assert from "node:assert/strict";
import test from "node:test";

import { computeAgentTimeDistribution } from "../dist/core/insights/index.js";

/** Builds a minimal NormalizedToolCall fixture. */
function toolCall(category, durationMs) {
  return {
    id: `${category}-${durationMs}`,
    name: "Tool",
    category,
    targetPaths: [],
    evidenceEventIds: [],
    result: { status: "success", durationMs }
  };
}

/** Builds a minimal assistant NormalizedConversationMessage fixture with the given tool calls. */
function assistantMessage(id, toolCalls) {
  return { id, role: "assistant", text: "", toolCalls, confidence: "exact" };
}

/** Builds a minimal NormalizedConversation fixture from a list of assistant messages. */
function conversation(conversationId, messages) {
  return {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId,
    providerSessionId: conversationId,
    repo: { root: "/repo/polez" },
    messages,
    totals: { userMessages: 0, assistantMessages: messages.length, toolCalls: 0 },
    caveats: []
  };
}

test("computeAgentTimeDistribution groups read+search as finding info, command as executing, write as writing", () => {
  const convo = conversation("conv-1", [
    assistantMessage("m1", [
      toolCall("read", 30_000),
      toolCall("search", 10_000),
      toolCall("command", 40_000),
      toolCall("write", 20_000)
    ])
  ]);

  const distribution = computeAgentTimeDistribution([convo]);
  assert.equal(distribution.totalMs, 100_000);
  const [findingInfo, executing, writing] = distribution.categories;
  assert.equal(findingInfo.key, "findingInfo");
  assert.equal(findingInfo.ms, 40_000);
  assert.equal(findingInfo.fraction, 0.4);
  assert.equal(executing.key, "executing");
  assert.equal(executing.ms, 40_000);
  assert.equal(executing.fraction, 0.4);
  assert.equal(writing.key, "writing");
  assert.equal(writing.ms, 20_000);
  assert.equal(writing.fraction, 0.2);
});

test("computeAgentTimeDistribution returns zero fractions with no tool calls", () => {
  const distribution = computeAgentTimeDistribution([conversation("conv-empty", [assistantMessage("m1", [])])]);
  assert.equal(distribution.totalMs, 0);
  assert.deepEqual(distribution.categories.map((category) => category.fraction), [0, 0, 0]);
});

test("computeAgentTimeDistribution counts an 'other' category call toward the total but not toward any bar", () => {
  const convo = conversation("conv-other", [assistantMessage("m1", [toolCall("other", 10_000), toolCall("read", 10_000)])]);
  const distribution = computeAgentTimeDistribution([convo]);
  assert.equal(distribution.totalMs, 20_000);
  const findingInfo = distribution.categories.find((category) => category.key === "findingInfo");
  assert.equal(findingInfo.ms, 10_000);
  assert.equal(findingInfo.fraction, 0.5);
});
