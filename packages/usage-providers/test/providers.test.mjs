import assert from "node:assert/strict";
import test from "node:test";

import { builtInProviderAdapters } from "../dist/index.js";
import { normalizeClaudeNativeRecords } from "../dist/providers/claude/native/normalize.js";

test("lists built-in providers", () => {
  assert.deepEqual(builtInProviderAdapters.map((provider) => provider.id), ["claude", "codex"]);
});

test("claude native capture keeps thinking, plans, and verbatim tool output", () => {
  const longOutput = "X".repeat(5000);
  const planMarkdown = "# Plan\n\n1. Do the thing\n2. Do the other thing";
  const records = [
    {
      line: 0,
      record: {
        type: "assistant",
        timestamp: "2026-06-18T00:00:00.000Z",
        uuid: "asst-1",
        sessionId: "sess-1",
        message: {
          id: "msg-1",
          model: "claude-opus-4-8",
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me reason about this carefully." },
            { type: "text", text: "Here is my plan." },
            { type: "tool_use", id: "tu-1", name: "ExitPlanMode", input: { plan: planMarkdown } }
          ],
          usage: { input_tokens: 10, output_tokens: 20 }
        }
      }
    },
    {
      line: 1,
      record: {
        type: "user",
        timestamp: "2026-06-18T00:00:01.000Z",
        uuid: "user-1",
        sessionId: "sess-1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: longOutput, is_error: false }]
        }
      }
    }
  ];

  const events = normalizeClaudeNativeRecords(records, { sourcePath: "/tmp/sess-1.jsonl", inferredComplete: false });

  const assistant = events.find((event) => event.kind === "message.assistant.visible");
  assert.equal(assistant.data.thinking, "Let me reason about this carefully.");

  const planCall = events.find((event) => event.kind === "tool.call" && event.data.category === "plan");
  assert.ok(planCall, "expected an ExitPlanMode tool call categorized as plan");
  assert.equal(planCall.data.plan, planMarkdown);
  assert.equal(planCall.data.tool_name, "ExitPlanMode");

  const result = events.find((event) => event.kind === "tool.result");
  assert.equal(result.data.output, longOutput, "tool output must be stored verbatim, not truncated");
});
