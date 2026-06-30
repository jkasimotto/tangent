import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readLedger } from "../dist/core/ledger.js";
import { loadConfig } from "../dist/core/config.js";
import { writeGeneratedRollupMarkdown } from "../dist/core/note-writer.js";
import { rollupPrompt } from "../dist/core/prompts.js";
import { processRollup } from "../dist/sdk/processRollup.js";
import { runRollupCli } from "../dist/cli/index.js";
import { renderCommand } from "../dist/cli/commands/artifacts.js";
import { ClaudeCliSummaryRunner } from "../dist/runners/claude-cli.js";

/** Loads rollup config in an isolated temporary home. */
async function loadedConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-test-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  return loadConfig({ repo: dir });
}

/** Builds the expected single-day rollup period fixture. */
function dayPeriod(date) {
  return { kind: "day", date, startDate: date, endDate: date, key: date, label: date };
}

/** Builds the expected inclusive range rollup period fixture. */
function rangePeriod(startDate, endDate) {
  return { kind: "range", startDate, endDate, key: `${startDate}--${endDate}`, label: `${startDate} to ${endDate}` };
}

/** Creates a summary runner stub with a configurable summarization callback. */
function fakeSummaryRunner(summarizeRollup, kind = "codex-cli") {
  return {
    id: "fake",
    kind,
    /** Reports the fake runner as available. */
    checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
    summarizeRollup
  };
}

test("writeGeneratedRollupMarkdown preserves manual notes and replaces generated block", async () => {
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
    "<!-- tangent:generated:start period=2026-06-08 schema=rollup.note.v1 -->",
    "old generated",
    "<!-- tangent:generated:end -->",
    ""
  ].join("\n"), "utf8");

  await writeGeneratedRollupMarkdown(loaded, dayPeriod("2026-06-08"), "new generated");
  const text = await readFile(notePath, "utf8");
  assert.match(text, /keep this/);
  assert.match(text, /new generated/);
  assert.doesNotMatch(text, /old generated/);
});

test("writeGeneratedRollupMarkdown uses explicit output path with generated block replacement", async () => {
  const loaded = await loadedConfig();
  const explicitPath = path.join(loaded.paths.notesDir, "explicit.md");
  await mkdir(loaded.paths.notesDir, { recursive: true });
  await writeFile(explicitPath, [
    "# Explicit note",
    "",
    "<!-- tangent:generated:start period=2026-06-08 schema=rollup.note.v1 -->",
    "old",
    "<!-- tangent:generated:end -->",
    ""
  ].join("\n"), "utf8");

  const note = await writeGeneratedRollupMarkdown(loaded, dayPeriod("2026-06-08"), "new generated", { outputPath: explicitPath });
  const written = await readFile(explicitPath, "utf8");

  assert.equal(note.path, explicitPath);
  assert.match(written, /new generated/);
  assert.doesNotMatch(written, /old/);
});

test("writeGeneratedRollupMarkdown falls back to .generated.md without overwrite when generated block is missing", async () => {
  const loaded = await loadedConfig();
  const explicitPath = path.join(loaded.paths.notesDir, "explicit.md");
  await mkdir(loaded.paths.notesDir, { recursive: true });
  await writeFile(explicitPath, "# Existing content\n", "utf8");

  const note = await writeGeneratedRollupMarkdown(loaded, dayPeriod("2026-06-08"), "new generated", { outputPath: explicitPath });
  const generatedPath = path.join(loaded.paths.notesDir, "explicit.generated.md");
  const written = await readFile(generatedPath, "utf8");

  assert.equal(note.path, generatedPath);
  assert.match(written, /new generated/);
  assert.equal(await readFile(explicitPath, "utf8"), "# Existing content\n");
});

