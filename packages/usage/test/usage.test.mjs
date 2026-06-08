import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageDataset } from "../dist/core/dataset.js";
import { eventFileForConversation } from "../dist/core/paths.js";
import { normalizeHookInput } from "../dist/hook-runner/normalize-hook-input.js";
import { normalizeClaudeNativeRecord } from "../dist/providers/claude/native/normalize.js";
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

  const first = await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  assert.equal(first.indexed, 1);
  assert.equal(first.skipped, 0);

  const second = await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  assert.equal(second.indexed, 0);
  assert.equal(second.skipped, 1);

  let dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId });
  assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["older task", "done"]);

  await writeJsonl(file, [
    ...sessionEvents({ sessionId: "s1", prompt: "older task", at: "2026-06-07T10:00:00.000Z" }),
    usageEvent({ sessionId: "s1", id: "s1-extra", kind: "message.assistant.visible", at: "2026-06-07T10:02:00.000Z", data: { text: "extra", text_preview: "extra" }, actor: { role: "assistant", model: "model" } })
  ]);
  const third = await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  assert.equal(third.indexed, 1);

  dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId });
  assert.deepEqual(dataset.messages.visible({ conversationId }).data.map((row) => row.text), ["older task", "done", "extra"]);
});

test("usage index resolves latest sessions from indexed conversations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-latest-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  await writeJsonl(eventFileForConversation(dir, "codex", "codex:s1"), sessionEvents({ sessionId: "s1", prompt: "older", at: "2026-06-07T10:00:00.000Z" }));
  await writeJsonl(eventFileForConversation(dir, "codex", "codex:s2"), sessionEvents({ sessionId: "s2", prompt: "newer", at: "2026-06-08T10:00:00.000Z" }));

  await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  const latest = await resolveConversationRef({ repo: dir, ref: "latest" });
  assert.equal(latest.conversationId, "codex:s2");
  assert.equal(latest.shortId, "codex:s2");
});

test("usage archive only moves indexed unchanged files before the cutoff", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-archive-"));
  process.env.USAGE_HOME = path.join(dir, "home");
  const conversationId = "codex:s1";
  const file = eventFileForConversation(dir, "codex", conversationId);
  await writeJsonl(file, sessionEvents({ sessionId: "s1", prompt: "archive me", at: "2026-06-07T10:00:00.000Z" }));
  await ensureUsageIndex({ repo: dir, providers: ["codex"] });

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
  await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  await rm(file);

  const result = await ensureUsageIndex({ repo: dir, providers: ["codex"] });
  assert.equal(result.removed, 1);
  const dataset = await loadUsageDatasetFromIndex({ repo: dir, conversationId });
  assert.equal(dataset.events.length, 0);
});

async function writeJsonl(filePath, events) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
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

function usageEvent({ sessionId, id, kind, at, data, turn, actor }) {
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
    data
  };
}
