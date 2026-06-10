import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageDataset } from "../dist/core/dataset.js";
import { eventFileForConversation } from "../dist/core/paths.js";
import { normalizeHookInput } from "../dist/hook-runner/normalize-hook-input.js";
import { normalizeClaudeNativeRecord, normalizeClaudeNativeRecords } from "../dist/providers/claude/native/normalize.js";
import { normalizeCodexNativeRecords } from "../dist/providers/codex/native/normalize.js";
import { archiveUsageTelemetry, ensureUsageIndex, loadUsageDatasetFromIndex, resolveConversationRef } from "../dist/sdk/indexStore.js";
import { inspectNativeLogFile, listNativeSchemas, nativeSchemaStatus } from "../dist/sdk/index.js";
import { installHooks, uninstallHooks } from "../dist/sdk/installHooks.js";

function context(provider = "codex") {
  return {
    provider,
    scope: "repo-local",
    repo: {
      inputPath: "/repo",
      root: "/repo",
      cwd: "/repo",
      branch: "main",
      headSha: "abc"
    },
    tracking: { enabled: true, source: "global-allowlist" },
    redaction: {
      contentMode: "metadata-with-excerpts",
      redactSecrets: true,
      maxStringBytes: 4000,
      maxToolResponseBytes: 20000
    },
    usageVersion: "test"
  };
}

function hook(event, extra = {}) {
  return {
    session_id: "s1",
    transcript_path: null,
    cwd: "/repo",
    hook_event_name: event,
    model: "model",
    ...extra
  };
}

test("Stop is a turn end and SessionEnd is a conversation end", () => {
  const stop = normalizeHookInput(hook("Stop", {
    turn_id: "t1",
    last_assistant_message: "done"
  }), context());
  assert.deepEqual(stop.map((event) => event.kind), ["message.assistant.visible", "turn.end"]);
  assert.equal(stop.some((event) => event.kind === "conversation.end"), false);
  assert.equal(stop.find((event) => event.kind === "turn.end")?.data.status, "completed");

  const end = normalizeHookInput(hook("SessionEnd"), context());
  assert.deepEqual(end.map((event) => event.kind), ["conversation.end"]);
});

test("UserPromptSubmit starts a turn and exact user message", () => {
  const events = normalizeHookInput(hook("UserPromptSubmit", {
    turn_id: "t1",
    prompt: "Implement the plan"
  }), context());
  assert.deepEqual(events.map((event) => event.kind), ["turn.start", "message.user"]);
  assert.equal(events[1].data.text, "Implement the plan");
  assert.equal(events[1].turn.id, "t1");
});

test("hook normalizer preserves compact summary and tool duration", () => {
  const compact = normalizeHookInput(hook("PostCompact", {
    turn_id: "t1",
    trigger: "auto",
    compact_summary: "summary"
  }), context());
  assert.equal(compact[0].data.compact_summary, "summary");

  const result = normalizeHookInput(hook("PostToolUse", {
    turn_id: "t1",
    tool_name: "Bash",
    tool_use_id: "tool1",
    tool_input: { command: "npm test" },
    tool_response: { exit_code: 0, output: "ok" },
    duration_ms: 123
  }), context());
  assert.equal(result[0].data.duration_ms, 123);
});

test("hook normalizer emits explicit tool errors and provider usage", () => {
  const failed = normalizeHookInput(hook("PostToolUseFailure", {
    turn_id: "t1",
    tool_name: "Bash",
    tool_use_id: "tool1",
    tool_input: { command: "npm test" },
    error: { message: "failed" }
  }), context());
  assert.equal(failed[0].kind, "tool.error");
  assert.equal(failed[0].data.status, "error");

  const result = normalizeHookInput(hook("PostToolUse", {
    turn_id: "t1",
    tool_name: "Agent",
    tool_use_id: "tool2",
    tool_response: { usage: { input_tokens: 10, output_tokens: 3 } }
  }), context("claude"));
  assert.deepEqual(result.map((event) => event.kind), ["tool.result", "token.usage"]);
  assert.equal(result[1].data.usageConfidence, "provider-reported");
});

