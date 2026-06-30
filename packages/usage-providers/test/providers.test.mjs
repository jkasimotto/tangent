import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { builtInProviderAdapters } from "../dist/index.js";
import { normalizeClaudeNativeRecords } from "../dist/providers/claude/native/normalize.js";
import { loadNativeSourceFiles } from "../dist/providers/native/load.js";
import { claudeProjectKey, discoverClaudeNative } from "../dist/providers/claude/native/discover.js";
import { normalizeGeminiNativeRecords } from "../dist/providers/gemini/native/normalize.js";
import { readGeminiNative } from "../dist/providers/gemini/native/read.js";
import { buildGeminiProjectMap, discoverGeminiNative, resolveGeminiCwd } from "../dist/providers/gemini/native/discover.js";
import { createHash } from "node:crypto";

test("claude project key encodes both slashes and dots, matching Claude Code's project dir names", () => {
  // A worktree under ~/.tangent: the dot in `.tangent` must become `-`, or transcripts are never found.
  assert.equal(claudeProjectKey("/Users/me/.tangent/eval/work"), "-Users-me--tangent-eval-work");
  assert.equal(claudeProjectKey("/Users/me/Projects/otto-tangent"), "-Users-me-Projects-otto-tangent");
});

test("indexes an active claude transcript instead of waiting for the quiet window", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude-home-"));
  const previousHome = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = home;
  try {
    const repoRoot = "/tmp/example-repo";
    const projectDir = path.join(home, "projects", claudeProjectKey(repoRoot));
    mkdirSync(projectDir, { recursive: true });
    // A conversation written one second ago: well inside the old 15-minute quiet gate.
    const now = new Date();
    const line = JSON.stringify({
      type: "assistant",
      timestamp: new Date(now.getTime() - 1000).toISOString(),
      uuid: "asst-1",
      sessionId: "active-session",
      message: { id: "msg-1", model: "claude-opus-4-8", role: "assistant", usage: { input_tokens: 1, output_tokens: 1 } }
    });
    writeFileSync(path.join(projectDir, "active-session.jsonl"), line + "\n");

    const result = await loadNativeSourceFiles({ repoRoot, providers: ["claude"], now });
    assert.equal(result.files.length, 1, "active transcript should be indexed, not dropped");
    assert.ok(result.files[0].path.endsWith("active-session.jsonl"));
  } finally {
    if (previousHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("unions transcripts across every CLAUDE_HOME profile dir", async () => {
  const homeA = mkdtempSync(path.join(tmpdir(), "claude-a-"));
  const homeB = mkdtempSync(path.join(tmpdir(), "claude-b-"));
  const previousHome = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = [homeA, homeB].join(path.delimiter);
  try {
    const repoRoot = "/tmp/example-repo";
    for (const [home, session] of [[homeA, "from-a"], [homeB, "from-b"]]) {
      const projectDir = path.join(home, "projects", claudeProjectKey(repoRoot));
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(path.join(projectDir, `${session}.jsonl`), "{}\n");
    }
    const scoped = await discoverClaudeNative(repoRoot);
    assert.deepEqual(
      scoped.map((file) => path.basename(file)).sort(),
      ["from-a.jsonl", "from-b.jsonl"],
      "a repo present under two profiles yields transcripts from both"
    );
    const all = await discoverClaudeNative();
    assert.equal(all.length, 2, "unscoped discovery also unions every profile");
  } finally {
    if (previousHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousHome;
    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
  }
});

test("lists built-in providers", () => {
  assert.deepEqual(builtInProviderAdapters.map((provider) => provider.id), ["claude", "codex", "gemini"]);
});

test("gemini display name is Gemini CLI", () => {
  const gemini = builtInProviderAdapters.find((provider) => provider.id === "gemini");
  assert.equal(gemini.displayName, "Gemini CLI");
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
  /** Builds a streamed assistant record sharing one message.id for the merge test. */
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

test("gemini native fans a single message out into reasoning, reply, tool call/result, and folded token usage", () => {
  const records = [
    { line: 1, record: { sessionId: "sess-g1", projectHash: "hash", startTime: "2026-06-30T10:00:00.000Z", kind: "main" } },
    { line: 2, record: { type: "user", id: "u1", timestamp: "2026-06-30T10:00:01.000Z", content: [{ text: "Fix the login bug" }] } },
    {
      line: 3,
      record: {
        type: "gemini", id: "g1", timestamp: "2026-06-30T10:00:05.000Z", model: "gemini-3-pro-preview",
        thoughts: [{ subject: "Planning", description: "Look for the failure." }],
        content: "I found the issue.",
        toolCalls: [{
          id: "rf1", name: "read_file", status: "success",
          args: { absolute_path: "/repo/main.go" },
          result: [{ functionResponse: { response: { output: "package main" } } }]
        }],
        // output 20 visible + 5 reasoning, 10 cached. output_tokens must fold to 25.
        tokens: { input: 100, output: 20, thoughts: 5, cached: 10, tool: 0, total: 135 }
      }
    }
  ];

  const events = normalizeGeminiNativeRecords(records, { sourcePath: "/tmp/session-x.json", cwd: "/repo", completed: false, inferredComplete: false });

  assert.equal(events.every((event) => event.provider === "gemini"), true, "every event is attributed to gemini");
  assert.equal(events.every((event) => event.repo.cwd === "/repo"), true, "cwd resolved from projects.json flows onto every event");

  const start = events.find((event) => event.kind === "conversation.start");
  assert.ok(start, "a conversation.start is emitted from the session header");
  assert.equal(start.conversation.provider_session_id, "sess-g1");

  const userMessage = events.find((event) => event.kind === "message.user");
  assert.equal(userMessage.data.text, "Fix the login bug", "user content array is flattened to text");

  assert.equal(events.some((event) => event.kind === "message.assistant.internal"), false, "reasoning folds into the visible message, not a separate empty assistant block");

  const visible = events.find((event) => event.kind === "message.assistant.visible");
  assert.equal(visible.data.text, "I found the issue.", "string content is kept verbatim");
  assert.equal(visible.data.thinking, "Planning: Look for the failure.", "thoughts fold into the assistant message thinking, like the Claude normalizer");

  const toolCall = events.find((event) => event.kind === "tool.call");
  assert.equal(toolCall.data.tool_name, "read_file");
  assert.equal(toolCall.data.category, "read");
  assert.deepEqual(toolCall.data.target_paths, ["/repo/main.go"], "absolute_path is surfaced as a target path");

  const toolResult = events.find((event) => event.kind === "tool.result");
  assert.equal(toolResult.data.status, "success");
  assert.ok(toolResult.links.tool_call_id === "rf1", "result links back to its call id");

  const token = events.find((event) => event.kind === "token.usage");
  assert.equal(token.data.usage.input_tokens, 100);
  assert.equal(token.data.usage.output_tokens, 25, "reasoning tokens fold into output_tokens");
  assert.equal(token.data.usage.cache_read_input_tokens, 10, "cached maps to cache_read_input_tokens");
});

test("gemini reader flattens both the single-document and the jsonl session formats to one record shape", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "gemini-read-"));
  try {
    const single = path.join(home, "session-a.json");
    writeFileSync(single, JSON.stringify({
      sessionId: "sess-a", projectHash: "h", startTime: "2026-06-30T10:00:00.000Z", kind: "main",
      messages: [
        { type: "user", id: "u1", content: [{ text: "hi" }] },
        { type: "gemini", id: "g1", content: "hello", tokens: { input: 1, output: 1 } }
      ]
    }, null, 2));
    const fromSingle = await readGeminiNative(single);
    assert.equal(fromSingle.records[0].record.sessionId, "sess-a", "first record is the session header");
    assert.equal(fromSingle.records[0].record.type, undefined, "the header carries no message type");
    assert.deepEqual(fromSingle.records.slice(1).map((row) => row.record.type), ["user", "gemini"]);

    const jsonl = path.join(home, "session-b.jsonl");
    writeFileSync(jsonl, [
      JSON.stringify({ sessionId: "sess-b", projectHash: "h", startTime: "2026-06-30T10:00:00.000Z", kind: "main" }),
      JSON.stringify({ type: "user", id: "u1", content: [{ text: "hi" }] }),
      JSON.stringify({ $set: { lastUpdated: "2026-06-30T10:00:01.000Z" } }),
      JSON.stringify({ type: "gemini", id: "g1", content: "hello" })
    ].join("\n") + "\n");
    const fromJsonl = await readGeminiNative(jsonl);
    assert.equal(fromJsonl.records[0].record.sessionId, "sess-b", "jsonl header is the first record too");
    assert.equal(fromJsonl.records.filter((row) => row.record.type === "user").length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("gemini discovery resolves a hash-named project directory back to its repo via projects.json", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "gemini-home-"));
  const previousHome = process.env.GEMINI_HOME;
  process.env.GEMINI_HOME = home;
  try {
    const repoRoot = "/tmp/example-gemini-repo";
    const hashDir = createHash("sha256").update(repoRoot).digest("hex");
    writeFileSync(path.join(home, "projects.json"), JSON.stringify({ projects: { [repoRoot]: "example" } }));

    // Gemini may name the dir by the friendly basename or by sha256(cwd); cover the hash form.
    const chatsDir = path.join(home, "tmp", hashDir, "chats");
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(path.join(chatsDir, "session-2026-06-30T10-00-abcd1234.jsonl"),
      JSON.stringify({ sessionId: "sess-disc", projectHash: hashDir, startTime: "2026-06-30T10:00:00.000Z", kind: "main" }) + "\n" +
      JSON.stringify({ type: "user", id: "u1", timestamp: "2026-06-30T10:00:01.000Z", content: [{ text: "hi" }] }) + "\n");

    const all = await discoverGeminiNative();
    assert.equal(all.length, 1, "unscoped discovery finds the session");

    const scoped = await discoverGeminiNative(repoRoot);
    assert.equal(scoped.length, 1, "the hash directory is resolved to the repo and kept under repo scope");

    const elsewhere = await discoverGeminiNative("/tmp/some-other-repo");
    assert.equal(elsewhere.length, 0, "a different repo does not match this project directory");

    const map = await buildGeminiProjectMap(home);
    assert.equal(resolveGeminiCwd(hashDir, hashDir, map), repoRoot, "projectHash resolves to the working directory");
  } finally {
    if (previousHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
