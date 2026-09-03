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
  assert.match(out, /send <session\|area> <note\.\.\.>/);
  assert.doesNotMatch(out, /^\s+idea\b/m);
  assert.match(out, /Run tangent <command> --help for the exact flags\./);
});

test("completion omits the retired Area capture noun and it is an unknown command", async () => {
  const completion = await tangent("__complete", "");
  assert.equal(completion.split("\n").includes(["id", "ea"].join("")), false);
  const error = await execFileAsync(process.execPath, [cli, ["id", "ea"].join("")])
    .then(() => "", (failure) => String(failure.stderr));
  assert.match(error, /Unknown command/);
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
  const alias = await execFileAsync(process.execPath, [cli, "handover", "--help"])
    .then(() => "", (failure) => String(failure.stderr));
  assert.match(alias, /Unknown command/);
});

test("tangent process start|stop|restart|close still reach tangent service, with a hint", async () => {
  const out = await tangent("help");
  assert.match(out, /^  service <list\|start\|stop\|restart\|close>/m, "help lists tangent service");
  assert.match(out, /^  process <list\|show\|pause\|resume\|check\|dismiss\|restore>/m, "help lists tangent process as repeatable work");
  assert.doesNotMatch(out, /trigger/, "help names no trigger command");
  const stderr = await execFileAsync(process.execPath, [cli, "process", "stop", "nothing", "--area", "otto/nowhere"], { env: { ...process.env, TANGENT_TREES_DIR: "/nonexistent" } })
    .then(() => "", (error) => String(error.stderr));
  assert.match(stderr, /hint: servers and watchers are `tangent service` now/);
});