test("Claude native import emits visible message and token usage event", () => {
  const events = normalizeClaudeNativeRecord({
    type: "assistant",
    sessionId: "native-session",
    timestamp: "2026-06-08T12:00:00.000Z",
    message: {
      id: "msg1",
      model: "sonnet",
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 10, output_tokens: 4 }
    }
  }, "/tmp/native.jsonl", 1);
  assert.deepEqual(events.map((event) => event.kind), ["message.assistant.visible", "token.usage"]);
  assert.equal(events[1].data.usageConfidence, "provider-reported");
});

test("native schema registry lists provider version ranges", () => {
  const codex = listNativeSchemas("codex");
  const claude = listNativeSchemas("claude");
  assert.equal(codex[0].id, "codex.rollout.v1");
  assert.deepEqual(codex[0].versionRanges, [{ min: "0.130.0", max: "0.137.0" }]);
  assert.equal(claude[0].id, "claude.conversation.v1");
  assert.deepEqual(claude[0].versionRanges, [{ min: "2.1.145", max: "2.1.150" }]);
});

test("native log inspection is permissive and extracts Claude usage shape hints", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-inspect-"));
  const file = path.join(dir, "claude.jsonl");
  await writeFile(file, [
    JSON.stringify({
      type: "assistant",
      sessionId: "c1",
      version: "2.1.150",
      message: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 10, output_tokens: 4 }
      }
    }),
    "{bad json"
  ].join("\n"), "utf8");

  const inspection = await inspectNativeLogFile(file);
  assert.equal(inspection.provider, "claude");
  assert.equal(inspection.logKind, "claude.conversation");
  assert.equal(inspection.recordCount, 1);
  assert.equal(inspection.parseErrors.length, 1);
  assert.deepEqual(inspection.producerHints.versions, ["2.1.150"]);
  assert.deepEqual(inspection.producerHints.models, ["claude-sonnet-4-6"]);
  assert.equal(inspection.variants[0].key, "assistant:assistant:message");
});

