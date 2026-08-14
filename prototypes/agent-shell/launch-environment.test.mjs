import assert from "node:assert/strict";
import test from "node:test";

import {
  fencedBlock,
  harnessModels,
  inheritedLaunch,
  launchLabel,
  parseEnvironmentBlock,
  parseHarnessRegistry,
  resolveLaunch,
  upsertEnvironmentLaunch,
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

test("area environment defaults win over legacy Agent lines and inherit", async () => {
  const notes = new Map([
    ["otto", '```tangent.environment.v1\n{"defaults": {"launch": {"harness": "codex", "model": "luna"}}}\n```'],
    ["otto/dnd", "## Resources\n\n- Agent: pi-code\n"],
  ]);
  /** Test note reader backed by the fixture map. */
  const readNote = async (area) => notes.get(area) ?? "";
  const inherited = await inheritedLaunch("otto/tangent", readNote, registry);
  assert.equal(inherited.command, "codex --model gpt-5.6-luna");
  assert.equal(inherited.label, "Codex · Luna");
  assert.equal(inherited.source, "otto");
  const legacy = await inheritedLaunch("otto/dnd", readNote, registry);
  assert.equal(legacy.command, "pi-code");
  assert.equal(legacy.label, null);
});

test("keeps the profile fallback when nothing declares a launch", async () => {
  /** Test note reader with no declarations. */
  const readNote = async () => "";
  assert.equal((await inheritedLaunch("otto/empty", readNote, registry)).command, "claude-otto");
  assert.equal((await inheritedLaunch("work/empty", readNote, registry)).command, "claude");
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

test("launch labels fall back to ids and fenced lookup handles dots", () => {
  assert.equal(launchLabel({ id: "agy" }), "agy");
  assert.equal(fencedBlock("```a.b.c\nx\n```", "a.b.c"), "x");
});
