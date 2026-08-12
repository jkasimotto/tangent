import assert from "node:assert/strict";
import test from "node:test";

import { inheritedAgentCommand, nodeAncestors, noteResource } from "./node-agent-command.mjs";

test("walks node paths from the nearest node to the root", () => {
  assert.deepEqual(nodeAncestors("otto/dnd/campaign"), ["otto/dnd/campaign", "otto/dnd", "otto"]);
});

test("reads an Agent command only from Resources", () => {
  const note = "# D&D\n\nAgent: ignored\n\n## Resources\n\n- Repository: ~/dnd\n- Agent: `codex --profile fun`\n\n## Notes\n";
  assert.equal(noteResource(note, "Agent"), "codex --profile fun");
});

test("nearest node agent wins and descendants inherit it", async () => {
  const notes = new Map([
    ["otto", "## Resources\n\n- Agent: claude-otto\n"],
    ["otto/dnd", "## Resources\n\n- Agent: codex\n"],
    ["otto/dnd/campaign", "## Resources\n\n- Repository: ~/campaign\n"],
  ]);
  /** Test note reader backed by the fixture map. */
  const readNote = async (node) => notes.get(node) ?? "";

  assert.equal(await inheritedAgentCommand("otto", readNote), "claude-otto");
  assert.equal(await inheritedAgentCommand("otto/dnd", readNote), "codex");
  assert.equal(await inheritedAgentCommand("otto/dnd/campaign", readNote), "codex");
});

test("a descendant declaration overrides its inherited command", async () => {
  const notes = new Map([
    ["a", "## Resources\n\n- Agent: codex\n"],
    ["a/b", "## Resources\n\n- Agent: claude\n"],
  ]);
  /** Test note reader backed by the fixture map. */
  const readNote = async (node) => notes.get(node) ?? "";

  assert.equal(await inheritedAgentCommand("a/b/child", readNote), "claude");
  assert.equal(await inheritedAgentCommand("a/c", readNote), "codex");
});

test("preserves the existing profile fallback when no node declares an agent", async () => {
  assert.equal(await inheritedAgentCommand("otto/empty", async () => ""), "claude-otto");
  assert.equal(await inheritedAgentCommand("work/empty", async () => ""), "claude");
});
