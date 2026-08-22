import assert from "node:assert/strict";
import test from "node:test";

import { runStudyCli, studyCommandSpec, STUDY_CONTRACT, studyLaunchCommand } from "../dist/cli/index.js";

test("tangent study has one subcommand: contract", () => {
  assert.equal(studyCommandSpec.name, "study");
  assert.deepEqual(studyCommandSpec.subcommands.map((entry) => entry.name), ["contract"]);
});

test("studyLaunchCommand expands the claude-otto alias and appends the contract", () => {
  const { command, args, env } = studyLaunchCommand("X");
  assert.equal(command, "claude");
  assert.deepEqual(args.slice(-2), ["--append-system-prompt", "X"]);
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.ok(env.CLAUDE_CONFIG_DIR.endsWith("/.claude-otto"));
});

test("STUDY_CONTRACT pins the record path, worktree convention, opening, and ending", () => {
  assert.ok(STUDY_CONTRACT.includes("~/.tangent/study/records/"));
  assert.match(STUDY_CONTRACT, /-study/);
  assert.match(STUDY_CONTRACT, /git worktree add/);
  assert.match(STUDY_CONTRACT, /branch "study"/);
  assert.match(STUDY_CONTRACT, /What do you want to be able to explain\?/);
  assert.match(STUDY_CONTRACT, /keep or discard/);
});

test("STUDY_CONTRACT pins the no-verdict and facts-only sentences", () => {
  assert.match(STUDY_CONTRACT, /no praise,\s+no\s+verdict words/i);
  assert.ok(STUDY_CONTRACT.includes("facts only"));
});

test("tangent study --help prints the spec and does not spawn", async () => {
  const printed = [];
  const log = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  try {
    await runStudyCli(["--help"]);
  } finally {
    console.log = log;
  }
  assert.match(printed.join("\n"), /contract/);
  assert.match(printed.join("\n"), /tangent study contract/);
});

test("tangent study rejects an unknown subcommand by name", async () => {
  await assert.rejects(runStudyCli(["explore"]), /Unknown study command: explore/);
});

test("tangent study contract prints the contract text", async () => {
  const printed = [];
  const log = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  try {
    await runStudyCli(["contract"]);
  } finally {
    console.log = log;
  }
  assert.equal(printed.join("\n"), STUDY_CONTRACT);
});
