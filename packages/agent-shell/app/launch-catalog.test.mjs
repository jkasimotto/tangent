import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLaunchCatalog } from "./launch-catalog.mjs";

test("launch catalog owns registry and inherited Area resolution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-"));
  await mkdir(path.join(root, "otto", "tangent"), { recursive: true });
  await writeFile(path.join(root, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({ version: 1, harnesses: [{ id: "codex", command: "codex" }] }),
    "```",
  ].join("\n"));
  const catalog = createLaunchCatalog({
    root,
    /** Returns the fixture Area note. */
    readAreaNote: async (area) => area === "otto/tangent"
      ? "```tangent.environment.v1\n{\"defaults\":{\"launch\":{\"harness\":\"codex\"}}}\n```"
      : "",
  });
  assert.equal((await catalog.forArea("otto/tangent")).command, "codex");
  assert.equal(await catalog.commandForArea("otto/tangent"), "codex");
  assert.deepEqual(await catalog.requested({ command: "claude --model opus" }), {
    command: "claude --model opus",
    label: "Edited command",
  });
});

test("launch catalog reports broken durable declarations without substitution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-error-"));
  await writeFile(path.join(root, "harnesses.md"), "```tangent.harnesses.v1\n{bad}\n```\n");
  const catalog = createLaunchCatalog({
    root,
    /** Returns an empty fixture Area note. */
    readAreaNote: async () => "",
  });
  assert.match((await catalog.forArea("otto")).error, /not valid JSON/);
  await assert.rejects(catalog.commandForArea("otto"), /not valid JSON/);
});
