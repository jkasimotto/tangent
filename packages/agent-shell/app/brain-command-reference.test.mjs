import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";

import {
  BRAIN_COMMAND_NOUNS,
  defaultCliEntry,
  installedCommandReference,
  parseCommandHelp,
  renderCommandReference,
} from "./brain-command-reference.mjs";

const execFileAsync = promisify(execFile);

test("the reference parses the installed CLI's own help layout", () => {
  const parsed = parseCommandHelp([
    "goal",
    "",
    "Create and close Goals",
    "",
    "Commands:",
    "  create           Create a Goal",
    "  list [area]      List Goals",
    "",
    "Examples:",
    "  tangent goal list otto/dnd",
  ].join("\n"));
  assert.equal(parsed.description, "Create and close Goals");
  assert.deepEqual(parsed.subcommands.map((item) => item.signature), ["create", "list [area]"]);
  assert.equal(
    renderCommandReference([{ name: "goal", ...parsed }]),
    "- `tangent goal` (Create and close Goals): create | list [area]",
  );
});

test("the reference reflects the real --help of every brain noun", async (context) => {
  const cli = defaultCliEntry();
  if (!existsSync(cli)) {
    context.skip("Build Tangent before this test.");
    return;
  }
  const reference = await installedCommandReference();
  assert.ok(reference, "the installed CLI produced a reference");
  for (const noun of BRAIN_COMMAND_NOUNS) {
    const { stdout } = await execFileAsync(process.execPath, [cli, noun, "--help"]);
    const help = parseCommandHelp(stdout);
    const line = reference.split("\n").find((item) => item.startsWith(`- \`tangent ${noun}\``));
    assert.ok(line, `the reference names tangent ${noun}`);
    assert.ok(line.includes(help.description), `tangent ${noun} carries its installed description`);
    for (const command of help.subcommands) {
      assert.ok(
        line.includes(command.signature),
        `tangent ${noun} ${command.signature} is in the reference, so the CLI cannot drift from the prompt`,
      );
    }
    assert.equal(
      help.subcommands.length,
      line.split("): ")[1].split(" | ").length,
      `tangent ${noun} lists exactly its installed subcommands`,
    );
  }
});

test("a missing build leaves the prompt to fall back instead of failing", async () => {
  assert.equal(await installedCommandReference({ cli: "/nonexistent/tangent/cli.js" }), null);
});
