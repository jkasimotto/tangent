import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "cli", "index.js");

/** Runs the built root CLI with the given arguments and returns stdout. */
async function tangent(...args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args]);
  return stdout;
}

test("tangent help groups commands by who runs them and names no removed verb", async () => {
  const out = await tangent("help");
  assert.match(out, /^Brains:$/m);
  assert.match(out, /^Workers:$/m);
  assert.match(out, /^Julian:$/m);
  assert.ok(out.indexOf("Brains:") < out.indexOf("Workers:") && out.indexOf("Workers:") < out.indexOf("Julian:"));
  for (const removed of ["brain handover", "goal handover", "handover <facts", "pacing", "checkpoint", "designated review", "completion policy"]) {
    assert.equal(out.includes(removed), false, `help names the removed "${removed}"`);
  }
  assert.match(out, /send <brain\|session\|area> <note\.\.\.>/);
  assert.match(out, /Run tangent <command> --help for the exact flags\./);
});

test("tangent brain --help and tangent goal --help match the commands that exist", async () => {
  const brain = await tangent("brain", "--help");
  assert.doesNotMatch(brain, /handover/, "brain help names no handover");
  assert.doesNotMatch(brain, /kind[^\n]*\btest\b/, "brain help offers no test request");
  const goal = await tangent("goal", "--help");
  assert.doesNotMatch(goal, /^\s+handover/m, "goal handover is hidden from help");
  assert.doesNotMatch(goal, /designated review/i);
  const create = await tangent("goal", "create", "--help");
  for (const flag of ["--start", "--path", "--launch", "--verify", "--instruction", "--instruction-file", "--done-when"]) assert.match(create, new RegExp(flag), `goal create --help names ${flag}`);
  assert.match(create, /^tangent goal create$/m);
  const alias = await tangent("handover", "--help");
  assert.match(alias, /Replaced by tangent send brain/);
});
