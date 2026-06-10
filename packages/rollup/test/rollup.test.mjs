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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async (input) => {
          receivedInput = input;
          return {
            schema: "rollup.output.v1",
            markdown: "## Design brief",
            sourceCaveats: []
          };
        }
      }
    });

    assert.equal(receivedInput?.purpose?.request, "Create a design brief on data-driven simulations");
    assert.deepEqual(receivedInput?.purpose?.focusTerms, ["data-driven simulation", "timeline", "event queue"]);
    assert.equal(receivedInput?.purpose?.kind, "design-brief");
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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async () => ({
          schema: "rollup.output.v1",
          markdown: "## From-to combined",
          sourceCaveats: []
        })
      }
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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async () => ({
          schema: "rollup.output.v1",
          markdown: "## Filename rollup",
          sourceCaveats: []
        })
      }
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
      summaryRunner: {
        id: "fake",
        kind: "codex-cli",
        checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
        summarizeRollup: async () => ({
          schema: "rollup.output.v1",
          markdown: "## Explicit output rollup",
          sourceCaveats: []
        })
      }
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