test("native schema status tags Codex versions to known ranges", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-status-"));
  const codexHome = path.join(dir, "codex-home");
  const previousCodexHome = process.env.CODEX_HOME;
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  const dayDir = path.join(codexHome, "sessions", "2026", "06", "08");
  await mkdir(dayDir, { recursive: true });
  await writeFile(path.join(dayDir, "rollout-known.jsonl"), codexRollout({ repo, sessionId: "s1", version: "0.137.0" }), "utf8");
  await writeFile(path.join(dayDir, "rollout-newer.jsonl"), codexRollout({ repo, sessionId: "s2", version: "0.139.0" }), "utf8");

  try {
    process.env.CODEX_HOME = codexHome;
    const [status] = await nativeSchemaStatus({ repo, providers: ["codex"] });
    assert.equal(status.provider, "codex");
    assert.equal(status.files, 2);
    assert.deepEqual(status.observedVersions, ["0.137.0", "0.139.0"]);
    assert.equal(status.compatibility, "unknown-newer");
    assert.ok(status.versions.some((version) => version.version === "0.137.0" && version.status === "compatible"));
    assert.ok(status.versions.some((version) => version.version === "0.139.0" && version.status === "unknown-newer"));
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("usage index defaults to completed Codex native transcripts instead of hook JSONL", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-codex-index-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const previousCodexHome = process.env.CODEX_HOME;
  const codexHome = path.join(dir, "codex-home");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  await writeJsonl(eventFileForConversation(repo, "codex", "codex:hook"), sessionEvents({ sessionId: "hook", prompt: "hook prompt", at: "2026-06-09T08:00:00.000Z" }));
  const nativePath = path.join(codexHome, "sessions", "2026", "06", "09", "rollout-2026-06-09T08-00-00-native.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo, sessionId: "native", prompt: "native prompt", complete: true }));

  try {
    process.env.CODEX_HOME = codexHome;
    const index = await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(index.sourceFiles, [nativePath]);
    const conversationId = "codex:native";
    const dataset = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["native prompt", "native done"]);
    assert.equal(dataset.tools.calls({ conversationId }).data.length, 1);
    assert.equal(dataset.tokens.byConversation({ conversationId }).data.length, 1);
    assert.equal(dataset.tokens.byConversation({ conversationId }).data[0].usage.total_tokens, 30);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("Codex native import emits per-model-call usage and tool result token metadata", () => {
  const sourcePath = "/tmp/codex-two-snapshots.jsonl";
  const records = codexNativeTwoSnapshotSession({ repo: "/repo", sessionId: "codex-two-snapshots" }).map((record, index) => ({ line: index + 1, record }));
  const events = normalizeCodexNativeRecords(records, { sourcePath, completed: true, inferredComplete: false });
  const tokenEvents = events.filter((event) => event.kind === "token.usage");
  const toolResult = events.find((event) => event.kind === "tool.result");

  assert.equal(tokenEvents.length, 2);
  assert.deepEqual(tokenEvents.map((event) => event.data.usageKind), ["model-call", "model-call"]);
  assert.deepEqual(tokenEvents.map((event) => event.data.usage.input_tokens), [100, 130]);
  assert.deepEqual(tokenEvents.map((event) => event.data.snapshotIndex), [1, 2]);
  assert.equal(tokenEvents[1].data.cumulativeUsage.input_tokens, 230);
  assert.equal(toolResult.data.tool_name, "exec_command");
  assert.equal(toolResult.data.category, "command");
  assert.equal(toolResult.data.original_token_count, 12);
  assert.equal(toolResult.data.output_chars > 0, true);
  assert.equal(toolResult.data.estimated_output_tokens > 0, true);
});

test("Codex per-tool attribution uses the following model-call input delta", () => {
  const sourcePath = "/tmp/codex-tool-attribution.jsonl";
  const records = codexNativeTwoSnapshotSession({ repo: "/repo", sessionId: "codex-tool-attribution" }).map((record, index) => ({ line: index + 1, record }));
  const events = normalizeCodexNativeRecords(records, { sourcePath, completed: true, inferredComplete: false });
  const dataset = new UsageDataset(events);
  const conversationId = "codex:codex-tool-attribution";

  const [row] = dataset.tokens.perToolCall({ conversationId }).data;
  assert.equal(row.toolName, "exec_command");
  assert.equal(row.result.originalTokenCount, 12);
  assert.equal(row.nextModelCall.inputTokens, 130);
  assert.equal(row.previousModelInputTokens, 100);
  assert.equal(row.nextInputDelta, 30);
  assert.equal(row.allocatedInputTokens, 30);
  assert.equal(row.allocationMethod, "single_tool_result");

  const report = dataset.conversations.report({ conversationId }).data;
  const assistantWithTool = report.messages.find((message) => message.role === "assistant" && message.toolCalls.length);
  assert.equal(assistantWithTool.toolCalls[0].tokens.allocatedInput, 30);
  assert.equal(assistantWithTool.toolCalls[0].tokens.nextInputTotal, 130);
  assert.equal(assistantWithTool.toolCalls[0].tokens.resultEstimatedTokens, row.result.estimatedOutputTokens);
  assert.equal(assistantWithTool.toolCalls[0].tokens.allocatedOutput, 9);
});

test("per-tool attribution splits one following input delta across multiple results by result size", () => {
  const at = "2026-06-09T08:00:00.000Z";
  const conversationId = "codex:split";
  const events = [
    usageEvent({ sessionId: "split", id: "start", kind: "conversation.start", at, data: { source: "test" }, actor: { role: "system" } }),
    usageEvent({ sessionId: "split", id: "turn", kind: "turn.start", at, data: { status: "started" }, turn: { id: "t1" }, actor: { role: "user" } }),
    usageEvent({ sessionId: "split", id: "assistant", kind: "message.assistant.visible", at, data: { text: "reading", text_preview: "reading" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } }),
    usageEvent({ sessionId: "split", id: "tool-small", kind: "tool.call", at, data: { tool_name: "Read", category: "read", target_paths: ["small.txt"] }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" }, links: { tool_call_id: "small" } }),
    usageEvent({ sessionId: "split", id: "tool-large", kind: "tool.call", at, data: { tool_name: "Read", category: "read", target_paths: ["large.txt"] }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" }, links: { tool_call_id: "large" } }),
    usageEvent({ sessionId: "split", id: "result-small", kind: "tool.result", at, data: { tool_name: "Read", category: "read", output: "small", status: "success", estimated_output_tokens: 10, output_chars: 5 }, turn: { id: "t1" }, actor: { role: "tool" }, links: { tool_call_id: "small" } }),
    usageEvent({ sessionId: "split", id: "result-large", kind: "tool.result", at, data: { tool_name: "Read", category: "read", output: "large", status: "success", estimated_output_tokens: 30, output_chars: 15 }, turn: { id: "t1" }, actor: { role: "tool" }, links: { tool_call_id: "large" } }),
    usageEvent({ sessionId: "split", id: "before", kind: "token.usage", at, data: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, usageConfidence: "provider-reported" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } }),
    usageEvent({ sessionId: "split", id: "answer", kind: "message.assistant.visible", at, data: { text: "done", text_preview: "done" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } }),
    usageEvent({ sessionId: "split", id: "after", kind: "token.usage", at, data: { usage: { input_tokens: 180, output_tokens: 5, total_tokens: 185 }, usageConfidence: "provider-reported" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } })
  ];

  const rows = new UsageDataset(events).tokens.perToolCall({ conversationId }).data;
  assert.deepEqual(rows.map((row) => row.toolCallId), ["large", "small"]);
  assert.deepEqual(rows.map((row) => row.allocatedInputTokens), [60, 20]);
  assert.equal(rows.every((row) => row.nextInputDelta === 80), true);
  assert.equal(rows.every((row) => row.allocationMethod === "proportional_tool_result_tokens"), true);
});

test("usage index skips active Codex native transcripts until the quiet window", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-codex-quiet-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const previousCodexHome = process.env.CODEX_HOME;
  const codexHome = path.join(dir, "codex-home");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  const nativePath = path.join(codexHome, "sessions", "2026", "06", "09", "rollout-2026-06-09T08-00-00-quiet.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo, sessionId: "quiet", prompt: "quiet prompt", complete: false }));
  const mtime = new Date("2026-06-09T08:00:10.000Z");
  await utimes(nativePath, mtime, mtime);

  try {
    process.env.CODEX_HOME = codexHome;
    let index = await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:10:00.000Z"), force: true });
    assert.equal(index.sourceFiles.length, 0);

    index = await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z"), force: true });
    assert.deepEqual(index.sourceFiles, [nativePath]);
    const conversationId = "codex:quiet";
    const dataset = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:30:00.000Z") });
    assert.equal(dataset.turns.list({ includeActive: true }).data[0].status, "completed");

    await writeJsonl(nativePath, [
      ...codexNativeSession({ repo, sessionId: "quiet", prompt: "quiet prompt", complete: false }),
      { timestamp: "2026-06-09T08:31:00.000Z", type: "event_msg", payload: { type: "user_message", message: "new active prompt" } }
    ]);
    const activeMtime = new Date("2026-06-09T08:31:00.000Z");
    await utimes(nativePath, activeMtime, activeMtime);
    await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:35:00.000Z") });
    const preserved = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:35:00.000Z") });
    assert.deepEqual(preserved.messages.visible({ conversationId }).data.map((row) => row.text), ["quiet prompt", "native done"]);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("usage index reads Claude native visible messages, tools, and usage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-claude-index-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const previousClaudeHome = process.env.CLAUDE_HOME;
  const claudeHome = path.join(dir, "claude-home");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  const nativePath = path.join(claudeHome, "projects", claudeProjectKey(repo), "claude-session.jsonl");
  await writeJsonl(nativePath, claudeNativeSession({ repo, sessionId: "claude-session" }));
  const mtime = new Date("2026-06-09T08:00:20.000Z");
  await utimes(nativePath, mtime, mtime);

  try {
    process.env.CLAUDE_HOME = claudeHome;
    const index = await ensureUsageIndex({ repo, providers: ["claude"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(index.sourceFiles, [nativePath]);
    const conversationId = "claude:claude-session";
    const dataset = await loadUsageDatasetFromIndex({ repo, providers: ["claude"], conversationId, now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["run test", "running", "done"]);
    assert.equal(dataset.tools.calls({ conversationId }).data[0].toolName, "Bash");
    assert.equal(dataset.tools.calls({ conversationId }).data[0].result.status, "success");
    assert.deepEqual(dataset.tokens.byConversation({ conversationId }).data.map((row) => row.usage.output_tokens), [2, 4]);
  } finally {
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
  }
});

test("conversation report nests Claude assistant tokens, tool calls, and allocated tool token attribution", () => {
  const sourcePath = "/tmp/claude-two-tools.jsonl";
  const records = claudeNativeTwoToolSession().map((record, index) => ({ line: index + 1, record }));
  const events = normalizeClaudeNativeRecords(records, { sourcePath, inferredComplete: true });
  const dataset = new UsageDataset(events);
  const conversationId = "claude:claude-two-tools";
  const report = dataset.conversations.report({ conversationId }).data;

  assert.equal(report.schema, "usage.conversation.v1");
  assert.deepEqual(report.messages.map((message) => message.role), ["user", "assistant", "assistant"]);
  const assistantMessages = report.messages.filter((message) => message.role === "assistant");
  assert.equal(assistantMessages[0].id, "msg_tools");
  assert.equal(assistantMessages[0].tokens.confidence, "provider-reported");
  assert.equal(assistantMessages[0].tokens.output, 90);
  assert.equal(assistantMessages[0].tokens.cacheRead, 200);
  assert.equal(assistantMessages[0].toolCalls.length, 2);
  assert.deepEqual(assistantMessages[0].toolCalls.map((tool) => tool.id), ["tool_read", "tool_grep"]);
  assert.deepEqual(assistantMessages[0].toolCalls.map((tool) => tool.result.status), ["success", "success"]);
  assert.equal(assistantMessages[0].toolCalls.every((tool) => tool.tokens.exact === false), true);
  assert.equal(assistantMessages[0].toolCalls.every((tool) => tool.tokens.confidence === "allocated"), true);
  assert.equal(assistantMessages[0].toolCalls.every((tool) => tool.tokens.allocationMethod === "proportional_tool_result_tokens"), true);
  assert.equal(assistantMessages[0].toolCalls.every((tool) => tool.tokens.sourceAssistantMessageId === "msg_tools"), true);
  assert.equal(sum(assistantMessages[0].toolCalls.map((tool) => tool.tokens.allocatedOutput)), 90);
  assert.equal(sum(assistantMessages[0].toolCalls.map((tool) => tool.tokens.allocatedInput)), 100);
  assert.equal(assistantMessages[0].toolCalls.every((tool) => tool.tokens.nextInputDelta === 100), true);
  assert.equal(assistantMessages[1].tokens.output, 12);
  assert.equal(report.totals.toolCalls, 2);
  assert.equal(report.totals.tokens.output, 102);
});

test("dataset derives stable synthetic turns from hook events without turn_id", () => {
  const events = [
    ...normalizeHookInput(hook("UserPromptSubmit", { prompt: "first" }), context()),
    ...normalizeHookInput(hook("Stop", { last_assistant_message: "done" }), context())
  ];
  const dataset = new UsageDataset(events);
  const turns = dataset.turns.list({ includeActive: true }).data;
  assert.equal(turns.length, 1);
  assert.equal(turns[0].sourceKey, "codex:s1:turn-000001");
  assert.equal(turns[0].status, "completed");
  assert.equal(dataset.messages.visible({ conversationId: "codex:s1", turnId: turns[0].turnId }).data.length, 2);
});

test("hook install merges and uninstall removes only Tangent commands", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-hooks-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const hooksPath = path.join(dir, ".codex", "hooks.json");
  await mkdir(path.dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            { type: "command", command: "echo keep-me" }
          ]
        }
      ]
    }
  }), "utf8");

  await installHooks({ provider: "codex", scope: "repo-local", repo: dir });
  const installed = JSON.parse(await readFile(hooksPath, "utf8"));
  const commands = installed.hooks.Stop.flatMap((group) => group.hooks.map((entry) => entry.command));
  assert.equal(commands.includes("echo keep-me"), true);
  assert.equal(commands.some((command) => command.includes("tangent usage hook record --provider codex")), true);

  await uninstallHooks({ provider: "codex", scope: "repo-local", repo: dir });
  const uninstalled = JSON.parse(await readFile(hooksPath, "utf8"));
  const remaining = uninstalled.hooks.Stop.flatMap((group) => group.hooks.map((entry) => entry.command));
  assert.deepEqual(remaining, ["echo keep-me"]);
});

test("Claude hook install includes assistant display capture", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-claude-hooks-"));
  process.env.USAGE_HOME = path.join(dir, "home");

  await installHooks({ provider: "claude", scope: "repo-local", repo: dir });
  const hooksPath = path.join(dir, ".claude", "settings.local.json");
  const installed = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.ok(installed.hooks.MessageDisplay);
  assert.ok(installed.hooks.PostToolUseFailure);
  assert.ok(installed.hooks.InstructionsLoaded);
});

test("usage package does not expose the old command binary", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@tangent/usage");
  assert.deepEqual(Object.keys(manifest.bin), ["usage"]);
});

test("usage index incrementally ingests changed files and loads a single conversation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-index-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const conversationId = "codex:s1";
  const file = eventFileForConversation(dir, "codex", conversationId);
  await writeJsonl(file, sessionEvents({ sessionId: "s1", prompt: "older task", at: "2026-06-07T10:00:00.000Z" }));

  const first = await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  assert.equal(first.indexed, 1);
  assert.equal(first.skipped, 0);

  const second = await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  assert.equal(second.indexed, 0);
  assert.equal(second.skipped, 1);

  let dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId, sources: ["usage-jsonl"] });
  assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["older task", "done"]);

  await writeJsonl(file, [
    ...sessionEvents({ sessionId: "s1", prompt: "older task", at: "2026-06-07T10:00:00.000Z" }),
    usageEvent({ sessionId: "s1", id: "s1-extra", kind: "message.assistant.visible", at: "2026-06-07T10:02:00.000Z", data: { text: "extra", text_preview: "extra" }, actor: { role: "assistant", model: "model" } })
  ]);
  const third = await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  assert.equal(third.indexed, 1);

  dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId, sources: ["usage-jsonl"] });
  assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["older task", "done", "extra"]);
});