test("rollup prompt uses engineering-memory examples and output schema", () => {
  const prompt = rollupPrompt({ period: dayPeriod("2026-06-08"), inputPath: "/tmp/rollup-input.json" });
  assert.match(prompt, /Conversation snippet:/);
  assert.match(prompt, /Desired output:/);
  assert.match(prompt, /The input intentionally contains only user messages/);
  assert.match(prompt, /Very long user messages may also be excluded/);
  assert.match(prompt, /Do not infer assistant findings/);
  assert.match(prompt, /### Surface-aware routing/);
  assert.match(prompt, /### Simulation pause boundary/);
  assert.match(prompt, /### Eval and rollup direction/);
  assert.match(prompt, /## Data-driven simulation design model/);
  assert.match(prompt, /### Parser refactor/);
  assert.match(prompt, /JSON schema:/);
  assert.match(prompt, /Output valid JSON matching the schema/);
  assert.doesNotMatch(prompt, /Bad:/);
  assert.doesNotMatch(prompt, /Good:/);
});

test("rollup prompt includes purpose and focus terms when provided", () => {
  const prompt = rollupPrompt({
    period: dayPeriod("2026-06-08"),
    inputPath: "/tmp/rollup-input.json",
    purpose: {
      kind: "design-brief",
      request: "Create a design brief on data-driven simulations",
      title: "Data-driven simulations",
      focusTerms: ["data-driven simulation", "timeline", "event queue"],
      audience: "future-agent"
    }
  });
  assert.match(prompt, /\"request\": \"Create a design brief on data-driven simulations\"/);
  assert.match(prompt, /\"focusTerms\": /);
  assert.match(prompt, /data-driven simulation/);
});

test("claude cli runner skips user settings and parses structured output events", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-claude-runner-"));
  const commandPath = path.join(dir, "fake-claude.mjs");
  const argsPath = path.join(dir, "args.json");
  await writeFile(commandPath, [
    "#!/usr/bin/env node",
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.CAPTURE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
    "process.stdout.write(JSON.stringify([{",
    "  type: 'result',",
    "  subtype: 'success',",
    "  structured_output: { schema: 'rollup.output.v1', markdown: '## Durable idea\\n\\nThe note is prose.', sourceCaveats: [] }",
    "}]));"
  ].join("\n"), "utf8");
  await chmod(commandPath, 0o755);

  const runner = new ClaudeCliSummaryRunner({
    kind: "claude-cli",
    command: commandPath,
    model: "sonnet",
    timeoutMs: 15000,
    maxTurns: 1
  });
  const previousCapturePath = process.env.CAPTURE_ARGS_PATH;
  process.env.CAPTURE_ARGS_PATH = argsPath;
  try {
    const output = await runner.summarizeRollup({
      schema: "rollup.input.v1",
      messageMode: "user-only",
      period: dayPeriod("2026-06-08"),
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

test("processRollup renders note from rollup output", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-process-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "new work", response: "done" }));

  let receivedInput;
  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return {
          schema: "rollup.output.v1",
          markdown: "## New processed work\n\n- Wrote one roll-up.",
          sourceCaveats: []
        };
      }, "claude-cli")
    });

    assert.equal(result.processed, 1);
    assert.equal(receivedInput.schema, "rollup.input.v1");
    assert.deepEqual(receivedInput.period, dayPeriod("2026-06-08"));
    assert.equal(receivedInput.conversations.length, 1);
    const note = await readFile(result.note.path, "utf8");
    assert.match(note, /New processed work/);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup passes purpose and focus terms into rollup input", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-purpose-input-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "data-driven simulation", response: "done" }));

  let receivedInput;
  try {
    await processRollup({
      repo: dir,
      date: "2026-06-08",
      purpose: "Create a design brief on data-driven simulations",
      focus: ["data-driven simulation", "timeline", "event queue"],
      kind: "design-brief",
      title: "Data-driven simulation brief",
      audience: "future-agent",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return {
          schema: "rollup.output.v1",
          markdown: "## Design brief",
          sourceCaveats: []
        };
      })
    });

    assert.equal(receivedInput?.purpose?.request, "Create a design brief on data-driven simulations");
    assert.deepEqual(receivedInput?.purpose?.focusTerms, ["data-driven simulation", "timeline", "event queue"]);
    assert.equal(receivedInput?.purpose?.kind, "design-brief");
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup dry-run includes quiet turns when no task completion marker exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-active-dryrun-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const sessionPath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-active.jsonl");
  await writeJsonl(sessionPath, codexNativeSession({
    repo: dir,
    sessionId: "active-1",
    turnId: "active-turn-1",
    prompt: "work in progress",
    response: "partial answer",
    date: "2026-06-08",
    includeTaskComplete: false
  }));
  await utimes(sessionPath, new Date("2026-06-08T10:00:05.000Z"), new Date("2026-06-08T10:00:05.000Z"));

  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      dryRun: true
    });

    assert.equal(result.candidates, 1);
    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup uses one rollup call when the runner supports it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-day-process-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const loadedBefore = await loadConfig({ repo: dir });
  await mkdir(loadedBefore.paths.notesDir, { recursive: true });
  await mkdir(loadedBefore.paths.examplesDir, { recursive: true });
  await writeFile(path.join(loadedBefore.paths.notesDir, "2026-06-07.md"), [
    "# Yesterday",
    "",
    "<!-- tangent:generated:start period=2026-06-07 schema=rollup.note.v1 -->",
    "Use concise edited-note style.",
    "<!-- tangent:generated:end -->",
    ""
  ].join("\n"), "utf8");
  await writeFile(path.join(loadedBefore.paths.examplesDir, "explicit.md"), "Explicit example style.\n", "utf8");

  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "summarize native transcripts", response: "implemented day rollup" }));

  let dayCalls = 0;
  let receivedInput;
  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: fakeSummaryRunner(async (input) => {
        dayCalls += 1;
        receivedInput = input;
        return {
          schema: "rollup.output.v1",
          markdown: "## Native transcript rollup\n\n- Added a single day-level rollup path.",
          sourceCaveats: ["test caveat"]
        };
      })
    });

    assert.equal(result.processed, 1);
    assert.equal(dayCalls, 1);
    assert.equal(receivedInput.schema, "rollup.input.v1");
    assert.equal(receivedInput.messageMode, "user-only");
    assert.deepEqual(receivedInput.period, dayPeriod("2026-06-08"));
    assert.equal(receivedInput.conversations.length, 1);
    assert.equal(receivedInput.conversations[0].schema, "rollup.user-conversation.v1");
    assert.equal(receivedInput.conversations[0].messages.length, 1);
    assert.deepEqual(receivedInput.conversations[0].messages.map((message) => message.at), [
      "2026-06-08T10:00:03.000Z"
    ]);
    assert.deepEqual(receivedInput.conversations[0].messages.map((message) => message.role), ["user"]);
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
    assert.equal(ledgerRows[0].rollupKey, "2026-06-08");
    assert.equal(ledgerRows[0].inputVersion, "rollup.input.v1");
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
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup input preserves only full user messages and excludes assistant, tool, and token context", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-user-only-input-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const longTail = "preserve-this-tail";
  const longPrompt = `Please inspect parser with key sk-${"a".repeat(20)}. ${"x".repeat(5200)} ${longTail}`;
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-tools.jsonl"),
    codexNativeToolSession({ repo: dir, sessionId: "tools", turnId: "t-tools", prompt: longPrompt })
  );

  let receivedInput;
  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return { schema: "rollup.output.v1", markdown: "## User only", sourceCaveats: [] };
      })
    });

    const inputJson = JSON.stringify(receivedInput);
    assert.equal(receivedInput.messageMode, "user-only");
    assert.equal(receivedInput.conversations.length, 1);
    assert.equal(receivedInput.conversations[0].messages.length, 1);
    assert.equal(receivedInput.conversations[0].messages[0].role, "user");
    assert.match(receivedInput.conversations[0].messages[0].text, /preserve-this-tail/);
    assert.match(receivedInput.conversations[0].messages[0].text, /\[REDACTED\]/);
    assert.doesNotMatch(receivedInput.conversations[0].messages[0].text, /sk-a/);
    assert.doesNotMatch(inputJson, /assistant found this bug/);
    assert.doesNotMatch(inputJson, /exec_command/);
    assert.doesNotMatch(inputJson, /Process exited with code 0/);
    assert.doesNotMatch(inputJson, /toolCalls/);
    assert.doesNotMatch(inputJson, /tokens/);
    assert.doesNotMatch(inputJson, /Conversation report was truncated/);
    assert.doesNotMatch(inputJson, /Purpose-focused clamping dropped/);

    const artifactJson = await readFile(result.artifacts.inputPath, "utf8");
    assert.doesNotMatch(artifactJson, /assistant found this bug/);
    assert.doesNotMatch(artifactJson, /exec_command/);
    assert.match(artifactJson, /preserve-this-tail/);
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup excludes user messages above the configured length", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-long-user-message-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  const shortPrompt = "keep this dictated message";
  const longPrompt = `copied llm start ${"x".repeat(8200)} copied llm tail`;
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-short.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "short", turnId: "t-short", prompt: shortPrompt, response: "done" })
  );
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T11-00-00-long.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "long", turnId: "t-long", prompt: longPrompt, response: "done", hour: "11" })
  );

  let receivedInput;
  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return { schema: "rollup.output.v1", markdown: "## Length filtered", sourceCaveats: [] };
      })
    });

    const inputJson = JSON.stringify(receivedInput);
    assert.equal(receivedInput.conversations.length, 2);
    assert.deepEqual(receivedInput.conversations.flatMap((conversation) => conversation.messages.map((message) => message.text)), [shortPrompt]);
    assert.match(JSON.stringify(receivedInput.source.caveats), /Excluded 1 user message\(s\) longer than 8000 characters/);
    assert.doesNotMatch(inputJson, /copied llm tail/);

    const rendered = await readFile(result.artifacts.messagesPath, "utf8");
    assert.match(rendered, /keep this dictated message/);
    assert.doesNotMatch(rendered, /copied llm tail/);
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("purpose rollup keeps selected turns without relevance clamping", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-purpose-no-drop-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "data-driven simulation timeline", response: "done", date: "2026-06-08" })
  );
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T11-00-00-s2.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s2", turnId: "t2", prompt: "fix unrelated README typo", response: "done", date: "2026-06-08", hour: "11" })
  );

  let receivedInput;
  try {
    await processRollup({
      repo: dir,
      date: "2026-06-08",
      purpose: "Create a design brief on data-driven simulations",
      focus: ["data-driven simulation", "timeline"],
      kind: "design-brief",
      title: "Data-driven simulation brief",
      audience: "future-agent",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return { schema: "rollup.output.v1", markdown: "## Purpose", sourceCaveats: [] };
      })
    });

    assert.equal(receivedInput.purpose.title, "Data-driven simulation brief");
    assert.equal(receivedInput.purpose.audience, "future-agent");
    assert.equal(receivedInput.conversations.length, 2);
    assert.deepEqual(receivedInput.conversations.map((conversation) => conversation.messages[0].text), [
      "data-driven simulation timeline",
      "fix unrelated README typo"
    ]);
    assert.doesNotMatch(JSON.stringify(receivedInput.source.caveats), /Purpose-focused clamping dropped/);
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("rendered rollup messages artifact mirrors user-only input", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-user-messages-artifact-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-tools.jsonl"),
    codexNativeToolSession({ repo: dir, sessionId: "messages", turnId: "t-messages", prompt: "Implement the parser refactor." })
  );

  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      summaryRunner: fakeSummaryRunner(async () => ({ schema: "rollup.output.v1", markdown: "## Messages", sourceCaveats: [] }))
    });

    const rendered = await readFile(result.artifacts.messagesPath, "utf8");
    assert.match(rendered, /^# Rollup user messages - 2026-06-08/m);
    assert.match(rendered, /^Mode: user-only/m);
    assert.match(rendered, /### 2026-06-08T10:00:03.000Z user/);
    assert.match(rendered, /Implement the parser refactor/);
    assert.doesNotMatch(rendered, /assistant found this bug/);
    assert.doesNotMatch(rendered, /tokens:/);
    assert.doesNotMatch(rendered, /tools:/);
    assert.doesNotMatch(rendered, /exec_command/);
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup writes one combined note for compact range selector", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-range-process-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "range day one", response: "captured first day", date: "2026-06-08" })
  );
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "09", "rollout-2026-06-09T10-00-00-s2.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s2", turnId: "t2", prompt: "range day two", response: "captured second day", date: "2026-06-09" })
  );

  let receivedInput;
  try {
    const result = await processRollup({
      repo: dir,
      selector: "20260608-20260609",
      summaryRunner: fakeSummaryRunner(async (input) => {
        receivedInput = input;
        return {
          schema: "rollup.output.v1",
          markdown: "## Combined range\n\nThe range note spans two days.",
          sourceCaveats: []
        };
      })
    });

    assert.equal(result.processed, 2);
    assert.deepEqual(result.period, rangePeriod("2026-06-08", "2026-06-09"));
    assert.equal(path.basename(result.note.path), "2026-06-08--2026-06-09.md");
    assert.deepEqual(receivedInput.period, rangePeriod("2026-06-08", "2026-06-09"));
    assert.equal(receivedInput.conversations.length, 2);

    const note = await readFile(result.note.path, "utf8");
    assert.match(note, /Combined range/);
    assert.match(note, /period=2026-06-08--2026-06-09 schema=rollup.note.v1/);

    const loaded = await loadConfig({ repo: dir });
    const ledgerRows = await readLedger(loaded.paths.ledgerPath);
    assert.equal(ledgerRows.length, 2);
    assert.deepEqual([...new Set(ledgerRows.map((row) => row.rollupKey))], ["2026-06-08--2026-06-09"]);
    const rollupArtifacts = await readdir(path.join(loaded.paths.rollupsDir, "2026-06-08--2026-06-09"));
    assert.equal(rollupArtifacts.some((file) => file.startsWith("input.") && file.endsWith(".json")), true);
    assert.equal(rollupArtifacts.some((file) => file.startsWith("output.") && file.endsWith(".json")), true);
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup writes one combined note for --from and --to range", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-range-fromto-process-"));
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");

  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "from day one", response: "captured first", date: "2026-06-08" })
  );
  await writeJsonl(
    path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "09", "rollout-2026-06-09T10-00-00-s2.jsonl"),
    codexNativeSession({ repo: dir, sessionId: "s2", turnId: "t2", prompt: "to day two", response: "captured second", date: "2026-06-09" })
  );

  try {
    const result = await processRollup({
      repo: dir,
      from: new Date("2026-06-08T00:00:00.000Z"),
      to: new Date("2026-06-09T00:00:00.000Z"),
      summaryRunner: fakeSummaryRunner(async () => ({
        schema: "rollup.output.v1",
        markdown: "## From-to combined",
        sourceCaveats: []
      }))
    });

    assert.equal(result.processed, 2);
    assert.equal(result.period.key, "2026-06-08--2026-06-09");
    assert.equal(path.basename(result.note.path), "2026-06-08--2026-06-09.md");
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("rollup path accepts compact range selectors", async () => {
  const loaded = await loadedConfig();
  const originalLog = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(String(line));
    await runRollupCli(["path", "20260608-20260609", "--repo", loaded.repo.root]);
  } finally {
    console.log = originalLog;
  }
  assert.equal(lines.at(-1), path.join(loaded.paths.notesDir, "2026-06-08--2026-06-09.md"));
});

