import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ConvosDataset } from "../dist/core/dataset.js";
import { normalizeHookInput } from "../dist/hook-runner/normalize-hook-input.js";
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
    convosVersion: "test"
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

test("dataset derives stable synthetic turns from hook events without turn_id", () => {
  const events = [
    ...normalizeHookInput(hook("UserPromptSubmit", { prompt: "first" }), context()),
    ...normalizeHookInput(hook("Stop", { last_assistant_message: "done" }), context())
  ];
  const dataset = new ConvosDataset(events);
  const turns = dataset.turns.list({ includeActive: true }).data;
  assert.equal(turns.length, 1);
  assert.equal(turns[0].sourceKey, "codex:s1:turn-000001");
  assert.equal(turns[0].status, "completed");
  assert.equal(dataset.messages.visible({ conversationId: "codex:s1", turnId: turns[0].turnId }).data.length, 2);
});

test("hook install merges and uninstall removes only Tangent commands", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "convos-hooks-"));
  process.env.CONVOS_HOME = path.join(dir, "home");
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
  assert.equal(commands.some((command) => command.includes("tangent convos hook record --provider codex")), true);

  await uninstallHooks({ provider: "codex", scope: "repo-local", repo: dir });
  const uninstalled = JSON.parse(await readFile(hooksPath, "utf8"));
  const remaining = uninstalled.hooks.Stop.flatMap((group) => group.hooks.map((entry) => entry.command));
  assert.deepEqual(remaining, ["echo keep-me"]);
});