test("usage index resolves latest sessions from indexed conversations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-latest-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  await writeJsonl(eventFileForConversation(dir, "codex", "codex:s1"), sessionEvents({ sessionId: "s1", prompt: "older", at: "2026-06-07T10:00:00.000Z" }));
  await writeJsonl(eventFileForConversation(dir, "codex", "codex:s2"), sessionEvents({ sessionId: "s2", prompt: "newer", at: "2026-06-08T10:00:00.000Z" }));

  await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  const latest = await resolveConversationRef({ repo: dir, ref: "latest", sources: ["usage-jsonl"] });
  assert.equal(latest.conversationId, "codex:s2");
  assert.equal(latest.shortId, "codex:s2");
});

test("usage archive only moves indexed unchanged files before the cutoff", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-archive-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const conversationId = "codex:s1";
  const file = eventFileForConversation(dir, "codex", conversationId);
  await writeJsonl(file, sessionEvents({ sessionId: "s1", prompt: "archive me", at: "2026-06-07T10:00:00.000Z" }));
  await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });

  const dryRun = await archiveUsageTelemetry({ repo: dir, providers: ["codex"], before: new Date("2026-06-08T00:00:00.000Z"), dryRun: true });
  assert.equal(dryRun.archived.length, 1);
  assert.equal((await stat(file)).isFile(), true);

  const archived = await archiveUsageTelemetry({ repo: dir, providers: ["codex"], before: new Date("2026-06-08T00:00:00.000Z") });
  assert.equal(archived.archived.length, 1);
  await assert.rejects(stat(file));
  assert.equal((await stat(archived.archived[0].archivePath)).isFile(), true);
});

