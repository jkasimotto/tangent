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
  assert.match((await catalog.options("otto", "all")).error, /not valid JSON/);
  await assert.rejects(catalog.commandForArea("otto"), /not valid JSON/);
});

test("launch catalog rejects incomplete registry choices instead of listing guessed ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-invalid-options-"));
  await writeFile(path.join(root, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({
      version: 1,
      modelSets: { broken: [{ args: "--model missing-id" }] },
      effortSets: {},
      harnesses: [{ id: "codex", command: "codex", modelSet: "broken" }],
    }),
    "```",
  ].join("\n"));
  const catalog = createLaunchCatalog({
    root,
    /** Supplies no Area declarations for this registry-only failure. */
    readAreaNote: async () => "",
  });

  const options = await catalog.options("elsewhere", "all");
  assert.match(options.error, /model option.*has no id/);
  assert.equal(options.harnesses, undefined);
});

test("launch catalog lists inherited codex defaults and model-specific efforts from one snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-options-"));
  await mkdir(path.join(root, "otto", "tangent"), { recursive: true });
  await writeFile(path.join(root, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({
      version: 1,
      modelSets: { codex: [{ id: "sol", args: "--model gpt-sol", effortSet: "sol" }] },
      effortSets: { codex: [{ id: "low", args: "-c effort=low" }], sol: [{ id: "low", args: "-c effort=low" }, { id: "ultra", args: "-c effort=ultra" }] },
      harnesses: [{ id: "codex", command: "codex", modelSet: "codex", effortSet: "codex" }],
    }),
    "```",
  ].join("\n"));
  const declaration = "```tangent.environment.v1\n{\"defaults\":{\"launch\":{\"harness\":\"codex\",\"model\":\"sol\",\"effort\":\"low\"},\"brain\":{\"harness\":\"codex\",\"model\":\"sol\",\"effort\":\"low\"}}}\n```";
  const catalog = createLaunchCatalog({
    root,
    /** Makes the child inherit both defaults from its parent Area. */
    readAreaNote: async (area) => area === "otto" ? declaration : "",
  });

  const options = await catalog.options("otto/tangent", "all");
  assert.equal(options.source, path.join(root, "harnesses.md"));
  assert.equal(options.workDefault.command, "codex --model gpt-sol -c effort=low");
  assert.equal(options.brainDefault.command, "codex --model gpt-sol -c effort=low");
  assert.deepEqual(options.harnesses[0].models[0].efforts.map((effort) => effort.id), ["low", "ultra"]);
  assert.equal(options.harnesses[0].models[0].efforts[1].command, "codex --model gpt-sol -c effort=ultra");
});

test("brain launch resolution uses brain, then work, then a named Area error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-brain-"));
  await writeFile(path.join(root, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({
      version: 1,
      harnesses: [
        { id: "work", command: "work-agent" },
        { id: "brain", command: "brain-agent" },
      ],
    }),
    "```",
  ].join("\n"));
  const notes = new Map([
    ["declared", "```tangent.environment.v1\n{\"defaults\":{\"launch\":{\"harness\":\"work\"},\"brain\":{\"harness\":\"brain\"}}}\n```"],
    ["work-only", "```tangent.environment.v1\n{\"defaults\":{\"launch\":{\"harness\":\"work\"}}}\n```"],
  ]);
  /** Reads one Area note from the launch-resolution fixture. */
  const readAreaNote = async (area) => notes.get(area) ?? "";
  const catalog = createLaunchCatalog({ root, readAreaNote });

  assert.equal((await catalog.forBrain("declared/child")).command, "brain-agent");
  assert.equal((await catalog.forBrain("work-only/child")).command, "work-agent");
  assert.deepEqual(await catalog.forBrain("undeclared/child"), {
    error: "undeclared/child: no brain or work launch is declared",
  });
});

test("launch catalog reports non-otto inherited defaults without an otto fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-launch-catalog-non-otto-"));
  await mkdir(path.join(root, "client", "product"), { recursive: true });
  await writeFile(path.join(root, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({
      version: 1,
      modelSets: { local: [{ id: "small", args: "--model small" }] },
      effortSets: {},
      harnesses: [{ id: "local", command: "agent", modelSet: "local" }],
    }),
    "```",
  ].join("\n"));
  const declaration = "```tangent.environment.v1\n{\"defaults\":{\"launch\":{\"harness\":\"local\",\"model\":\"small\"},\"brain\":{\"harness\":\"local\",\"model\":\"small\"}}}\n```";
  const catalog = createLaunchCatalog({
    root,
    /** Makes the child inherit both defaults from its non-otto parent Area. */
    readAreaNote: async (area) => area === "client" ? declaration : "",
  });

  const options = await catalog.options("client/product", "all");
  assert.equal(options.workDefault.command, "agent --model small");
  assert.equal(options.brainDefault.command, "agent --model small");
  assert.equal(options.workDefault.source, "client");
  assert.equal(options.brainDefault.source, "client");
});
