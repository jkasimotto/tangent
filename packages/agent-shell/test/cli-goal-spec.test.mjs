import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec, jobCommandSpec } from "../dist/cli/index.js";

test("Goal help contains intent commands and hides execution aliases", () => {
  const names = goalCommandSpec.subcommands.map((entry) => entry.name);
  assert.deepEqual(names, ["present", "create", "list", "show", "depend", "undepend", "own", "release", "done", "wont-do", "park", "reopen"]);
  for (const alias of ["start", "append", "replace-agent"]) assert.equal(names.includes(alias), false);
  assert.match(goalCommandSpec.description, /Goal intent/);
});

test("Job help publishes the accepted execution contract", () => {
  assert.deepEqual(jobCommandSpec.subcommands.map((entry) => entry.name), ["create", "show", "start", "append", "advance", "stop", "replace"]);
  assert.equal(jobCommandSpec.subcommands.find((entry) => entry.name === "show").args, "<goal>");
  assert.equal(jobCommandSpec.subcommands.find((entry) => entry.name === "advance").args, "<goal> <n>");
  assert.ok(jobCommandSpec.subcommands.find((entry) => entry.name === "replace").options.some((entry) => entry.name === "expected-attempt"));
});

test("Goal create keeps the Brain composite start operation", () => {
  const create = goalCommandSpec.subcommands.find((entry) => entry.name === "create");
  const options = create.options.map((entry) => entry.name);
  for (const name of ["start", "path", "launch", "verify", "instruction", "own", "session"]) assert.ok(options.includes(name), name);
});