test("usage index removes deleted source files from indexed reads", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-stale-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const conversationId = "codex:s1";
  const file = eventFileForConversation(dir, "codex", conversationId);
  await writeJsonl(file, sessionEvents({ sessionId: "s1", prompt: "delete me", at: "2026-06-07T10:00:00.000Z" }));
  await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  await rm(file);

  const result = await ensureUsageIndex({ repo: dir, providers: ["codex"], sources: ["usage-jsonl"] });
  assert.equal(result.removed, 1);
  const dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId, sources: ["usage-jsonl"] });
  assert.equal(dataset.events.length, 0);
});

async function writeJsonl(filePath, events) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

function codexNativeSession({ repo, sessionId, prompt, complete }) {
  const turnId = `${sessionId}-turn`;
  return [
    {
      timestamp: "2026-06-09T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-06-09T08:00:00.000Z",
        cwd: repo,
        originator: "codex-tui",
        cli_version: "0.137.0",
        source: "cli",
        git: { branch: "main", commit_hash: "abc" }
      }
    },
    { timestamp: "2026-06-09T08:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { timestamp: "2026-06-09T08:00:02.000Z", type: "turn_context", payload: { turn_id: turnId, cwd: repo, model: "gpt-5.5" } },
    { timestamp: "2026-06-09T08:00:03.000Z", type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: "2026-06-09T08:00:04.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call1", arguments: JSON.stringify({ cmd: "npm test", workdir: repo }) } },
    { timestamp: "2026-06-09T08:00:05.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call1", output: "Process exited with code 0\nok" } },
    { timestamp: "2026-06-09T08:00:06.000Z", type: "response_item", payload: { type: "reasoning", summary: [], encrypted_content: "secret" } },
    { timestamp: "2026-06-09T08:00:07.000Z", type: "event_msg", payload: { type: "agent_message", message: "native done", phase: "final_answer" } },
    {
      timestamp: "2026-06-09T08:00:08.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 30 },
          last_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 30 }
        }
      }
    },
    ...(complete ? [{ timestamp: "2026-06-09T08:00:09.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 9000 } }] : [])
  ];
}

function codexNativeTwoSnapshotSession({ repo, sessionId }) {
  const turnId = `${sessionId}-turn`;
  return [
    {
      timestamp: "2026-06-09T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-06-09T08:00:00.000Z",
        cwd: repo,
        originator: "codex-tui",
        cli_version: "0.138.0",
        source: "cli",
        git: { branch: "main", commit_hash: "abc" }
      }
    },
    { timestamp: "2026-06-09T08:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { timestamp: "2026-06-09T08:00:02.000Z", type: "turn_context", payload: { turn_id: turnId, cwd: repo, model: "gpt-5.4-mini" } },
    { timestamp: "2026-06-09T08:00:03.000Z", type: "event_msg", payload: { type: "user_message", message: "cat small.txt" } },
    { timestamp: "2026-06-09T08:00:04.000Z", type: "event_msg", payload: { type: "agent_message", message: "I will read it.", phase: "commentary" } },
    { timestamp: "2026-06-09T08:00:05.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call1", arguments: JSON.stringify({ cmd: "cat small.txt", workdir: repo }) } },
    {
      timestamp: "2026-06-09T08:00:06.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call1",
        output: "Chunk ID: abc\nProcess exited with code 0\nOriginal token count: 12\nOutput:\nalpha beta gamma\n"
      }
    },
    {
      timestamp: "2026-06-09T08:00:07.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 9, reasoning_output_tokens: 1, total_tokens: 109 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 9, reasoning_output_tokens: 1, total_tokens: 109 }
        }
      }
    },
    {
      timestamp: "2026-06-09T08:00:08.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 9, reasoning_output_tokens: 1, total_tokens: 109 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 9, reasoning_output_tokens: 1, total_tokens: 109 }
        }
      }
    },
    { timestamp: "2026-06-09T08:00:09.000Z", type: "event_msg", payload: { type: "agent_message", message: "ok", phase: "final_answer" } },
    {
      timestamp: "2026-06-09T08:00:10.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 230, cached_input_tokens: 120, output_tokens: 14, reasoning_output_tokens: 1, total_tokens: 244 },
          last_token_usage: { input_tokens: 130, cached_input_tokens: 80, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 135 }
        }
      }
    },
    { timestamp: "2026-06-09T08:00:11.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 11000 } }
  ];
}

