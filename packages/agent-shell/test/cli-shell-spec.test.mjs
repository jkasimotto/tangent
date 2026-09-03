import assert from "node:assert/strict";
import test from "node:test";

import { runShellCli, shellCommandSpec } from "../dist/cli/index.js";

/** Finds one named subcommand in the shell command spec. */
const subcommand = (name) => shellCommandSpec.subcommands.find((entry) => entry.name === name);
/** Lists the option names one spec entry accepts. */
const optionNames = (entry) => entry.options.map((option) => option.name);

test("tangent shell specifies rebuild and explicit launch-policy repair", () => {
  assert.equal(shellCommandSpec.name, "shell");
  assert.deepEqual(shellCommandSpec.subcommands.map((entry) => entry.name), ["rebuild", "migrate-launch-policy"]);
  const rebuild = subcommand("rebuild");
  assert.deepEqual(optionNames(rebuild), ["server", "timeout"]);
  assert.equal(rebuild.options.find((option) => option.name === "timeout").takesValue, true);
  assert.match(rebuild.description, /return when the new boot answers/);
  const migrate = subcommand("migrate-launch-policy");
  assert.deepEqual(optionNames(migrate), ["server", "dry-run"]);
  assert.equal(migrate.options.find((option) => option.name === "dry-run").takesValue, undefined);
  assert.match(migrate.description, /explicit per-Area harnesses\.md contracts/);
});

test("tangent shell --help prints the spec and does not call the server", async () => {
  const printed = [];
  const log = console.log;
  console.log = (...parts) => printed.push(parts.join(" "));
  try {
    await runShellCli(["--help"]);
    await runShellCli([]);
  } finally {
    console.log = log;
  }
  assert.match(printed.join("\n"), /rebuild/);
  assert.match(printed.join("\n"), /tangent shell rebuild --timeout 600/);
  assert.match(printed.join("\n"), /tangent shell migrate-launch-policy --dry-run/);
});

test("tangent shell rejects an unknown subcommand by name", async () => {
  await assert.rejects(runShellCli(["restart"]), /Unknown shell command: restart/);
});
