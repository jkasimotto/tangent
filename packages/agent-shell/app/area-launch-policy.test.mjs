import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLaunchCatalog } from "./launch-catalog.mjs";
import { createLaunchMemory } from "./launch-memory.mjs";
import { resolveBrainAttemptLaunch } from "./brain-launch.mjs";
import { areaHarnessContractText, migrateEnvironmentV1, parseAreaHarnessContract, parseEnvironmentBlock } from "./launch-environment.mjs";

const registry = {
  version: 2,
  modelSets: { codex: [{ id: "sol" }], claude: [{ id: "opus" }] },
  harnesses: [
    { id: "codex", command: "codex", modelSet: "codex" },
    { id: "codex-otto", command: "codex --approve-for-me", modelSet: "codex", resume: "{command} resume {id}", transcripts: "~/.codex/sessions" },
    { id: "claude-otto", command: "claude-otto", modelSet: "claude" },
    { id: "claude-gw", command: "claude-gw", modelSet: "claude" },
  ],
};

/** Renders one policy note fixture. */
function note(allow, aliases = undefined) {
  return allow ? `\`\`\`tangent.environment.v2\n${JSON.stringify({ version: 2, allow, ...(aliases ? { aliases } : {}) })}\n\`\`\`` : "";
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
  const catalog = await fixture({ otto: note(["codex-otto", "claude-otto"], { codex: "codex-otto" }), neara: note(["claude-gw"]) });
  assert.equal((await catalog.allowed("otto/tangent", { harness: "claude-gw", model: "opus" })).code, "launch-not-allowed");
  assert.equal((await catalog.allowed("neara/pgande", { harness: "claude-otto", model: "opus" })).code, "launch-not-allowed");
  assert.equal((await catalog.allowed("otto/tangent", { harness: "codex-otto", model: "sol" })).command, "codex --approve-for-me");
  const legacy = await catalog.allowed("otto/tangent", { harness: "codex", model: "sol" });
  assert.equal(legacy.command, "codex --approve-for-me");
  assert.equal(legacy.harness, "codex-otto", "an existing pending codex ref advances through the scoped migration");
  assert.equal((await catalog.allowed("neara/pgande", { harness: "codex", model: "sol" })).code, "launch-not-allowed", "the migration does not broaden another Area");
});

test("child policies intersect with ancestors and cannot widen them", async () => {
  const catalog = await fixture({ otto: note(["codex", "claude-otto"]), "otto/tangent": note(["codex/sol"]) });
  const policy = await catalog.policyFor("otto/tangent/ui");
  assert.deepEqual(policy.declaredBy, ["otto/tangent", "otto"]);
  assert.deepEqual(policy.launches.map((entry) => entry.harness), ["codex"]);
  assert.equal((await catalog.allowed("otto/tangent", { harness: "claude-otto", model: "opus" })).code, "launch-not-allowed");
});

test("a refusal names the Area that declared the policy, not the Area it was started in", async () => {
  const catalog = await fixture({ otto: note(["codex-otto/sol", "claude-otto/opus"]) });
  const refused = await catalog.allowed("otto/tangent", { harness: "claude-gw", model: "opus" });
  assert.equal(refused.declaredBy, "otto", "the inherited contract that refused it is the file worth editing");
  assert.equal(refused.error, "launch claude-gw/opus is not allowed by the otto policy: codex-otto/sol, claude-otto/opus");
  assert.deepEqual(refused.allowed, ["codex-otto/sol", "claude-otto/opus"]);
  const nearest = await fixture({ otto: note(["codex-otto", "claude-otto"]), "otto/tangent": note(["codex-otto/sol"]) });
  const narrowed = await nearest.allowed("otto/tangent", { harness: "claude-otto", model: "opus" });
  assert.equal(narrowed.declaredBy, "otto/tangent", "the nearest contract that refuses it wins over the ancestor that allows it");
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

test("removed-model memory falls back through a broad inherited allow pattern", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-launch-registered-memory-"));
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const memory = createLaunchMemory(path.join(root, "runtime", "launch-memory.json"));
  const catalog = createLaunchCatalog({ root,
    /** Reads the broad parent policy fixture. */
    readAreaNote: async (area) => area === "otto" ? note(["claude-otto"]) : "", memory });
  await memory.write("otto", "work", { harness: "claude-otto", model: "opus" });
  await memory.write("otto/tangent", "work", { harness: "claude-otto", model: "removed" });
  assert.deepEqual(await catalog.remembered("otto/tangent", "work"), { harness: "claude-otto", model: "opus", source: "otto" });
});

test("unrestricted Areas do not invent a first-use choice", async () => {
  const catalog = await fixture({});
  assert.equal(await catalog.remembered("fresh", "brain"), null);
});

test("explicit Area harness contracts expose valid, stale, missing, and invalid state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-harness-contract-health-"));
  await mkdir(path.join(root, "otto", "valid"), { recursive: true });
  await mkdir(path.join(root, "otto", "stale"), { recursive: true });
  await mkdir(path.join(root, "otto", "invalid"), { recursive: true });
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  await writeFile(path.join(root, "otto", "harnesses.md"), areaHarnessContractText({ allow: ["codex", "claude-otto"], registry }));
  await writeFile(path.join(root, "otto", "valid", "harnesses.md"), areaHarnessContractText({ registry }));
  await writeFile(path.join(root, "otto", "stale", "harnesses.md"), areaHarnessContractText({ registry: { ...registry, harnesses: registry.harnesses.slice(0, 1) } }));
  await writeFile(path.join(root, "otto", "invalid", "harnesses.md"), "```tangent.area-harnesses.v1\n{bad}\n```\n");
  /** Supplies no legacy declaration to the contract-health fixture. */
  const readAreaNote = async () => "";
  const catalog = createLaunchCatalog({ root, readAreaNote });
  assert.equal((await catalog.policyFor("otto/valid")).health, "valid");
  assert.equal((await catalog.policyFor("otto/stale")).health, "stale");
  assert.equal((await catalog.policyFor("otto/missing")).health, "missing");
  assert.equal((await catalog.policyFor("otto/invalid")).code, "harness-contract-invalid");
});

