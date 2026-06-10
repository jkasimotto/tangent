import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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

async function loadedConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), "rollup-test-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  return loadConfig({ repo: dir });
}

function dayPeriod(date) {
  return { kind: "day", date, startDate: date, endDate: date, key: date, label: date };
}

function rangePeriod(startDate, endDate) {
  return { kind: "range", startDate, endDate, key: `${startDate}--${endDate}`, label: `${startDate} to ${endDate}` };
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

test("rollup prompt asks for user-knowledge prose instead of assistant work bullets", () => {
  const prompt = rollupPrompt({ period: dayPeriod("2026-06-08"), inputPath: "/tmp/rollup-input.json" });
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
    timeoutMs: 5000,
    maxTurns: 1
  });
  const previousCapturePath = process.env.CAPTURE_ARGS_PATH;
  process.env.CAPTURE_ARGS_PATH = argsPath;
  try {
    const output = await runner.summarizeRollup({
      schema: "rollup.input.v1",
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
      summaryRunner: {
        id: "fake",
        kind: "claude-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async (input) => {
          receivedInput = input;
          return {
            schema: "rollup.output.v1",
            markdown: "## New processed work\n\n- Wrote one roll-up.",
            sourceCaveats: []
          };
        }
      }
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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async (input) => {
          dayCalls += 1;
          receivedInput = input;
          return {
            schema: "rollup.output.v1",
            markdown: "## Native transcript rollup\n\n- Added a single day-level rollup path.",
            sourceCaveats: ["test caveat"]
          };
        }
      }
    });

    assert.equal(result.processed, 1);
    assert.equal(dayCalls, 1);
    assert.equal(receivedInput.schema, "rollup.input.v1");
    assert.deepEqual(receivedInput.period, dayPeriod("2026-06-08"));
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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async (input) => {
          receivedInput = input;
          return {
            schema: "rollup.output.v1",
            markdown: "## Combined range\n\nThe range note spans two days.",
            sourceCaveats: []
          };
        }
      }
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

async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function codexNativeSession({ repo, sessionId, turnId, prompt, response, date = "2026-06-08" }) {
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
    { timestamp: `${isoPrefix}04.000Z`, type: "event_msg", payload: { type: "agent_message", message: response, phase: "final_answer" } },
    { timestamp: `${isoPrefix}05.000Z`, type: "event_msg", payload: { type: "task_complete", turn_id: turnId, duration_ms: 5000 } }
  ];
}
