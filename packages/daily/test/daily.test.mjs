import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageDataset } from "../../usage/dist/core/dataset.js";
import { normalizeHookInput } from "../../usage/dist/hook-runner/normalize-hook-input.js";
import { buildDayRollupInput, buildTurnDigestInput } from "../dist/usage/adapter.js";
import { appendLedgerLine, readLedger } from "../dist/core/ledger.js";
import { loadConfig } from "../dist/core/config.js";
import { readDigestsForDate, writeDailyNote } from "../dist/core/note-writer.js";
import { dayRollupPrompt } from "../dist/core/prompts.js";
import { processUnprocessed } from "../dist/sdk/processUnprocessed.js";
import { renderCommand } from "../dist/cli/commands/artifacts.js";
import { ClaudeCliSummaryRunner } from "../dist/runners/claude-cli.js";

function context() {
  return {
    provider: "codex",
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
      maxStringBytes: 100000,
      maxToolResponseBytes: 100000
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
    turn_id: "t1",
    ...extra
  };
}

async function loadedConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-test-"));
  process.env.TANGENT_DAILY_HOME = path.join(dir, "daily-home");
  return loadConfig({ repo: dir });
}

test("turn digest input is bounded even with huge tool output", async () => {
  const loaded = await loadedConfig();
  loaded.config.input.maxTurnInputChars = 2500;
  loaded.config.input.maxToolResultChars = 100000;
  const huge = "x".repeat(100000);
  const events = [
    ...normalizeHookInput(hook("UserPromptSubmit", { prompt: "debug failing tests" }), context()),
    ...normalizeHookInput(hook("PreToolUse", {
      tool_name: "Bash",
      tool_use_id: "tool1",
      tool_input: { command: "npm test" }
    }), context()),
    ...normalizeHookInput(hook("PostToolUse", {
      tool_name: "Bash",
      tool_use_id: "tool1",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, stderr: huge }
    }), context()),
    ...normalizeHookInput(hook("Stop", { last_assistant_message: huge }), context())
  ];
  const dataset = new UsageDataset(events);
  const turn = dataset.turns.list({ includeActive: true }).data[0];
  const input = buildTurnDigestInput({ dataset, repo: loaded.repo, config: loaded.config, turn, dateBucket: "2026-06-08" });
  assert.ok(JSON.stringify(input).length <= loaded.config.input.maxTurnInputChars);
  assert.equal(input.source.sourceKey, "codex:s1:t1");
});

test("day rollup input bounds normalized conversation reports", async () => {
  const loaded = await loadedConfig();
  loaded.config.input.maxTurnInputChars = 2500;
  loaded.config.input.maxToolResultChars = 100000;
  const huge = "x".repeat(100000);
  const extraMessages = Array.from({ length: 80 }, (_, index) =>
    normalizeHookInput(hook("UserPromptSubmit", {
      prompt: `keep durable surface-routing note ${index}: ${huge}`
    }), context())
  ).flat();
  const events = [
    ...normalizeHookInput(hook("UserPromptSubmit", { prompt: "debug the surface routing model" }), context()),
    ...normalizeHookInput(hook("PreToolUse", {
      tool_name: "Bash",
      tool_use_id: "tool1",
      tool_input: { command: "npm test", details: huge }
    }), context()),
    ...normalizeHookInput(hook("PostToolUse", {
      tool_name: "Bash",
      tool_use_id: "tool1",
      tool_input: { command: "npm test", details: huge },
      tool_response: { exit_code: 1, stderr: huge }
    }), context()),
    ...extraMessages,
    ...normalizeHookInput(hook("Stop", { last_assistant_message: huge }), context())
  ];
  const dataset = new UsageDataset(events);
  const turn = dataset.turns.list({ includeActive: true }).data[0];
  const input = buildDayRollupInput({ dataset, repo: loaded.repo, config: loaded.config, turns: [turn], date: "2026-06-08" });
  const conversationJson = JSON.stringify(input.conversations[0]);

  assert.ok(conversationJson.length <= loaded.config.input.maxTurnInputChars);
  assert.match(conversationJson, /keep durable surface-routing note/);
  assert.doesNotMatch(conversationJson, new RegExp(huge.slice(0, 1000)));
  assert.match(conversationJson, /Conversation report was .*truncated for daily rollup input/);
});