test("empty child contracts preserve the parent allowlist for an effort-capable launch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-harness-empty-inheritance-"));
  const current = {
    version: 2,
    modelSets: { claude: [{ id: "fable-5", effortSet: "claude" }] },
    effortSets: { claude: [{ id: "low" }, { id: "high" }] },
    harnesses: [{ id: "claude", command: "claude", modelSet: "claude" }],
  };
  for (const area of ["neara", "neara/delivery", "neara/delivery/standards", "neara/delivery/cli", "neara/restricted"]) {
    await mkdir(path.join(root, area), { recursive: true });
  }
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(current)}\n\`\`\``);
  await writeFile(path.join(root, "neara", "harnesses.md"), areaHarnessContractText({ allow: ["claude"], registry: current }));
  await writeFile(path.join(root, "neara", "delivery", "harnesses.md"), areaHarnessContractText({ registry: current }));
  await writeFile(path.join(root, "neara", "delivery", "standards", "harnesses.md"), areaHarnessContractText({ registry: current }));
  await writeFile(path.join(root, "neara", "delivery", "cli", "harnesses.md"), areaHarnessContractText({ registry: current }));
  await writeFile(path.join(root, "neara", "restricted", "harnesses.md"), areaHarnessContractText({ allow: ["claude/fable-5/high"], registry: current }));
  /** Supplies no legacy declarations to the current-contract fixture. */
  const readAreaNote = async () => "";
  const catalog = createLaunchCatalog({ root, readAreaNote });

  for (const area of ["neara/delivery/standards", "neara/delivery/cli"]) {
    const policy = await catalog.policyFor(area);
    assert.deepEqual(policy.declaredBy, ["neara"]);
    assert.equal(policy.health, "valid");
    assert.equal((await catalog.allowed(area, { harness: "claude", model: "fable-5" })).command, "claude");
    assert.match((await catalog.allowed(area, { harness: "missing" })).error, /unknown harness "missing"/);
  }
  assert.equal((await catalog.allowed("neara/restricted", { harness: "claude", model: "fable-5", effort: "high" })).command, "claude");
  assert.equal((await catalog.allowed("neara/restricted", { harness: "claude", model: "fable-5" })).code, "launch-not-allowed");
  assert.equal((await catalog.allowed("neara/restricted", { harness: "claude", model: "fable-5", effort: "low" })).code, "launch-not-allowed");
});

test("repair creates a child contract and migrates legacy allow and aliases without widening it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-harness-contract-repair-"));
  await mkdir(path.join(root, "otto"), { recursive: true });
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const legacy = note(["codex-otto"], { codex: "codex-otto" });
  /** Supplies the legacy declaration being repaired. */
  const readAreaNote = async () => legacy;
  const repository = {
    /** Persists the generated fixture contract. */
    async writeMarkdown(file, text) { await writeFile(path.join(root, file), text); },
  };
  /** Accepts the fixture's synthetic vault commit. */
  const commit = async () => {};
  const catalog = createLaunchCatalog({
    root,
    readAreaNote,
    repository,
    commit,
  });
  const repaired = await catalog.repairContract("otto");
  assert.equal(repaired.changed, true);
  const parsed = parseAreaHarnessContract(await readFile(path.join(root, "otto", "harnesses.md"), "utf8"), registry);
  assert.deepEqual(parsed.allow.map((entry) => entry.harness), ["codex-otto"]);
  assert.deepEqual(parsed.aliases, { codex: "codex-otto" });
  assert.equal((await catalog.allowed("otto", { harness: "codex", model: "sol" })).harness, "codex-otto");
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

test("policy writes preserve a scoped compatibility alias", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-launch-alias-write-"));
  await writeFile(path.join(root, "harnesses.md"), `\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\``);
  const notes = { otto: note(["codex-otto", "claude-otto"], { codex: "codex-otto" }) };
  let contractText = "";
  await writeFile(path.join(root, "otto.md"), notes.otto);
  const catalog = createLaunchCatalog({
    root,
    /** Reads the mutable Otto note fixture. */
    readAreaNote: async (area) => notes[area] ?? "",
    repository: {
      /** Stores the proposed policy note. */
      async writeMarkdown(_file, text) { contractText = text; },
    },
    /** Accepts a fixture commit. */
    commit: async () => {},
    /** Accepts fixture staging. */
    stage: async () => {},
    /** Maps Otto to its fixture note. */
    areaFile: () => "otto.md",
    /** Supplies an empty fixture note. */
    emptyAreaNote: () => "",
    /** Lists the fixture subtree. */
    listAreas: async () => ["otto"],
  });
  const saved = await catalog.savePolicy("otto", ["codex-otto"]);
  assert.equal(saved.error, undefined);
  assert.deepEqual(parseAreaHarnessContract(contractText, registry).aliases, { codex: "codex-otto" });
});
