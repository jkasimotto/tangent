import assert from "node:assert/strict";
import test from "node:test";

import {
  fencedBlock,
  harnessModels,
  inheritedBrainLaunch,
  inheritedLaunch,
  launchLabel,
  modelEfforts,
  parseEnvironmentBlock,
  parseHarnessRegistry,
  resolveLaunch,
  updateEnvironmentDefault,
  upsertEnvironmentLaunch,
  upsertHarnessRegistry,
  validateHarnessRegistry,
} from "./launch-environment.mjs";

const REGISTRY_NOTE = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {
    "claude": [
      { "id": "opus-4-6", "label": "Opus 4.6", "args": "--model claude-opus-4-6" },
      { "id": "sonnet-4-8", "label": "Sonnet 4.8", "args": "--model claude-sonnet-4-8" }
    ],
    "codex": [
      { "id": "luna", "label": "Luna", "args": "--model gpt-5.6-luna" },
      { "id": "sol-max", "label": "Sol max", "args": "--model gpt-5.6-sol -c model_reasoning_effort=max" }
    ]
  },
  "harnesses": [
    { "id": "claude", "label": "Claude", "command": "claude", "modelSet": "claude" },
    { "id": "claude-otto", "label": "Claude · Otto", "command": "CLAUDE_CONFIG_DIR=~/.claude-otto claude", "modelSet": "claude" },
    { "id": "codex", "label": "Codex", "command": "codex", "modelSet": "codex" },
    { "id": "pi-code", "label": "Pi Code", "command": "pi-code" }
  ]
}
\`\`\`
`;

const registry = parseHarnessRegistry(REGISTRY_NOTE);

test("parses the registry block out of surrounding Markdown", () => {
  assert.equal(registry.harnesses.length, 4);
  assert.equal(registry.modelSets.claude.length, 2);
});

test("returns null without a registry block and an error for broken JSON", () => {
  assert.equal(parseHarnessRegistry("# Notes\n\nNo block here.\n"), null);
  assert.match(parseHarnessRegistry("```tangent.harnesses.v1\n{oops\n```\n").error, /not valid JSON/);
});

test("rejects a harness that references an unknown model set", () => {
  const note = '```tangent.harnesses.v1\n{"harnesses": [{"id": "x", "command": "x", "modelSet": "nope"}]}\n```';
  assert.match(parseHarnessRegistry(note).error, /unknown model set "nope"/);
});

