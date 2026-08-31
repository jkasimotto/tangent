import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { newPipeline, writePipeline } from "./pipeline-record.mjs";
import { writeRepair } from "./repair-crew.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

test("agent list derives the live D&D Assignment from its current pane", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-list-attempt-state-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const pipelines = path.join(root, "pipelines");
  const organizerArea = "otto/dnd";
  const goalArea = "otto/dnd/movement/terrain";
  const goal = `${goalArea}/goal-correct-multipart-terrain-implementation-contract.md`;
  const session = "terrain-correct-multipart-terrain-implementation-contrac";
  const attemptId = "0757cd1a-7f25-44f8-8f6d-ed0de7d1d3b2";
  const instanceId = `agent-list-state-${process.pid}`;
  const openedSessions = [];

  await mkdir(path.join(trees, goalArea), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, organizerArea, "dnd.md"), "---\ntype: area\n---\n\n# D&D\n", "utf8");
  await writeFile(path.join(trees, goalArea, "terrain.md"), `---\ntype: area\n---\n\n# Terrain\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, goal), `---\ntype: goal\nstatus: active\ndone_when: Live state wins.\nsession: ${session}\n---\n\n# Correct multipart terrain implementation contract\n`, "utf8");

  const base = await startShellServer(context, {
    here,
    root,
    trees,
    workspace,
    openedSessions,
    env: { TANGENT_PIPELINES_ROOT: pipelines, TANGENT_SHELL_INSTANCE_ID: instanceId },
  });
  if (!base) return;

  const recovery = [
    { kind: "resume-in-place", startedAt: "2026-08-31T21:21:48.240Z", result: "failed", terminal: true },
    { kind: "nudge", startedAt: "2026-08-31T21:34:46.211Z", result: "done" },
  ];
  const record = newPipeline({
    goal,
    area: goalArea,
    organizerArea,
    slug: "correct-multipart-terrain-implementation-contract",
    steps: [{ instruction: "Keep the current terrain worker live.", command: "yes live-worker" }],
  });
  const assignment = record.steps[0];
  const startedAt = "2026-08-31T21:21:46.760Z";
  record.currentAssignmentId = assignment.id;
  assignment.status = "running";
  assignment.session = session;
  assignment.startedAt = startedAt;
  assignment.attempts = [{ id: attemptId, session, startedAt, instanceId, recovery }];

  await execFileAsync("tmux", ["new-session", "-d", "-s", session, "-c", workspace, "/bin/zsh"]);
  const created = await execFileAsync("tmux", ["display-message", "-p", "-t", `=${session}:`, "#{session_id}"]);
  const target = created.stdout.trim();
  openedSessions.push(session);
  assignment.attempts[0].target = target;
  for (const [key, value] of Object.entries({
    "@tangent_agent_shell_instance": instanceId,
    "@tangent_area": goalArea,
    "@tangent_kind": "goal",
    "@tangent_goal": goal,
    "@tangent_pipeline": goal,
    "@tangent_step": "1",
    "@tangent_assignment": assignment.id,
    "@tangent_attempt": attemptId,
    "@tangent_launch_ref": "codex-otto/sol/low",
  })) await execFileAsync("tmux", ["set-option", "-t", `=${session}:`, key, value]);
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", "sleep 300"]);
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
  await writePipeline(pipelines, record);

  let listed = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { agents } = await fetch(`${base}/api/agents`).then((response) => response.json());
    listed = agents.find((agent) => agent.name === session) ?? null;
    if (listed?.state === "working") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.ok(listed, "the current D&D worker is visible in Agent list");
  assert.equal(listed.state, "working");
  assert.equal(listed.agentState.word, "Working");
  assert.equal(listed.agentState.owner, "worker");
  assert.equal(listed.agentState.evidence.source, "screen");

  await writeRepair(path.join(root, "repairs"), {
    area: organizerArea,
    current: { endedAt: null, leaseUntil: new Date(Date.now() + 60_000).toISOString() },
    history: [],
  });
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { agents } = await fetch(`${base}/api/agents`).then((response) => response.json());
    listed = agents.find((agent) => agent.name === session) ?? null;
    if (listed?.state === "shell") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(listed.state, "shell");
  assert.equal(listed.agentState.word, "Stuck", "terminal recovery remains authoritative without a live harness");
  assert.equal(listed.agentState.owner, "repair crew", "the Job's organizer Area supplies repair ownership");
  assert.equal(listed.agentState.evidence.source, "recovery");
});
