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

test("claude native derives per-tool-call duration from timestamps, skipping subagents", () => {
  const records = [
    {
      line: 0,
      record: {
        type: "assistant", timestamp: "2026-06-18T00:00:00.000Z", sessionId: "sess-dur",
        message: { id: "m-a", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "tu-read", name: "Read", input: { file_path: "/a" } }], usage: { input_tokens: 1, output_tokens: 1 } }
      }
    },
    {
      line: 1,
      record: {
        type: "user", timestamp: "2026-06-18T00:00:00.250Z", sessionId: "sess-dur",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-read", content: "ok", is_error: false }] }
      }
    },
    {
      line: 2,
      record: {
        type: "assistant", timestamp: "2026-06-18T00:00:01.000Z", sessionId: "sess-dur",
        message: { id: "m-b", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "tu-task", name: "Task", input: { description: "spawn" } }], usage: { input_tokens: 1, output_tokens: 1 } }
      }
    },
    {
      line: 3,
      record: {
        type: "user", timestamp: "2026-06-18T00:00:01.005Z", sessionId: "sess-dur",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-task", content: "done", is_error: false }] }
      }
    }
  ];

  const events = normalizeClaudeNativeRecords(records, { sourcePath: "/tmp/sess-dur.jsonl", inferredComplete: false });
  const readResult = events.find((event) => event.kind === "tool.result" && event.links?.tool_call_id === "tu-read");
  const taskResult = events.find((event) => event.kind === "tool.result" && event.links?.tool_call_id === "tu-task");
  assert.equal(readResult.data.duration_ms, 250, "Read duration is result time minus call time");
  assert.equal(taskResult.data.duration_ms, undefined, "subagent result time does not reflect its runtime, so no per-call duration");
});

test("claude native merges streamed assistant chunks sharing one message.id", () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  const chunk = (line, block, stop) => ({
    line,
    record: {
      type: "assistant",
      timestamp: `2026-06-18T00:00:0${line}.000Z`,
      sessionId: "sess-2",
      message: { id: "msg-merge", model: "claude-opus-4-8", content: [block], usage, stop_reason: stop }
    }
  });
  const records = [
    chunk(0, { type: "thinking", thinking: "let me reason" }, "tool_use"),
    chunk(1, { type: "text", text: "doing it" }, "tool_use"),
    chunk(2, { type: "tool_use", id: "tu-a", name: "Read", input: { file_path: "/a" } }, "tool_use"),
    chunk(3, { type: "tool_use", id: "tu-b", name: "Bash", input: { command: "ls" } }, "tool_use")
  ];

  const events = normalizeClaudeNativeRecords(records, { sourcePath: "/tmp/sess-2.jsonl", inferredComplete: false });

  const messages = events.filter((event) => event.kind === "message.assistant.visible");
  assert.equal(messages.length, 1, "streamed chunks collapse to one assistant message");
  assert.equal(messages[0].data.text, "doing it");
  assert.equal(messages[0].data.thinking, "let me reason");

  assert.equal(events.filter((event) => event.kind === "tool.call").length, 2, "both distinct tool calls preserved");

  const tokenEvents = events.filter((event) => event.kind === "token.usage");
  assert.equal(tokenEvents.length, 1, "usage emitted once per turn, not once per chunk");
  assert.equal(tokenEvents[0].data.usage.output_tokens, 50, "no token multiplication across chunks");
});