test("processRollup supports --filename as notesDir target", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-filename-option-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "filename option", response: "done" }));

  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      filename: "design.md",
      summaryRunner: fakeSummaryRunner(async () => ({
        schema: "rollup.output.v1",
        markdown: "## Filename rollup",
        sourceCaveats: []
      }))
    });

    const loaded = await loadConfig({ repo: dir });
    assert.equal(result.note.path, path.join(loaded.paths.notesDir, "design.md"));
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("processRollup writes explicit output path and falls back when no generated block exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-output-option-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  process.env.CODEX_HOME = path.join(dir, "codex-home");
  const previousRollupHome = process.env.TANGENT_ROLLUP_HOME;
  const previousUsageHome = process.env.USAGE_HOME;
  const previousCodexHome = process.env.CODEX_HOME;

  const outputPath = path.join(dir, "notes", "design.md");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "# existing manual note\n", "utf8");
  const nativePath = path.join(process.env.CODEX_HOME, "sessions", "2026", "06", "08", "rollout-2026-06-08T10-00-00-s1.jsonl");
  await writeJsonl(nativePath, codexNativeSession({ repo: dir, sessionId: "s1", turnId: "t1", prompt: "explicit output", response: "done" }));

  try {
    const result = await processRollup({
      repo: dir,
      date: "2026-06-08",
      output: "notes/design.md",
      summaryRunner: fakeSummaryRunner(async () => ({
        schema: "rollup.output.v1",
        markdown: "## Explicit output rollup",
        sourceCaveats: []
      }))
    });

    assert.equal(result.note.path, path.join(dir, "notes", "design.generated.md"));
    const written = await readFile(path.join(dir, "notes", "design.generated.md"), "utf8");
    assert.match(written, /Explicit output rollup/);
    const original = await readFile(outputPath, "utf8");
    assert.equal(original, "# existing manual note\n");
  } finally {
    if (previousRollupHome === undefined) delete process.env.TANGENT_ROLLUP_HOME;
    else process.env.TANGENT_ROLLUP_HOME = previousRollupHome;
    if (previousUsageHome === undefined) delete process.env.USAGE_HOME;
    else process.env.USAGE_HOME = previousUsageHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

/** Writes JSONL records to a test transcript path. */
async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

/** Builds a minimal Codex native transcript for one visible user/assistant turn. */
function codexNativeSession({ repo, sessionId, turnId, prompt, response, date = "2026-06-08", hour = "10", includeTaskComplete = true }) {
  const isoPrefix = `${date}T${hour}:00:`;
  const records = [
    {
      timestamp: `${isoPrefix}00.000Z`,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: `${isoPrefix}00.000Z`,
        cwd: repo,
        originator: "codex-tui",
        cli_version: "0.137.0",
        source: "cli",
        git: { branch: "main", commit_hash: "abc" }
      }
    },
    { timestamp: `${isoPrefix}01.000Z`, type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { timestamp: `${isoPrefix}02.000Z`, type: "turn_context", payload: { turn_id: turnId, cwd: repo, model: "gpt-5.5" } },
    { timestamp: `${isoPrefix}03.000Z`, type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: `${isoPrefix}04.000Z`, type: "event_msg", payload: { type: "agent_message", message: response, phase: "final_answer" } }
  ];
  if (includeTaskComplete) {
    records.push({ timestamp: `${isoPrefix}05.000Z`, type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 5000 } });
  }
  return records;
}