// Proof case 2: display label decouples from the composed command string.
test("claude-otto with Opus 4.6 composes the identity command and model args", () => {
  const resolved = resolveLaunch(registry, { harness: "claude-otto", model: "opus-4-6" });
  assert.equal(resolved.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(resolved.label, "Claude · Otto · Opus 4.6");
});

// Proof case 3: both Claude identities share one model set defined once.
test("claude and claude-otto share the claude model set", () => {
  const [claude, otto] = ["claude", "claude-otto"].map((id) => registry.harnesses.find((h) => h.id === id));
  assert.deepEqual(harnessModels(registry, claude), harnessModels(registry, otto));
  assert.equal(harnessModels(registry, claude)[0].label, "Opus 4.6");
});

// Proof case 4: one named option carries model and effort arguments together.
test("codex Sol max composes model and effort arguments from one option", () => {
  const resolved = resolveLaunch(registry, { harness: "codex", model: "sol-max" });
  assert.equal(resolved.command, "codex --model gpt-5.6-sol -c model_reasoning_effort=max");
});

// Proof case 1: a harness without model options is complete by itself.
test("a harness without a model set launches its exact command unchanged", () => {
  const resolved = resolveLaunch(registry, { harness: "pi-code" });
  assert.equal(resolved.command, "pi-code");
  assert.equal(resolved.label, "Pi Code");
  assert.deepEqual(harnessModels(registry, registry.harnesses.find((h) => h.id === "pi-code")), []);
});

test("never substitutes: unknown ids resolve to errors that name the id", () => {
  assert.match(resolveLaunch(registry, { harness: "gemini" }).error, /unknown harness "gemini"/);
  assert.match(resolveLaunch(registry, { harness: "codex", model: "opus-4-6" }).error, /unknown model "opus-4-6" for harness "codex"/);
});

test("only declarations resolve; a legacy Agent line is not a declaration", async () => {
  const notes = new Map([
    ["otto", '```tangent.environment.v1\n{"defaults": {"launch": {"harness": "codex", "model": "luna"}}}\n```'],
    ["work/legacy", "## Resources\n\n- Agent: pi-code\n"],
  ]);
  /** Test note reader backed by the fixture map. */
  const readNote = async (area) => notes.get(area) ?? "";
  const inherited = await inheritedLaunch("otto/tangent", readNote, registry);
  assert.equal(inherited.command, "codex --model gpt-5.6-luna");
  assert.equal(inherited.label, "Codex · Luna");
  assert.equal(inherited.source, "otto");
  assert.equal(await inheritedLaunch("work/legacy", readNote, registry), null);
});

test("brain defaults inherit independently and the nearest Area wins", async () => {
  const notes = new Map([
    ["otto", '```tangent.environment.v1\n{"defaults":{"launch":{"harness":"claude-otto"},"brain":{"harness":"codex","model":"luna"}}}\n```'],
    ["otto/launcher", '```tangent.environment.v1\n{"defaults":{"brain":{"harness":"claude-otto","model":"opus-4-6"}}}\n```'],
  ]);
  /** Reads one Area note from the inheritance fixture. */
  const readNote = async (area) => notes.get(area) ?? "";
  const inherited = await inheritedBrainLaunch("otto/tangent", readNote, registry);
  assert.equal(inherited.command, "codex --model gpt-5.6-luna");
  assert.equal(inherited.source, "otto");
  const overridden = await inheritedBrainLaunch("otto/launcher/client", readNote, registry);
  assert.equal(overridden.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(overridden.source, "otto/launcher");
  assert.equal(await inheritedBrainLaunch("work/empty", readNote, registry), null);
});

test("an explicit Brain follow-work declaration stops Brain inheritance", async () => {
  const notes = new Map([
    ["otto", '```tangent.environment.v1\n{"defaults":{"launch":{"harness":"claude-otto"},"brain":{"harness":"codex","model":"luna"}}}\n```'],
    ["otto/tangent", '```tangent.environment.v1\n{"defaults":{"launch":{"harness":"pi-code"},"brain":"work"}}\n```'],
  ]);
  /** Reads one Area note from the follow-work fixture. */
  const readNote = async (area) => notes.get(area) ?? "";
  const resolved = await inheritedBrainLaunch("otto/tangent/client", readNote, registry);
  assert.equal(resolved.command, "pi-code");
  assert.equal(resolved.source, "otto/tangent");
  assert.equal(resolved.workSource, "otto/tangent");
  assert.equal(resolved.via, "work");
});

test("nothing declared resolves to nothing, never to a profile guess", async () => {
  /** Test note reader with no declarations. */
  const readNote = async () => "";
  assert.equal(await inheritedLaunch("otto/empty", readNote, registry), null);
  assert.equal(await inheritedLaunch("work/empty", readNote, registry), null);
});

test("a broken declaration blocks resolution with the area named", async () => {
  const notes = new Map([
    ["otto", '```tangent.environment.v1\n{"defaults": {"launch": {"harness": "missing"}}}\n```'],
  ]);
  /** Test note reader backed by the fixture map. */
  const readNote = async (area) => notes.get(area) ?? "";
  const inherited = await inheritedLaunch("otto/tangent", readNote, registry);
  assert.match(inherited.error, /otto: unknown harness "missing"/);
});

test("environment block parsing reports malformed JSON", () => {
  assert.equal(parseEnvironmentBlock("plain note"), null);
  assert.match(parseEnvironmentBlock("```tangent.environment.v1\n{bad\n```").error, /not valid JSON/);
});

test("saving a default appends a Development environment section once", () => {
  const first = upsertEnvironmentLaunch("# Tangent\n\n## Resources\n\n- Repository: ~/x\n", { harness: "codex", model: "luna" });
  assert.match(first, /## Development environment/);
  assert.deepEqual(parseEnvironmentBlock(first).defaults.launch, { harness: "codex", model: "luna" });
  const second = upsertEnvironmentLaunch(first, { harness: "claude-otto", model: "opus-4-6" });
  assert.equal(second.match(/## Development environment/g).length, 1);
  assert.deepEqual(parseEnvironmentBlock(second).defaults.launch, { harness: "claude-otto", model: "opus-4-6" });
});

test("saving a default keeps other environment keys in the block", () => {
  const note = '```tangent.environment.v1\n{"version": 1, "paneConfigurations": [{"id": "agent", "panes": [{"role": "agent"}]}], "defaults": {"launch": {"harness": "codex"}}}\n```';
  const saved = upsertEnvironmentLaunch(note, { harness: "pi-code" });
  const environment = parseEnvironmentBlock(saved);
  assert.equal(environment.paneConfigurations.length, 1);
  assert.deepEqual(environment.defaults.launch, { harness: "pi-code" });
});

test("saving a brain default preserves the work default", () => {
  const work = upsertEnvironmentLaunch("# Tangent\n", { harness: "codex", model: "luna" });
  const brain = upsertEnvironmentLaunch(work, { harness: "codex", model: "luna", effort: "high" }, "brain");
  assert.deepEqual(parseEnvironmentBlock(brain).defaults, {
    launch: { harness: "codex", model: "luna" },
    brain: { harness: "codex", model: "luna", effort: "high" },
  });
});

test("default persistence can follow Work or remove one local key", () => {
  const exact = upsertEnvironmentLaunch("# Tangent\n", { harness: "codex", model: "luna" });
  const follows = updateEnvironmentDefault(exact, { kind: "brain", mode: "work" });
  assert.deepEqual(parseEnvironmentBlock(follows).defaults, {
    launch: { harness: "codex", model: "luna" },
    brain: "work",
  });
  const inherited = updateEnvironmentDefault(follows, { kind: "launch", mode: "inherit" });
  assert.deepEqual(parseEnvironmentBlock(inherited).defaults, { brain: "work" });
  assert.equal(updateEnvironmentDefault("# Tangent\n", { kind: "launch", mode: "inherit" }), "# Tangent\n");
});

test("default persistence does not replace a malformed environment block", () => {
  assert.throws(
    () => updateEnvironmentDefault("```tangent.environment.v1\n{bad\n```", { kind: "brain", mode: "work" }),
    /not valid JSON/
  );
});

test("registry validation names duplicates and broken references", () => {
  assert.equal(validateHarnessRegistry(registry), null);
  assert.match(validateHarnessRegistry({ harnesses: [{ id: "a", command: "a" }, { id: "a", command: "b" }] }), /duplicate harness id "a"/);
  assert.match(validateHarnessRegistry({ harnesses: [{ id: "a", command: "a", modelSet: "x" }] }), /unknown model set "x"/);
  assert.match(validateHarnessRegistry({ harnesses: [], modelSets: { m: [{ id: "y" }, { id: "y" }] } }), /duplicate model id "y"/);
  assert.match(validateHarnessRegistry({ harnesses: [{ label: "No id" }] }), /needs an id and a command/);
});

test("writing the registry replaces the block and keeps surrounding prose", () => {
  const next = { version: 1, modelSets: {}, harnesses: [{ id: "agy", label: "Agy", command: "agy" }] };
  const replaced = upsertHarnessRegistry(REGISTRY_NOTE, next);
  assert.match(replaced, /# Harnesses/);
  assert.equal(parseHarnessRegistry(replaced).harnesses.length, 1);
  const created = upsertHarnessRegistry("", next);
  assert.equal(parseHarnessRegistry(created).harnesses[0].id, "agy");
});

test("launch labels fall back to ids and fenced lookup handles dots", () => {
  assert.equal(launchLabel({ id: "agy" }), "agy");
  assert.equal(fencedBlock("```a.b.c\nx\n```", "a.b.c"), "x");
});

const EFFORT_REGISTRY = {
  modelSets: { codex: [{ id: "sol", label: "Sol", args: "--model gpt-5.6-sol" }] },
  effortSets: { codex: [{ id: "high", label: "High", args: "-c model_reasoning_effort=high" }, { id: "max", label: "Max", args: "-c model_reasoning_effort=max" }] },
  harnesses: [
    { id: "codex", label: "Codex", command: "codex", modelSet: "codex", effortSet: "codex" },
    { id: "agy", label: "Agy", command: "agy" },
  ],
};

test("effort is a third axis: harness command, model args, then effort args", () => {
  const resolved = resolveLaunch(EFFORT_REGISTRY, { harness: "codex", model: "sol", effort: "max" });
  assert.equal(resolved.command, "codex --model gpt-5.6-sol -c model_reasoning_effort=max");
  assert.equal(resolved.label, "Codex · Sol · Max");
  assert.equal(resolved.effort, "max");
  const noEffort = resolveLaunch(EFFORT_REGISTRY, { harness: "codex", model: "sol" });
  assert.equal(noEffort.command, "codex --model gpt-5.6-sol");
  assert.equal(noEffort.effort, null);
});

test("an effort a harness does not offer is an error that names it", () => {
  assert.equal(resolveLaunch(EFFORT_REGISTRY, { harness: "codex", model: "sol", effort: "ultra" }).error, 'unknown effort "ultra" for harness "codex"');
  assert.equal(resolveLaunch(EFFORT_REGISTRY, { harness: "agy", effort: "high" }).error, 'unknown effort "high" for harness "agy"');
});

test("registry validation covers effort sets", () => {
  assert.equal(validateHarnessRegistry(EFFORT_REGISTRY), null);
  assert.equal(validateHarnessRegistry({ ...EFFORT_REGISTRY, harnesses: [{ id: "x", command: "x", effortSet: "missing" }] }), 'harness "x" references unknown effort set "missing"');
  assert.equal(validateHarnessRegistry({ ...EFFORT_REGISTRY, effortSets: { codex: [{ id: "a" }, { id: "a" }] } }), 'duplicate effort id "a" in the "codex" set');
  assert.equal(parseHarnessRegistry("```tangent.harnesses.v1\n" + JSON.stringify({ harnesses: [{ id: "x", command: "x", effortSet: "nope" }] }) + "\n```").error, 'harness "x" references unknown effort set "nope"');
});

test("a model can narrow the effort choices offered by its harness", () => {
  const registry = {
    modelSets: { codex: [
      { id: "sol", args: "--model gpt-5.6-sol", effortSet: "codex-ultra" },
      { id: "luna", args: "--model gpt-5.6-luna" },
    ] },
    effortSets: {
      codex: [{ id: "max", args: "-c model_reasoning_effort=max" }],
      "codex-ultra": [{ id: "ultra", args: "-c model_reasoning_effort=ultra" }],
    },
    harnesses: [{ id: "codex", command: "codex", modelSet: "codex", effortSet: "codex" }],
  };
  const harness = registry.harnesses[0];
  assert.deepEqual(modelEfforts(registry, harness, registry.modelSets.codex[0]).map((item) => item.id), ["ultra"]);
  assert.equal(resolveLaunch(registry, { harness: "codex", model: "sol", effort: "ultra" }).command, "codex --model gpt-5.6-sol -c model_reasoning_effort=ultra");
  assert.match(resolveLaunch(registry, { harness: "codex", model: "luna", effort: "ultra" }).error, /unknown effort/);
  assert.equal(validateHarnessRegistry({ ...registry, modelSets: { codex: [{ id: "bad", effortSet: "missing" }] } }), 'model "bad" references unknown effort set "missing"');
});

const V2_NOTE = `# Harnesses

\`\`\`tangent.harnesses.v2
{
  "version": 2,
  "modelSets": {},
  "harnesses": [
    { "id": "claude-otto", "label": "Claude · Otto", "command": "claude-otto", "resume": "{command} --resume {id}", "sessionIdArg": "--session-id {id}", "transcripts": "~/.claude-otto/projects" },
    { "id": "codex", "label": "Codex", "command": "codex", "resume": "codex resume {id}", "transcripts": "~/.codex/sessions" },
    { "id": "agy", "label": "Agy", "command": "agy" }
  ]
}
\`\`\`
`;

test("a v1 registry reads as v2 with no resume fields", () => {
  const parsed = parseHarnessRegistry(REGISTRY_NOTE);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.harnesses.every((harness) => harness.resume === undefined && harness.sessionIdArg === undefined), true);
});

test("a v2 registry keeps resume, sessionIdArg, and transcripts per harness", () => {
  const parsed = parseHarnessRegistry(V2_NOTE);
  assert.equal(parsed.error, undefined);
  const claude = parsed.harnesses.find((harness) => harness.id === "claude-otto");
  assert.equal(claude.resume, "{command} --resume {id}");
  assert.equal(claude.sessionIdArg, "--session-id {id}");
  assert.equal(claude.transcripts, "~/.claude-otto/projects");
  assert.equal(parsed.harnesses.find((harness) => harness.id === "codex").sessionIdArg, undefined);
  assert.equal(parsed.harnesses.find((harness) => harness.id === "agy").resume, undefined);
  assert.equal(validateHarnessRegistry(parsed), null);
});

test("resume and sessionIdArg templates must carry the conversation id", () => {
  assert.match(validateHarnessRegistry({ harnesses: [{ id: "x", command: "x", resume: "x --resume" }] }), /resume must contain \{id\}/);
  assert.match(validateHarnessRegistry({ harnesses: [{ id: "x", command: "x", sessionIdArg: "--session-id" }] }), /sessionIdArg must contain \{id\}/);
  assert.match(parseHarnessRegistry('```tangent.harnesses.v2\n{"harnesses": [{"id": "x", "command": "x", "transcripts": 3}]}\n```').error, /transcripts must be a string/);
});

test("saving a registry replaces a v1 block with a v2 block and keeps the fields", () => {
  const registry = { ...parseHarnessRegistry(V2_NOTE), version: 2 };
  const written = upsertHarnessRegistry(REGISTRY_NOTE, registry);
  assert.equal(written.includes("tangent.harnesses.v1"), false);
  assert.match(written, /```tangent\.harnesses\.v2\n/);
  const reread = parseHarnessRegistry(written);
  assert.equal(reread.harnesses.find((harness) => harness.id === "codex").resume, "codex resume {id}");
  assert.equal(parseHarnessRegistry(upsertHarnessRegistry(written, registry)).harnesses.length, 3);
});
