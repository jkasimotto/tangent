import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLaunchCatalog } from "./launch-catalog.mjs";
import { createLaunchMemory } from "./launch-memory.mjs";
import { resolveBrainAttemptLaunch } from "./brain-launch.mjs";
import { migrateEnvironmentV1, parseEnvironmentBlock } from "./launch-environment.mjs";

const registry = {
  version: 2,
  modelSets: { codex: [{ id: "sol" }], claude: [{ id: "opus" }] },
  harnesses: [
    { id: "codex", command: "codex", modelSet: "codex" },
    { id: "claude-otto", command: "claude-otto", modelSet: "claude" },
    { id: "claude-gw", command: "claude-gw", modelSet: "claude" },
  ],
};

/** Renders one policy note fixture. */
function note(allow) {
  return allow ? `\`\`\`tangent.environment.v2\n${JSON.stringify({ version: 2, allow })}\n\`\`\`` : "";
}

/** Creates a read-only catalog fixture with isolated memory. */
async function fixture(notes) {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-launch-policy-"));
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const memory = createLaunchMemory(path.join(root, "runtime", "launch-memory.json"));
  return createLaunchCatalog({ root,
    /** Reads one note fixture. */
    readAreaNote: async (area) => notes[area] ?? "", memory });
}

test("Otto and Neara policies isolate harnesses", async () => {
  const catalog = await fixture({ otto: note(["codex", "claude-otto"]), neara: note(["claude-gw"]) });
  assert.equal((await catalog.allowed("otto/tangent", { harness: "claude-gw", model: "opus" })).code, "launch-not-allowed");
  assert.equal((await catalog.allowed("neara/pgande", { harness: "claude-otto", model: "opus" })).code, "launch-not-allowed");
  assert.equal((await catalog.allowed("otto/tangent", { harness: "codex", model: "sol" })).command, "codex");
});

test("child policies intersect with ancestors and cannot widen them", async () => {
  const catalog = await fixture({ otto: note(["codex", "claude-otto"]), "otto/tangent": note(["codex/sol"]) });
  const policy = await catalog.policyFor("otto/tangent/ui");
  assert.deepEqual(policy.declaredBy, ["otto/tangent", "otto"]);
  assert.deepEqual(policy.launches.map((entry) => entry.harness), ["codex"]);
  assert.equal((await catalog.allowed("otto/tangent", { harness: "claude-otto", model: "opus" })).code, "launch-not-allowed");
});

test("stale exact memory falls back to the nearest valid ancestor memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-launch-memory-"));
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const memory = createLaunchMemory(path.join(root, "runtime", "launch-memory.json"));
  const catalog = createLaunchCatalog({ root,
    /** Reads the parent policy fixture. */
    readAreaNote: async (area) => area === "otto" ? note(["codex"]) : "", memory });
  await memory.write("otto", "work", { harness: "codex", model: "sol" });
  await memory.write("otto/tangent", "work", { harness: "claude-otto", model: "opus" });
  assert.deepEqual(await catalog.remembered("otto/tangent", "work"), { harness: "codex", model: "sol", source: "otto" });
});

test("unrestricted Areas do not invent a first-use choice", async () => {
  const catalog = await fixture({});
  assert.equal(await catalog.remembered("fresh", "brain"), null);
});

test("brain launch resolution returns a clear cross-scope refusal", async () => {
  const catalog = await fixture({ neara: note(["claude-gw"]) });
  const result = await resolveBrainAttemptLaunch({ area: "neara", choice: { harness: "claude-otto", model: "opus" }, launchCatalog: catalog });
  assert.equal(result.status, 403);
  assert.equal(result.code, "launch-not-allowed");
  assert.equal(result.area, "neara");
  assert.deepEqual(result.allowed, ["claude-gw"]);
});

test("migration removes v1 defaults and keeps their launch refs for memory seeding", () => {
  const original = `# Neara\n\n\`\`\`tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"pi-code","model":"glm"},"brain":{"harness":"claude"}}}\n\`\`\``;
  const migrated = migrateEnvironmentV1(original, ["claude-gw", "codex-gw", "pi-code", "opencode"]);
  assert.deepEqual(migrated.defaults, { launch: { harness: "pi-code", model: "glm" }, brain: { harness: "claude" } });
  assert.doesNotMatch(migrated.text, /tangent\.environment\.v1/);
  assert.deepEqual(parseEnvironmentBlock(migrated.text).allow.map((entry) => entry.harness), ["claude-gw", "codex-gw", "pi-code", "opencode"]);
});

test("policy writes reject widening and an empty descendant", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-launch-write-"));
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const notes = { otto: note(["codex"]), "otto/tangent": note(["codex/sol"]) };
  const repository = {
    /** Stores one proposed note in the fixture. */
    async writeMarkdown(file, text) { notes[file.replace(/\/[^/]+\.md$/, "")] = text; },
  };
  const catalog = createLaunchCatalog({
    root,
    /** Reads one mutable note fixture. */
    readAreaNote: async (area) => notes[area] ?? "",
    repository,
    /** Accepts a fixture commit. */
    commit: async () => {},
    /** Maps an Area to its note path. */
    areaFile: (area) => `${area}/${area.split("/").at(-1)}.md`,
    /** Supplies an empty fixture note. */
    emptyAreaNote: () => "",
    /** Lists the fixture subtree. */
    listAreas: async () => ["otto", "otto/tangent"],
  });
  assert.equal((await catalog.savePolicy("otto/tangent", ["claude-otto"])).code, "policy-widens");
  assert.equal((await catalog.savePolicy("otto", ["claude-otto"])).code, "policy-empties-child");
});
