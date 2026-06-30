import assert from "node:assert/strict";
import test from "node:test";
import { formatTranscriptForJudge } from "../dist/core/transcript.js";

const conversations = [{
  conversationId: "claude:1", provider: "claude",
  messages: [
    { id: "u", role: "user", text: "add debug_log" },
    { id: "a", role: "assistant", model: "haiku", text: "reading", thinking: "plan",
      toolCalls: [{ id: "t", name: "Read", category: "file", input: { file_path: "/wt/lib/x.dart" }, targetPaths: ["/wt/lib/x.dart"], result: { status: "success" }, evidenceEventIds: [] }] }
  ],
  totals: { userMessages: 1, assistantMessages: 1, toolCalls: 1 }, caveats: []
}];

test("formats a compact transcript with relativized paths", () => {
  const text = formatTranscriptForJudge(conversations, "/wt");
  assert.match(text, /user:/);
  assert.match(text, /Read/);
  assert.match(text, /lib\/x\.dart/);
  assert.ok(!text.includes("/wt/lib"));
});

test("truncation marker appears past the cap", () => {
  const big = [{ ...conversations[0], messages: [{ id: "u", role: "user", text: "x".repeat(50000) }] }];
  const text = formatTranscriptForJudge(big, "/wt", 500);
  assert.ok(text.length <= 600);
  assert.match(text, /transcript truncated/);
});
