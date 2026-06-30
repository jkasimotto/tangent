import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageDataset } from "@tangent/usage-core/core/dataset";
import { createUsageClient, eventsToProjections } from "../dist/core/index.js";
import { eventFileForConversation } from "@tangent/usage-core/core/paths";
import { normalizeClaudeNativeRecord, normalizeClaudeNativeRecords } from "@tangent/usage-providers/providers/claude/native/normalize";
import { normalizeCodexNativeRecords } from "@tangent/usage-providers/providers/codex/native/normalize";
import { providerCapabilities } from "../dist/providers/index.js";
import { archiveUsageTelemetry, ensureUsageIndex, loadUsageDatasetFromIndex, pruneUsageIndex, resolveConversationRef } from "../dist/sdk/index.js";
import { inspectNativeLogFile, listNativeSchemas, nativeSchemaStatus } from "../dist/sdk/index.js";

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

test("usage all scope indexes Codex native transcripts across repos", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-codex-global-"));
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.USAGE_HOME = path.join(dir, "home");
  const codexHome = path.join(dir, "codex-home");
  const repoA = path.join(dir, "repo-a");
  const repoB = path.join(dir, "repo-b");
  await mkdir(repoA, { recursive: true });
  await mkdir(repoB, { recursive: true });
  const nativePathA = path.join(codexHome, "sessions", "2026", "06", "09", "rollout-2026-06-09T08-00-00-repo-a.jsonl");
  const nativePathB = path.join(codexHome, "sessions", "2026", "06", "09", "rollout-2026-06-09T08-00-00-repo-b.jsonl");
  await writeJsonl(nativePathA, codexNativeSession({ repo: repoA, sessionId: "repo-a", prompt: "repo a prompt", complete: true }));
  await writeJsonl(nativePathB, codexNativeSession({ repo: repoB, sessionId: "repo-b", prompt: "repo b prompt", complete: true }));

  try {
    process.env.CODEX_HOME = codexHome;
    const globalIndex = await ensureUsageIndex({ repo: repoA, scope: "all", providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.equal(globalIndex.repoRoot, "all-local-sessions");
    assert.deepEqual([...globalIndex.sourceFiles].sort(), [nativePathA, nativePathB].sort());

    const globalDataset = await loadUsageDatasetFromIndex({ repo: repoA, scope: "all", providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(globalDataset.messages.list({ role: "user" }).data.map((row) => row.text).sort(), ["repo a prompt", "repo b prompt"]);

    const repoDataset = await loadUsageDatasetFromIndex({ repo: repoA, providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(repoDataset.messages.list({ role: "user" }).data.map((row) => row.text), ["repo a prompt"]);
  } finally {
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("Codex native import emits per-model-call usage and tool result size metadata", () => {
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
  assert.equal(toolResult.data.output_chars > 0, true);
  assert.equal(toolResult.data.output_bytes > 0, true);
  assert.equal("original_token_count" in toolResult.data, false);
  assert.equal("estimated_output_tokens" in toolResult.data, false);
  assert.equal("output_token_source" in toolResult.data, false);
});

test("Codex native token snapshots attach to assistant messages in projection order", () => {
  const sourcePath = "/tmp/codex-two-snapshots.jsonl";
  const records = codexNativeTwoSnapshotSession({ repo: "/repo", sessionId: "codex-two-snapshots" }).map((record, index) => ({ line: index + 1, record }));
  const projections = eventsToProjections(normalizeCodexNativeRecords(records, { sourcePath, completed: true, inferredComplete: false }));
  const assistantMessages = projections.messages.filter((message) => message.role === "assistant");

  assert.deepEqual(assistantMessages.map((message) => message.textPreview), ["I will read it.", "ok"]);
  assert.deepEqual(assistantMessages.map((message) => message.tokenUsage?.input), [100, 130]);
  assert.deepEqual(assistantMessages.map((message) => message.tokenUsage?.cacheRead), [40, 80]);
  assert.deepEqual(assistantMessages.map((message) => message.tokenUsage?.output), [9, 5]);
  assert.deepEqual(assistantMessages.map((message) => message.tokenUsage?.total), [109, 135]);
});

test("usage index marks incomplete Codex native transcripts complete only after the quiet window", async () => {
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
    const conversationId = "codex:quiet";
    // Active conversations are indexed immediately; within the quiet window the turn reads as not-yet-complete.
    let index = await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:10:00.000Z"), force: true });
    assert.deepEqual(index.sourceFiles, [nativePath]);
    let dataset = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:10:00.000Z") });
    assert.notEqual(dataset.turns.list().data[0].status, "completed");

    // Once the quiet window passes with no further activity, the transcript reads as completed.
    index = await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:30:00.000Z"), force: true });
    assert.deepEqual(index.sourceFiles, [nativePath]);
    dataset = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:30:00.000Z") });
    assert.equal(dataset.turns.list().data[0].status, "completed");

    await writeJsonl(nativePath, [
      ...codexNativeSession({ repo, sessionId: "quiet", prompt: "quiet prompt", complete: false }),
      { timestamp: "2026-06-09T08:31:00.000Z", type: "event_msg", payload: { type: "user_message", message: "new incomplete prompt" } }
    ]);
    const incompleteMtime = new Date("2026-06-09T08:31:00.000Z");
    await utimes(nativePath, incompleteMtime, incompleteMtime);
    await ensureUsageIndex({ repo, providers: ["codex"], now: new Date("2026-06-09T08:35:00.000Z") });
    // New activity is reflected immediately, so the in-flight prompt is visible even inside its quiet window.
    const reindexed = await loadUsageDatasetFromIndex({ repo, providers: ["codex"], conversationId, now: new Date("2026-06-09T08:35:00.000Z") });
    assert.deepEqual(reindexed.messages.visible({ conversationId }).data.map((row) => row.text), ["quiet prompt", "native done", "new incomplete prompt"]);
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

test("usage all scope indexes Claude native transcripts across project directories", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-native-claude-global-"));
  const previousUsageHome = process.env.USAGE_HOME;
  const previousClaudeHome = process.env.CLAUDE_HOME;
  process.env.USAGE_HOME = path.join(dir, "home");
  const claudeHome = path.join(dir, "claude-home");
  const repoA = path.join(dir, "repo-a");
  const repoB = path.join(dir, "repo-b");
  await mkdir(repoA, { recursive: true });
  await mkdir(repoB, { recursive: true });
  const nativePathA = path.join(claudeHome, "projects", claudeProjectKey(repoA), "claude-a.jsonl");
  const nativePathB = path.join(claudeHome, "projects", claudeProjectKey(repoB), "claude-b.jsonl");
  await writeJsonl(nativePathA, claudeNativeSession({ repo: repoA, sessionId: "claude-a" }));
  await writeJsonl(nativePathB, claudeNativeSession({ repo: repoB, sessionId: "claude-b" }));
  const mtime = new Date("2026-06-09T08:00:20.000Z");
  await utimes(nativePathA, mtime, mtime);
  await utimes(nativePathB, mtime, mtime);

  try {
    process.env.CLAUDE_HOME = claudeHome;
    const globalIndex = await ensureUsageIndex({ repo: repoA, scope: "all", providers: ["claude"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.equal(globalIndex.repoRoot, "all-local-sessions");
    assert.deepEqual([...globalIndex.sourceFiles].sort(), [nativePathA, nativePathB].sort());

    const globalDataset = await loadUsageDatasetFromIndex({ repo: repoA, scope: "all", providers: ["claude"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(globalDataset.messages.list({ role: "user" }).data.map((row) => row.text).sort(), ["run test", "run test"]);

    const repoDataset = await loadUsageDatasetFromIndex({ repo: repoA, providers: ["claude"], now: new Date("2026-06-09T08:30:00.000Z") });
    assert.deepEqual(repoDataset.messages.list({ role: "user" }).data.map((row) => row.text), ["run test"]);
  } finally {
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
  }
});

test("usage prune trims the index to a retention window and tombstones the pruned transcript", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-prune-"));
  const previousUsageHome = process.env.USAGE_HOME;
  const previousClaudeHome = process.env.CLAUDE_HOME;
  process.env.USAGE_HOME = path.join(dir, "home");
  const claudeHome = path.join(dir, "claude-home");
  const repoOld = path.join(dir, "repo-old");
  const repoNew = path.join(dir, "repo-new");
  await mkdir(repoOld, { recursive: true });
  await mkdir(repoNew, { recursive: true });
  const oldPath = path.join(claudeHome, "projects", claudeProjectKey(repoOld), "old.jsonl");
  const newPath = path.join(claudeHome, "projects", claudeProjectKey(repoNew), "new.jsonl");
  await writeJsonl(oldPath, shiftSessionToDay(claudeNativeSession({ repo: repoOld, sessionId: "old" }), "2026-04-01"));
  await writeJsonl(newPath, shiftSessionToDay(claudeNativeSession({ repo: repoNew, sessionId: "new" }), "2026-06-20"));
  await utimes(oldPath, new Date("2026-04-01T08:00:20.000Z"), new Date("2026-04-01T08:00:20.000Z"));
  await utimes(newPath, new Date("2026-06-20T08:00:20.000Z"), new Date("2026-06-20T08:00:20.000Z"));

  try {
    process.env.CLAUDE_HOME = claudeHome;
    const now = new Date("2026-06-23T08:30:00.000Z");
    await ensureUsageIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    const before = await loadUsageDatasetFromIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    assert.deepEqual(before.messages.list({ role: "user" }).data.map((row) => row.text).sort(), ["run test", "run test"]);

    const result = await pruneUsageIndex({ repo: repoOld, scope: "all", before: new Date("2026-06-01T00:00:00.000Z") });
    assert.equal(result.scope, "all");
    assert.ok(result.deletedEvents > 0, "prune removes events older than the cutoff");

    const after = await loadUsageDatasetFromIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    assert.deepEqual(after.messages.list({ role: "user" }).data.map((row) => row.text), ["run test"]);

    // The native transcript is untouched on disk, so the tombstone must keep a normal rebuild from re-importing it.
    await ensureUsageIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    const rebuilt = await loadUsageDatasetFromIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    assert.deepEqual(rebuilt.messages.list({ role: "user" }).data.map((row) => row.text), ["run test"]);

    // A forced rebuild re-imports full history from the still-present native transcript.
    await ensureUsageIndex({ repo: repoOld, scope: "all", providers: ["claude"], now, force: true });
    const forced = await loadUsageDatasetFromIndex({ repo: repoOld, scope: "all", providers: ["claude"], now });
    assert.deepEqual(forced.messages.list({ role: "user" }).data.map((row) => row.text).sort(), ["run test", "run test"]);
  } finally {
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = previousClaudeHome;
  }
});

test("conversation report nests Claude assistant tokens and tool calls without per-tool token attribution", () => {
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
  assert.equal(assistantMessages[0].toolCalls.every((tool) => !("tokens" in tool)), true);
  assert.equal(assistantMessages[1].tokens.output, 12);
  assert.equal(report.totals.toolCalls, 2);
  assert.equal(report.totals.tokens.output, 102);
});

test("messages.list queries visible messages across the loaded dataset", () => {
  const dataset = new UsageDataset([
    ...sessionEvents({ sessionId: "s1", prompt: "older task", at: "2026-06-07T10:00:00.000Z" }),
    ...sessionEvents({ sessionId: "s2", prompt: "newer task", at: "2026-06-08T10:00:00.000Z" }),
    ...sessionEvents({ provider: "claude", sessionId: "c1", prompt: "claude task", at: "2026-06-09T10:00:00.000Z" })
  ]);

  assert.deepEqual(dataset.messages.list({ role: "user" }).data.map((row) => row.text), ["older task", "newer task", "claude task"]);
  assert.deepEqual(dataset.messages.list({ provider: "claude", role: "user" }).data.map((row) => row.conversationId), ["claude:c1"]);
  assert.deepEqual(dataset.messages.list({ conversationId: "codex:s2" }).data.map((row) => row.text), ["newer task", "done"]);
  assert.deepEqual(dataset.messages.list({ conversationId: "codex:s2", turnId: "t1" }).data.map((row) => row.sourceKey), ["codex:s2:t1", "codex:s2:t1"]);
  assert.deepEqual(dataset.messages.list({ role: "user", date: "2026-06-08" }).data.map((row) => row.text), ["newer task"]);
  assert.deepEqual(dataset.messages.list({
    role: "user",
    from: new Date("2026-06-08T00:00:00.000Z"),
    to: new Date("2026-06-08T23:59:59.999Z")
  }).data.map((row) => row.text), ["newer task"]);
});

test("turns without an end event are listed with unknown status", () => {
  const dataset = new UsageDataset(sessionEvents({ sessionId: "s1", prompt: "unfinished", at: "2026-06-07T10:00:00.000Z" })
    .filter((event) => event.kind !== "turn.end"));

  assert.deepEqual(dataset.turns.list().data.map((row) => row.status), ["unknown"]);
});

test("usage package exposes a standalone command binary", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@tangent/usage");
  assert.deepEqual(manifest.bin, { "tangent-usage": "./dist/cli/index.js" });
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

test("usage core client satisfies query, timeline, analytics, capabilities, raw, and dependency-light stories", async () => {
  const longPrompt = "please analyze ".repeat(45);
  const base = sessionEvents({ sessionId: "s1", prompt: longPrompt, at: "2026-06-10T10:00:00.000Z" }).map((event) => {
    if (event.kind === "message.assistant.visible") return { ...event, links: { message_id: "assistant-s1" } };
    return event;
  });
  const events = [
    ...base,
    usageEvent({
      sessionId: "s1",
      id: "s1-tool-call",
      kind: "tool.call",
      at: "2026-06-10T10:00:10.000Z",
      data: { tool_name: "exec_command", category: "command", input: { cmd: "npm test" }, target_paths: ["package.json"] },
      turn: { id: "t1" },
      actor: { role: "assistant", model: "model" },
      links: { tool_call_id: "call1", message_id: "assistant-s1" }
    }),
    usageEvent({
      sessionId: "s1",
      id: "s1-tool-result",
      kind: "tool.result",
      at: "2026-06-10T10:00:20.000Z",
      data: { tool_name: "exec_command", category: "command", status: "success", duration_ms: 10000, output: "ok" },
      turn: { id: "t1" },
      actor: { role: "tool" },
      links: { tool_call_id: "call1" }
    }),
    usageEvent({
      sessionId: "s1",
      id: "s1-usage",
      kind: "token.usage",
      at: "2026-06-10T10:00:21.000Z",
      data: { usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 }, usageConfidence: "provider-reported", model: "model" },
      turn: { id: "t1" },
      actor: { role: "assistant", model: "model" },
      links: { message_id: "assistant-s1" }
    }),
    usageEvent({
      sessionId: "s1",
      id: "s1-compact",
      kind: "compact.post",
      at: "2026-06-10T10:00:22.000Z",
      data: { summary: "compressed", trigger: "manual" },
      turn: { id: "t1" },
      actor: { role: "assistant" }
    }),
    usageEvent({
      sessionId: "s1",
      id: "s1-subagent",
      kind: "subagent.start",
      at: "2026-06-10T10:00:23.000Z",
      data: { name: "review" },
      turn: { id: "t1" },
      actor: { role: "subagent", agent_id: "sub1" },
      links: { subagent_id: "sub1" }
    }),
    ...sessionEvents({ provider: "claude", sessionId: "c1", prompt: "short claude task", at: "2026-06-10T11:00:00.000Z" }),
    usageEvent({
      provider: "claude",
      sessionId: "c1",
      id: "c1-usage",
      kind: "token.usage",
      at: "2026-06-10T11:00:20.000Z",
      data: { usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 }, usageConfidence: "provider-reported", model: "claude-model" },
      turn: { id: "t1" },
      actor: { role: "assistant", model: "claude-model" }
    })
  ];
  const projections = eventsToProjections({
    events,
    capabilities: [providerCapabilities("codex"), providerCapabilities("claude")]
  });
  const usage = createUsageClient(projections);

  const longMessages = await usage.messages.query({
    where: { role: "user", textChars: { gte: 500 } },
    orderBy: [{ field: "createdAt", direction: "desc" }]
  });
  assert.deepEqual(longMessages.data.map((message) => message.sessionId), ["codex:s1"]);

  const report = await usage.sessions.report("codex:s1");
  assert.equal(report.data.messages.some((message) => message.role === "user"), true);
  assert.equal(report.data.messages.some((message) => message.role === "assistant"), true);
  assert.equal(report.data.messages.flatMap((message) => message.toolCalls || []).length, 1);
  assert.ok(report.data.caveats.length > 0);

  const durationTimeline = await usage.sessions.timeline("codex:s1", { metric: "durationMs", bucketBy: "kind", nesting: "tree" });
  assert.equal(durationTimeline.data.items.some((item) => item.kind === "command" && item.durationMs === 10000), true);
  assert.equal(durationTimeline.data.totals.rows.some((row) => row.dimensions["step.kind"] === "command"), true);

  const tokenTimeline = await usage.sessions.timeline("codex:s1", { metric: "tokens.total", bucketBy: "kind" });
  assert.equal(tokenTimeline.data.items.some((item) => item.kind === "model_call" && item.metricValue === 125), true);

  const buckets = await usage.analytics.aggregate({
    scope: { sessionId: "codex:s1" },
    groupBy: ["step.kind"],
    metrics: ["durationMs.sum", "tokens.total.sum", "count"]
  });
  assert.equal(buckets.data.rows.some((row) => row.dimensions["step.kind"] === "model_call" && row.metrics["tokens.total.sum"] === 125), true);

  const slowest = await usage.steps.query({
    where: { sessionId: "codex:s1" },
    orderBy: [{ field: "durationMs", direction: "desc" }],
    limit: 20
  });
  assert.equal(slowest.data[0].durationMs >= 10000, true);

  const tokenHeavy = await usage.steps.query({
    where: { sessionId: "codex:s1", stepKind: "model_call" },
    orderBy: [{ field: "metrics.tokens.total", direction: "desc" }],
    limit: 20
  });
  assert.equal(tokenHeavy.data[0].metrics.tokens.total, 125);

  const providerComparison = await usage.analytics.aggregate({
    scope: { from: "2026-06-10T00:00:00.000Z", to: "2026-06-10T23:59:59.999Z" },
    groupBy: ["provider", "model"],
    metrics: ["tokens.total.sum", "durationMs.sum"]
  });
  assert.equal(providerComparison.data.rows.some((row) => row.dimensions.provider === "codex"), true);
  assert.equal(providerComparison.data.rows.some((row) => row.dimensions.provider === "claude"), true);

  const subagents = await usage.analytics.aggregate({
    scope: { sessionId: "codex:s1" },
    groupBy: ["step.kind"],
    metrics: ["count", "tokens.total.sum"]
  });
  assert.equal(subagents.data.rows.some((row) => row.dimensions["step.kind"] === "subagent"), true);

  const capabilities = await usage.providers.list();
  assert.equal(capabilities.data.some((provider) => provider.provider === "codex" && provider.fields["tools.calls"].status === "supported"), true);

  const raw = await usage.raw.evidence(projections.rawEvents[0].id);
  assert.equal(raw.data.id, projections.rawEvents[0].id);
  assert.ok(raw.meta.provenance.events >= events.length);

  assert.equal(typeof createUsageClient, "function");
});

/** Writes JSONL fixture events to disk for index tests. */
async function writeJsonl(filePath, events) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

/** Builds a single-turn Codex native fixture. */
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

/** Builds a Codex native fixture with two unique token snapshots. */
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

/** Builds a Claude native fixture with assistant usage and tool result rows. */
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

/** Builds a Claude native fixture with two tool calls in one assistant message. */
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
          { type: "tool_use", id: "tool_grep", name: "Grep", input: { pattern: "RollupInput", path: "packages/rollup/src" } }
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

/** Rewrites every record's timestamp onto the given YYYY-MM-DD, keeping the time-of-day, so fixtures can sit on either side of a prune cutoff. */
function shiftSessionToDay(records, day) {
  return records.map((record) => (record.timestamp ? { ...record, timestamp: record.timestamp.replace(/^\d{4}-\d{2}-\d{2}/, day) } : record));
}

/** Converts a repo root into Claude's project directory key. */
function claudeProjectKey(repoRoot) {
  return repoRoot.replace(/\//g, "-").replace(/^-/, "-");
}

/** Builds a Codex rollout fixture for native schema compatibility tests. */
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

/** Builds legacy usage events for a simple completed session. */
function sessionEvents({ provider = "codex", sessionId, prompt, at }) {
  const end = new Date(new Date(at).getTime() + 60000).toISOString();
  return [
    usageEvent({ provider, sessionId, id: `${sessionId}-start`, kind: "conversation.start", at, data: { source: "test" }, actor: { role: "hook" } }),
    usageEvent({ provider, sessionId, id: `${sessionId}-turn`, kind: "turn.start", at, data: { status: "started" }, turn: { id: "t1" }, actor: { role: "user" } }),
    usageEvent({ provider, sessionId, id: `${sessionId}-user`, kind: "message.user", at, data: { text: prompt, text_preview: prompt }, turn: { id: "t1" }, actor: { role: "user" } }),
    usageEvent({ provider, sessionId, id: `${sessionId}-assistant`, kind: "message.assistant.visible", at: end, data: { text: "done", text_preview: "done" }, turn: { id: "t1" }, actor: { role: "assistant", model: "model" } }),
    usageEvent({ provider, sessionId, id: `${sessionId}-end`, kind: "turn.end", at: end, data: { status: "completed" }, turn: { id: "t1" }, actor: { role: "assistant" } })
  ];
}

/** Builds a legacy usage event fixture row. */
function usageEvent({ provider = "codex", sessionId, id, kind, at, data, turn, actor, links }) {
  return {
    schema: "usage.event.v2",
    event_id: `evt_${id}`,
    kind,
    recorded_at: at,
    observed_at: at,
    provider,
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
      id: `${provider}:${sessionId}`,
      provider_session_id: sessionId
    },
    turn,
    actor,
    links,
    data
  };
}
