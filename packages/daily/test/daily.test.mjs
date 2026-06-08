import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageDataset } from "../../usage/dist/core/dataset.js";
import { eventFileForConversation } from "../../usage/dist/core/paths.js";
import { normalizeHookInput } from "../../usage/dist/hook-runner/normalize-hook-input.js";
import { buildTurnDigestInput } from "../dist/usage/adapter.js";
import { appendLedgerLine } from "../dist/core/ledger.js";
import { loadConfig } from "../dist/core/config.js";
import { readDigestsForDate, writeDailyNote } from "../dist/core/note-writer.js";
import { processUnprocessed } from "../dist/sdk/processUnprocessed.js";

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

test("processUnprocessed renders note from prior and newly processed digests", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-process-"));
  process.env.TANGENT_DAILY_HOME = path.join(dir, "daily-home");
  process.env.USAGE_HOME = path.join(dir, "usage-home");
  const loaded = await loadConfig({ repo: dir });

  const oldPath = path.join(loaded.paths.outputDir, "old-digest.json");
  await mkdir(loaded.paths.outputDir, { recursive: true });
  await writeFile(oldPath, JSON.stringify(digest("Old prior work", "old-hash")), "utf8");
  await appendLedgerLine(loaded.paths.ledgerPath, ledger("old-source", "old-fingerprint", "old-hash", oldPath));

  const repoContext = {
    ...context(),
    repo: {
      inputPath: dir,
      root: dir,
      cwd: dir,
      branch: "main",
      headSha: "abc"
    }
  };
  const events = [
    ...normalizeHookInput(hook("UserPromptSubmit", { prompt: "new work" }), repoContext),
    ...normalizeHookInput(hook("Stop", { last_assistant_message: "done" }), repoContext)
  ].map((event) => ({
    ...event,
    recorded_at: "2026-06-08T10:00:00.000Z",
    observed_at: "2026-06-08T10:00:00.000Z"
  }));
  const eventPath = eventFileForConversation(dir, "codex", "codex:s1");
  await mkdir(path.dirname(eventPath), { recursive: true });
  await writeFile(eventPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

  const result = await processUnprocessed({
    repo: dir,
    date: "2026-06-08",
    summaryRunner: {
      id: "fake",
      kind: "claude-cli",
      checkAvailable: async () => ({ available: true, authStatus: "unknown", warnings: [] }),
      summarizeTurn: async (input) => digestForInput("New processed work", input)
    }
  });

  assert.equal(result.processed, 1);
  const note = await readFile(result.note.path, "utf8");
  assert.match(note, /Old prior work/);
  assert.match(note, /New processed work/);
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