function claudeNativeSession({ repo, sessionId }) {
  return [
    {
      type: "user",
      uuid: "user1",
      promptId: "turn1",
      sessionId,
      timestamp: "2026-06-09T08:00:00.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: { role: "user", content: "run test" }
    },
    {
      type: "assistant",
      uuid: "assistant1",
      sessionId,
      timestamp: "2026-06-09T08:00:05.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: {
        id: "msg1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "running" },
          { type: "tool_use", id: "tool1", name: "Bash", input: { command: "npm test" } }
        ],
        usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 2 }
      }
    },
    {
      type: "user",
      uuid: "tool-result1",
      promptId: "turn1",
      sessionId,
      timestamp: "2026-06-09T08:00:10.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool1", content: "ok" }] }
    },
    {
      type: "assistant",
      uuid: "assistant2",
      sessionId,
      timestamp: "2026-06-09T08:00:15.000Z",
      cwd: repo,
      gitBranch: "main",
      version: "2.1.168",
      message: {
        id: "msg2",
        type: "message",
        role: "assistant",
        model: "claude-sonnet",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 12, cache_read_input_tokens: 6, output_tokens: 4 }
      }
    }
  ];
}

function claudeNativeTwoToolSession() {
  const sessionId = "claude-two-tools";
  return [
    {
      type: "user",
      uuid: "user-two-tools",
      promptId: "turn-tools",
      sessionId,
      timestamp: "2026-06-09T09:14:00.000Z",
      cwd: "/repo",
      gitBranch: "main",
      version: "2.1.168",
      message: { role: "user", content: "Can you inspect the parser?" }
    },
    {
      type: "assistant",
      uuid: "assistant-tools",
      sessionId,
      timestamp: "2026-06-09T09:15:00.000Z",
      cwd: "/repo",
      gitBranch: "main",
      version: "2.1.168",
      message: {
        id: "msg_tools",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I'll inspect the parser." },
          { type: "tool_use", id: "tool_read", name: "Read", input: { file_path: "packages/usage/src/core/dataset.ts" } },
          { type: "tool_use", id: "tool_grep", name: "Grep", input: { pattern: "TopicRollup", path: "packages/daily/src" } }
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 90,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 30
        }
      }
    },
    {
      type: "user",
      uuid: "tool-results",
      promptId: "turn-tools",
      sessionId,
      timestamp: "2026-06-09T09:16:00.000Z",
      cwd: "/repo",
      gitBranch: "main",
      version: "2.1.168",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool_read", content: "dataset source" },
          { type: "tool_result", tool_use_id: "tool_grep", content: "rollup source" }
        ]
      }
    },
    {
      type: "assistant",
      uuid: "assistant-final",
      sessionId,
      timestamp: "2026-06-09T09:18:00.000Z",
      cwd: "/repo",
      gitBranch: "main",
      version: "2.1.168",
      message: {
        id: "msg_final",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I found the parser path." }],
        usage: { input_tokens: 1100, output_tokens: 12, cache_read_input_tokens: 210 }
      }
    }
  ];
}

