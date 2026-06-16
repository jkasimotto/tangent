import assert from "node:assert/strict";
import test from "node:test";

import { buildTreesAgentEnv, createBuiltInAgentAdapters, findAgentAdapter } from "../dist/index.js";

test("agent launch env includes Tangent linking variables", () => {
  const env = buildTreesAgentEnv({
    entityId: "ent_1",
    entityPath: "project/api",
    workSessionId: "ws_1",
    agentRunId: "run_1",
    terminalSessionId: "term_1",
    worktreePath: "/tmp/worktree",
    repoRoot: "/tmp/repo",
    provider: "codex",
    adapterId: "codex-cli"
  });

  assert.equal(env.TANGENT_TREE_ENTITY_ID, "ent_1");
  assert.equal(env.TANGENT_TREE_ENTITY_PATH, "project/api");
  assert.equal(env.TANGENT_WORK_SESSION_ID, "ws_1");
  assert.equal(env.TANGENT_AGENT_RUN_ID, "run_1");
  assert.equal(env.TANGENT_TERMINAL_SESSION_ID, "term_1");
  assert.equal(env.TANGENT_WORKTREE, "/tmp/worktree");
  assert.equal(env.TANGENT_REPO_ROOT, "/tmp/repo");
  assert.equal(env.TANGENT_PROVIDER, "codex");
  assert.equal(env.TANGENT_AGENT_ADAPTER, "codex-cli");
});

test("built-in adapters include provider CLIs and custom command", () => {
  const adapters = createBuiltInAgentAdapters({ command: "echo", args: ["{entityPath}"] });
  assert.equal(findAgentAdapter(adapters, "codex-cli").displayName, "Codex CLI");
  assert.equal(findAgentAdapter(adapters, "claude-cli").displayName, "Claude CLI");
  assert.equal(findAgentAdapter(adapters, "gemini-cli").displayName, "Gemini CLI");
  assert.equal(findAgentAdapter(adapters, "custom-command").displayName, "Custom command");
});