/** Builds a Codex native transcript that includes tool and token events. */
function codexNativeToolSession({ repo, sessionId, turnId, prompt, date = "2026-06-08" }) {
  const isoPrefix = `${date}T10:00:`;
  return [
    {
      timestamp: `${isoPrefix}00.000Z`,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: `${isoPrefix}00.000Z`,
        cwd: repo,
        originator: "codex-tui",
        cli_version: "0.137.0",
        source: "cli",
        git: { branch: "main", commit_hash: "abc" }
      }
    },
    { timestamp: `${isoPrefix}01.000Z`, type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { timestamp: `${isoPrefix}02.000Z`, type: "turn_context", payload: { turn_id: turnId, cwd: repo, model: "gpt-5.5" } },
    { timestamp: `${isoPrefix}03.000Z`, type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: `${isoPrefix}04.000Z`, type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call1", arguments: JSON.stringify({ cmd: "npm test", workdir: repo }) } },
    { timestamp: `${isoPrefix}05.000Z`, type: "response_item", payload: { type: "function_call_output", call_id: "call1", output: "Process exited with code 0\nok" } },
    {
      timestamp: `${isoPrefix}06.000Z`,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 11, output_tokens: 7 },
          total_token_usage: { input_tokens: 11, output_tokens: 7 }
        }
      }
    },
    { timestamp: `${isoPrefix}07.000Z`, type: "event_msg", payload: { type: "agent_message", message: "assistant found this bug", phase: "final_answer" } },
    { timestamp: `${isoPrefix}08.000Z`, type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 5000 } }
  ];
}