function claudeProjectKey(repoRoot) {
  return repoRoot.replace(/\//g, "-").replace(/^-/, "-");
}

function codexRollout({ repo, sessionId, version }) {
  return [
    {
      timestamp: "2026-06-08T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-06-08T00:00:00.000Z",
        cwd: repo,
        originator: "codex-tui",
        cli_version: version,
        source: "cli",
        model_provider: "openai",
        base_instructions: { text: "base" }
      }
    },
    {
      timestamp: "2026-06-08T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 2,
            reasoning_output_tokens: 0,
            total_tokens: 3
          }
        },
        rate_limits: null
      }
    }
  ].map((record) => JSON.stringify(record)).join("\n");
}

function sessionEvents({ sessionId, prompt, at }) {
  const end = new Date(new Date(at).getTime() + 60000).toISOString();
  return [
    usageEvent({ sessionId, id: `${sessionId}-start`, kind: "conversation.start", at, data: { source: "test" }, actor: { role: "hook" } }),
    usageEvent({ sessionId, id: `${sessionId}-turn`, kind: "turn.start", at, data: { status: "started" }, turn: { id: "t1" }, actor: { role: "user" } }),
    usageEvent({ sessionId, id: `${sessionId}-user`, kind: "message.user", at, data: { text: prompt, text_preview: prompt }, turn: { id: "t1" }, actor: { role: "user" } }),
    usageEvent({ sessionId, id: `${sessionId}-assistant`, kind: "message.assistant.visible", at: end, data: { text: "done", text_preview: "done" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } }),
    usageEvent({ sessionId, id: `${sessionId}-end`, kind: "turn.end", at: end, data: { status: "completed" }, turn: { id: "t1" }, actor: { role: "assistant" } })
  ];
}

function usageEvent({ sessionId, id, kind, at, data, turn, actor, links }) {
  return {
    schema: "usage.event.v2",
    event_id: `evt_${id}`,
    kind,
    recorded_at: at,
    observed_at: at,
    provider: "codex",
    capture: {
      source: "hook",
      scope: "repo-local",
      usage_version: "test",
      content_mode: "metadata-with-excerpts",
      confidence: "exact"
    },
    repo: {
      root: "/repo",
      cwd: "/repo",
      tracking: { enabled: true, source: "global-allowlist" }
    },
    conversation: {
      id: `codex:${sessionId}`,
      provider_session_id: sessionId
    },
    turn,
    actor,
    links,
    data
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