test("readDigestsForDate selects latest successful digest paths from ledger", async () => {
  const loaded = await loadedConfig();
  const oldPath = path.join(loaded.paths.outputDir, "old.json");
  const newPath = path.join(loaded.paths.outputDir, "new.json");
  const oldDigest = digest("Old", "old-hash");
  const newDigest = digest("New", "new-hash");
  await mkdir(loaded.paths.outputDir, { recursive: true });
  await writeFile(oldPath, JSON.stringify(oldDigest), "utf8");
  await writeFile(newPath, JSON.stringify(newDigest), "utf8");

  await appendLedgerLine(loaded.paths.ledgerPath, ledger("source", "old-fingerprint", "old-hash", oldPath));
  await appendLedgerLine(loaded.paths.ledgerPath, ledger("source", "new-fingerprint", "new-hash", newPath));

  const rows = await readDigestsForDate(loaded, "2026-06-08");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].digest.headline, "New");
});

test("writeDailyNote preserves manual notes and replaces generated block", async () => {
  const loaded = await loadedConfig();
  const notePath = path.join(loaded.paths.notesDir, "2026-06-08.md");
  await mkdir(loaded.paths.notesDir, { recursive: true });
  await writeFile(notePath, [
    "# Existing",
    "",
    "## Manual notes",
    "",
    "keep this",
    "",
    "<!-- tangent:generated:start date=2026-06-08 schema=daily.note.v2 -->",
    "old generated",
    "<!-- tangent:generated:end -->",
    ""
  ].join("\n"), "utf8");

  await writeDailyNote(loaded, "2026-06-08", [topic("topic-a", "Topic A", "new generated")]);
  const text = await readFile(notePath, "utf8");
  assert.match(text, /keep this/);
  assert.match(text, /new generated/);
  assert.doesNotMatch(text, /old generated/);
});

test("day rollup prompt asks for user-knowledge prose instead of assistant work bullets", () => {
  const prompt = dayRollupPrompt({ date: "2026-06-08", inputPath: "/tmp/day-input.json" });
  assert.match(prompt, /Distill what the user discussed, understood, decided, questioned, or learned/);
  assert.match(prompt, /Assistant messages are context and evidence only/);
  assert.match(prompt, /Write in full sentences and connected paragraphs/);
  assert.match(prompt, /Avoid dot-point summaries/);
  assert.match(prompt, /Bullets are acceptable only for compact lists of future-useful commands/);
  assert.match(prompt, /If the user mostly delegated implementation without adding their own reasoning, keep the note short/);
  assert.match(prompt, /long-term signal only: decisions, ideas, experiments, hypotheses, constraints, mental models, tradeoffs, and unresolved questions/);
  assert.match(prompt, /would help the user recover useful technical or product context in the future/);
  assert.match(prompt, /Omit ephemeral coordination, short-term chores, status updates, requests to commit, requests to rerun tools/);
  assert.match(prompt, /Do not infer motivation from routine instructions/);
  assert.match(prompt, /A request to commit soon is short-term coordination, not reusable knowledge/);
  assert.match(prompt, /Good:\n### Pathfinding and routing\nThe useful thread/);
});

test("claude cli runner skips user settings and parses structured output events", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-claude-runner-"));
  const commandPath = path.join(dir, "fake-claude.mjs");
  const argsPath = path.join(dir, "args.json");
  await writeFile(commandPath, [
    "#!/usr/bin/env node",
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.CAPTURE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
    "process.stdout.write(JSON.stringify([{",
    "  type: 'result',",
    "  subtype: 'success',",
    "  structured_output: { schema: 'daily.rollup.v1', markdown: '## Durable idea\\n\\nThe note is prose.', sourceCaveats: [] }",
    "}]));"
  ].join("\n"), "utf8");
  await chmod(commandPath, 0o755);

  const runner = new ClaudeCliSummaryRunner({
    kind: "claude-cli",
    command: commandPath,
    model: "sonnet",
    timeoutMs: 5000,
    maxTurns: 1
  });
  const previousCapturePath = process.env.CAPTURE_ARGS_PATH;
  process.env.CAPTURE_ARGS_PATH = argsPath;
  try {
    const output = await runner.summarizeDay({
      schema: "daily.rollup-input.v1",
      date: "2026-06-08",
      timezone: "UTC",
      repo: { name: "repo", rootHash: "hash", branch: "main" },
      source: { generatedAt: "2026-06-08T00:00:00.000Z", providers: ["codex"], conversationIds: ["codex:s1"], sourceFiles: [], caveats: [] },
      examples: [],
      conversations: []
    });
    const args = JSON.parse(await readFile(argsPath, "utf8"));
    assert.equal(output.markdown, "## Durable idea\n\nThe note is prose.");
    assert.deepEqual(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2), ["--setting-sources", "project,local"]);
    assert.equal(args.includes("--bare"), false);
    assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
    assert.deepEqual(args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2), ["--max-turns", "2"]);
  } finally {
    if (previousCapturePath === undefined) delete process.env.CAPTURE_ARGS_PATH;
    else process.env.CAPTURE_ARGS_PATH = previousCapturePath;
  }
});

