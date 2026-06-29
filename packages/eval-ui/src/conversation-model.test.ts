import { describe, expect, it } from "vitest";
import { conversationMatchCount, messageMatches } from "./conversation-model.js";
import type { EvalConversation, EvalConversationMessage } from "./client.js";

/** A user turn with no tool calls. */
function user(text: string): EvalConversationMessage {
  return { id: "u", role: "user", text, toolCalls: [] };
}

/** An assistant turn that reads one file. */
function reads(path: string): EvalConversationMessage {
  return {
    id: "a",
    role: "assistant",
    text: "working",
    toolCalls: [{ id: "t", name: "Read", category: "file", targetPaths: [path], inputPreview: path }]
  };
}

describe("messageMatches", () => {
  it("matches a tool's target path case-insensitively", () => {
    expect(messageMatches(reads("/repo/.claude/skills/x/SKILL.md"), "skill")).toBe(true);
  });

  it("matches assistant prose and thinking", () => {
    const message: EvalConversationMessage = { id: "a", role: "assistant", text: "I will look at AGENTS", thinking: "secret plan", toolCalls: [] };
    expect(messageMatches(message, "agents")).toBe(true);
    expect(messageMatches(message, "secret")).toBe(true);
  });

  it("does not match an unrelated turn, and an empty needle matches nothing", () => {
    expect(messageMatches(user("hello"), "skill")).toBe(false);
    expect(messageMatches(reads("/a/SKILL.md"), "   ")).toBe(false);
  });
});

describe("conversationMatchCount", () => {
  it("counts only the matching turns", () => {
    const conversation: EvalConversation = {
      id: "c",
      provider: "claude",
      messages: [user("start"), reads("/a/SKILL.md"), reads("/b/main.ts")],
      totals: { userMessages: 1, assistantMessages: 2, toolCalls: 2 }
    };
    expect(conversationMatchCount(conversation, "skill")).toBe(1);
    expect(conversationMatchCount(conversation, "")).toBe(0);
  });
});
