import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { newPipeline, writePipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const area = "otto/recovery";

/** Writes one active Goal bound to the shared worker fixture. */
async function writeGoal(directory, slug, title, doneWhen) {
  await writeFile(
    path.join(directory, `goal-${slug}.md`),
    `---\ntype: goal\nstatus: active\ndone_when: ${doneWhen}\nsession: shared-recovery\n---\n\n# ${title}\n`,
    "utf8",
  );
}

test("agent context rebuilds a pipeline prompt with every extra Goal in durable queue order", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-context-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const pipelines = path.join(root, "pipelines");
  const areaDirectory = path.join(trees, area);
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "recovery.md"),
    `---\ntype: area\n---\n\n# Recovery\n\n## Goals\n\n1. [[goal-primary]]\n2. [[goal-extra-a]]\n3. [[goal-extra-b]]\n4. [[goal-extra-c]]\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8",
  );
  await writeGoal(areaDirectory, "primary", "Primary recovery", "Primary recovery is complete.");
  await writeGoal(areaDirectory, "extra-a", "Extra A", "Extra A is complete.");
  await writeGoal(areaDirectory, "extra-b", "Extra B", "Extra B is complete.");
  await writeGoal(areaDirectory, "extra-c", "Extra C", "Extra C is complete.");

  const primaryFile = `${area}/goal-primary.md`;
  const extraAFile = `${area}/goal-extra-a.md`;
  const extraBFile = `${area}/goal-extra-b.md`;
  const extraCFile = `${area}/goal-extra-c.md`;
  const record = newPipeline({
    goal: primaryFile,
    area,
    slug: "primary",
    extraFiles: [extraBFile, extraAFile],
    steps: [{ instruction: "Implement exact context recovery.", command: "fixture-agent" }],
  });
  record.status = "open";
  record.currentAssignmentId = record.steps[0].id;
  record.steps[0].status = "running";
  record.steps[0].session = "shared-recovery";
  record.steps[0].startedAt = new Date().toISOString();
  record.steps[0].attempts = [{ id: "attempt-1", session: "shared-recovery", startedAt: record.steps[0].startedAt }];
  await writePipeline(pipelines, record);

  const base = await startShellServer(context, {
    here,
    root,
    trees,
    workspace,
    env: {
      TANGENT_PIPELINES_ROOT: pipelines,
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"),
      TANGENT_MESSAGE_QUEUE_FILE: path.join(root, "message-queue.json"),
      AGENT_SHELL_ACTION_LOG: path.join(root, "actions.jsonl"),
      AGENT_SHELL_REBUILD_STATE: path.join(root, "rebuild-state.json"),
      AGENT_SHELL_REBUILD_LOG: path.join(root, "rebuild.log"),
    },
  });
  if (!base) return;

  const response = await fetch(`${base}/api/agents/context?session=shared-recovery`);
  assert.equal(response.status, 200);
  const recovered = (await response.json()).context;
  assert.equal(recovered.goal.file, primaryFile);
  assert.equal(recovered.assignment.instruction, "Implement exact context recovery.");
  assert.deepEqual(recovered.queue.extraFiles, [extraBFile, extraAFile]);
  assert.deepEqual(recovered.extraGoals.map((goal) => goal.file), [extraBFile, extraAFile, extraCFile]);
  assert.equal(recovered.promptError, null);
  assert.match(recovered.prompt, /## Also in this session/);
  assert.match(recovered.prompt, /## Your step\n\nStep 1 of 1: Implement exact context recovery\./);
  assert.ok(recovered.prompt.indexOf("- Extra B: done when Extra B is complete.")
    < recovered.prompt.indexOf("- Extra A: done when Extra A is complete."));
  assert.ok(recovered.prompt.indexOf("- Extra A: done when Extra A is complete.")
    < recovered.prompt.indexOf("- Extra C: done when Extra C is complete."));
});