test("processUnprocessed renders note from day rollup output", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-process-"));
  process.env.TANGENT_DAILY_HOME = path.join(dir, "daily-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "new work", response: "done" }));

  let receivedInput;
  try {
    const result = await processUnprocessed({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: {
        id: "fake",
        kind: "claude-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeTurn: async () => {
          throw new Error("summarizeTurn should not be called");
        },
        summarizeDay: async (input) => {
          receivedInput = input;
          return {
            schema: "daily.rollup.v1",
            markdown: "## New processed work\n\n- Wrote one daily rollup.",
            sourceCaveats: []
          };
        }
      }
    });

    assert.equal(result.processed, 1);
    assert.equal(receivedInput.schema, "daily.rollup-input.v1");
    assert.equal(receivedInput.conversations.length, 1);
    const note = await readFile(result.note.path, "utf8");
    assert.match(note, /New processed work/);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processUnprocessed uses one day rollup call when the runner supports it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-day-process-"));
  const previousDailyHome = process.env.TANGENT_DAILY_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_DAILY_HOME = path.join(dir, "daily-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const loadedBefore = await loadConfig({ repo: dir });
  await mkdir(loadedBefore.paths.notesDir, { recursive: true });
  await mkdir(loadedBefore.paths.examplesDir, { recursive: true });
  await writeFile(path.join(loadedBefore.paths.notesDir, "2026-06-07.md"), [
    "# Yesterday",
    "",
    "<!-- tangent:generated:start date=2026-06-07 schema=daily.note.v2 -->",
    "Use concise edited-note style.",
    "<!-- tangent:generated:end -->",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(loadedBefore.paths.examplesDir, "explicit.md"), "Explicit example style.\n", "utf8");

  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "summarize native transcripts", response: "implemented day rollup" }));

  let dayCalls = 0;
  let turnCalls = 0;
  let receivedInput;
  try {
    const result = await processUnprocessed({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeTurn: async () => {
          turnCalls += 1;
          throw new Error("summarizeTurn should not be called");
        },
        summarizeDay: async (input) => {
          dayCalls += 1;
          receivedInput = input;
          return {
            schema: "daily.rollup.v1",
            markdown: "## Native transcript rollup\n\n- Added a single day-level rollup path.",
            sourceCaveats: ["test caveat"]
          };
        }
      }
    });

    assert.equal(result.processed, 1);
    assert.equal(dayCalls, 1);
    assert.equal(turnCalls, 0);
    assert.equal(receivedInput.schema, "daily.rollup-input.v1");
    assert.equal(receivedInput.conversations.length, 1);
    assert.equal(receivedInput.conversations[0].messages.length, 2);
    assert.deepEqual(receivedInput.conversations[0].messages.map((message) => message.at), [
      "2026-06-08T10:00:03.000Z",
      "2026-06-08T10:00:04.000Z"
    ]);
    assert.deepEqual(receivedInput.conversations[0].messages.map((message) => message.role), ["user", "assistant"]);
    assert.deepEqual(receivedInput.examples.map((example) => path.basename(example.path)), ["explicit.md", "2026-06-07.md"]);
    assert.equal(receivedInput.examples[1].markdown.includes("<!-- tangent:"), false);
    assert.match(receivedInput.examples[1].markdown, /Use concise edited-note style/);

    const note = await readFile(result.note.path, "utf8");
    assert.match(note, /Native transcript rollup/);
    assert.match(note, /single day-level rollup path/);

    const loaded = await loadConfig({ repo: dir });
    const ledgerRows = await readLedger(loaded.paths.ledgerPath);
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].status, "processed");
    assert.equal(ledgerRows[0].inputVersion, "daily.rollup-input.v1");
    assert.equal(ledgerRows[0].digestPath, undefined);
    assert.equal(ledgerRows[0].rollupPath, result.digests[0].path);
    assert.match(result.digests[0].path, /artifacts\/rollups\/2026-06-08\/output\.[a-f0-9]+\.json$/);
    const rollupArtifacts = await readdir(path.join(loaded.paths.rollupsDir, "2026-06-08"));
    assert.equal(rollupArtifacts.some((file) => file.startsWith("input.") && file.endsWith(".json")), true);
    assert.equal(rollupArtifacts.some((file) => file.startsWith("messages.") && file.endsWith(".md")), true);
    assert.equal(rollupArtifacts.some((file) => file.startsWith("prompt.") && file.endsWith(".md")), true);
    assert.equal(rollupArtifacts.some((file) => file.startsWith("output.") && file.endsWith(".json")), true);

    const originalLog = console.log;
    try {
      console.log = () => {};
      await renderCommand({ _: ["render", dir], date: "2026-06-08" });
    } finally {
      console.log = originalLog;
    }
    const renderedNote = await readFile(result.note.path, "utf8");
    assert.match(renderedNote, /Native transcript rollup/);
    assert.match(renderedNote, /single day-level rollup path/);
  } finally {
    if (previousDailyHome === undefined) delete process.env.TANGENT_DAILY_HOME;
    else process.env.TANGENT_DAILY_HOME = previousDailyHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

function digest(headline, inputHash) {
  return {
    schema: "daily.turn-digest.v1",
    source: {
      sourceKey: "source",
      provider: "codex",
      conversationId: "codex:s1",
      turnId: "t1",
      dateBucket: "2026-06-08",
      inputHash
    },
    topicHints: [{ key: "topic", title: "Topic", confidence: "high" }],
    headline,
    summary: headline,
    workDone: [],
    designNotes: [],
    decisions: [],
    experiments: [],
    debuggingFindings: [],
    followUps: [],
    entities: { files: [], functions: [], tickets: [], commands: [] },
    evidence: [],
    quality: { confidence: "high", caveats: [] }
  };
}

function digestForInput(headline, input) {
  return {
    ...digest(headline, ""),
    source: {
      sourceKey: input.source.sourceKey,
      provider: input.source.provider,
      conversationId: input.source.conversationId,
      turnId: input.source.turnId,
      dateBucket: input.source.dateBucket,
      inputHash: ""
    }
  };
}

function ledger(sourceKey, sourceFingerprint, inputHash, digestPath) {
  return {
    schema: "daily.ledger.v2",
    repoId: "repo",
    dateBucket: "2026-06-08",
    sourceKey,
    provider: "codex",
    conversationId: "codex:s1",
    turnId: "t1",
    sourceFingerprint,
    inputVersion: "daily.turn-digest-input.v1",
    inputHash,
    digestPath,
    topicKeys: ["topic"],
    processedAt: new Date().toISOString(),
    status: "processed"
  };
}

async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function codexNativeSession({ repo, sessionId, turnId, prompt, response }) {
  return [
    {
      timestamp: "2026-06-08T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-06-08T10:00:00.000Z",
        cwd: repo,
        originator: "codex-tui",
        cli_version: "0.137.0",
        source: "cli",
        git: { branch: "main", commit_hash: "abc" }
      }
    },
    { timestamp: "2026-06-08T10:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { timestamp: "2026-06-08T10:00:02.000Z", type: "turn_context", payload: { turn_id: turnId, cwd: repo, model: "gpt-5.5" } },
    { timestamp: "2026-06-08T10:00:03.000Z", type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: "2026-06-08T10:00:04.000Z", type: "event_msg", payload: { type: "agent_message", message: response, phase: "final_answer" } },
    { timestamp: "2026-06-08T10:00:05.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 5000 } }
  ];
}

function topic(key, title, markdown) {
  return {
    schema: "daily.topic-rollup.v1",
    date: "2026-06-08",
    key,
    title,
    sourceTurnKeys: ["source"],
    providers: ["codex"],
    summary: markdown,
    narrativeMarkdown: markdown,
    sections: [],
    decisions: [],
    experiments: [],
    openQuestions: [],
    followUps: [],
    evidence: [],
    caveats: []
  };
}
