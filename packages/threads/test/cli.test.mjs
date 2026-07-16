import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveWhyLineRunner, runThreadsCli } from "../dist/cli/index.js";
import { ClaudeCliWhyLineRunner } from "../dist/sdk/index.js";

/** Runs the threads CLI with an isolated TANGENT_HOME, capturing printed lines. */
async function runCapturing(argv, home) {
  const previousHome = process.env.TANGENT_HOME;
  const previousTrees = process.env.TANGENT_TREES_DIR;
  process.env.TANGENT_HOME = home;
  process.env.TANGENT_TREES_DIR = path.join(home, ".tangent", "trees");
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await runThreadsCli(argv);
  } finally {
    console.log = originalLog;
    if (previousHome === undefined) delete process.env.TANGENT_HOME;
    else process.env.TANGENT_HOME = previousHome;
    if (previousTrees === undefined) delete process.env.TANGENT_TREES_DIR;
    else process.env.TANGENT_TREES_DIR = previousTrees;
  }
  return lines;
}

test("register then attach roundtrips through the sidecar registry", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-threads-cli-"));

  const registerLines = await runCapturing([
    "register", "guy-wires",
    "--node", "neara/pgande",
    "--worktree", "/tmp/otto-guy-wires",
    "--tmux", "tg-guy-wires",
    "--session", "sess-abc123"
  ], home);
  assert.ok(registerLines.some((line) => line.includes("registered guy-wires")));
  assert.ok(registerLines.some((line) => line.includes("tg-guy-wires")));

  const attachLines = await runCapturing(["attach", "guy-wires"], home);
  assert.deepEqual(attachLines, ["tmux -CC attach -t tg-guy-wires"]);
});

test("register without --session leaves the registry entry session-less until a sweep resolves it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-threads-cli-no-session-"));

  const registerLines = await runCapturing([
    "register", "clearances",
    "--node", "neara/pgande/autodesign",
    "--worktree", "/tmp/otto-clearances",
    "--tmux", "tg-clearances"
  ], home);
  assert.ok(registerLines.some((line) => line.includes("registered clearances")));
  assert.ok(!registerLines.some((line) => line.includes("session=")));

  const attachLines = await runCapturing(["attach", "clearances"], home);
  assert.deepEqual(attachLines, ["tmux -CC attach -t tg-clearances"]);
});

test("attach on an unknown slug errors clearly", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-threads-cli-unknown-"));
  await assert.rejects(runThreadsCliInHome(["attach", "no-such-thread"], home), /No registered thread named "no-such-thread"/);
});

/** Runs the CLI with an isolated home, letting errors propagate instead of being swallowed by process.exitCode. */
async function runThreadsCliInHome(argv, home) {
  const previousHome = process.env.TANGENT_HOME;
  process.env.TANGENT_HOME = home;
  try {
    await runThreadsCli(argv);
  } finally {
    if (previousHome === undefined) delete process.env.TANGENT_HOME;
    else process.env.TANGENT_HOME = previousHome;
  }
}

test("list reports no sweep has run yet when threads.md is missing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-threads-cli-list-"));
  const lines = await runCapturing(["list"], home);
  assert.deepEqual(lines, ["No sweep has run yet. Run: tangent threads sweep"]);
});

test("sweep wires the haiku why-line runner by default, but never for --dry-run or --no-model", () => {
  assert.ok(resolveWhyLineRunner({ dryRun: false, noModel: false }) instanceof ClaudeCliWhyLineRunner);
  assert.equal(resolveWhyLineRunner({ dryRun: true, noModel: false }), undefined);
  assert.equal(resolveWhyLineRunner({ dryRun: false, noModel: true }), undefined);
  assert.equal(resolveWhyLineRunner({ dryRun: true, noModel: true }), undefined);
});
