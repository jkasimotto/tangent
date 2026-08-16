import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec } from "../dist/cli/index.js";

/** Finds one named subcommand in the goal command spec. */
const subcommand = (name) => goalCommandSpec.subcommands.find((entry) => entry.name === name);
/** Lists the option names one spec entry accepts. */
const optionNames = (entry) => entry.options.map((option) => option.name);

test("tangent goal start takes a slug and repeatable step, launch, and continue-from options", () => {
  const start = subcommand("start");
  assert.ok(start, "goal spec has a start subcommand");
  assert.equal(start.args, "<slug>");
  assert.deepEqual(optionNames(start), ["step", "launch", "continue-from", "server", "json"]);
  for (const name of ["step", "launch", "continue-from"]) {
    const option = start.options.find((entry) => entry.name === name);
    assert.equal(option.takesValue, true, `${name} takes a value`);
    assert.match(option.description, /repeatable/i, `${name} is documented as repeatable`);
  }
});

test("tangent goal append takes a slug and the same repeatable step options as start", () => {
  const append = subcommand("append");
  assert.ok(append, "goal spec has an append subcommand");
  assert.equal(append.args, "<slug>");
  assert.deepEqual(optionNames(append), ["step", "launch", "continue-from", "server", "json"]);
  assert.match(append.description, /without restarting/);
});

test("tangent goal handover takes the facts and an optional session", () => {
  const handover = subcommand("handover");
  assert.ok(handover, "goal spec has a handover subcommand");
  assert.equal(handover.args, "<facts...>");
  assert.deepEqual(optionNames(handover), ["session", "server"]);
  assert.match(handover.description, /facts/);
});

test("goal help still lists the vault commands beside start and handover", () => {
  assert.deepEqual(
    goalCommandSpec.subcommands.map((entry) => entry.name),
    ["create", "list", "show", "own", "release", "start", "append", "handover", "done", "wont-do"]
  );
});
