import assert from "node:assert/strict";
import test from "node:test";

import { generateAttentionItems, resolveAgentRunStatus } from "../dist/index.js";

const base = {
  schema: "tangent.trees.observation.v1",
  recordedAt: "2026-06-15T12:00:00.000Z",
  source: { id: "test", kind: "manual" },
  subject: { entityId: "ent_1", agentRunId: "run_1", terminalSessionId: "term_1" },
  data: {},
  confidence: "exact",
  evidence: []
};

/** Documents the obs helper. */
function obs(id, kind, observedAt, data = {}) {
  return { ...base, id, kind, observedAt, data };
}

test("permission observation creates critical attention", () => {
  const items = generateAttentionItems({ observations: [obs("obs_1", "agent.permission_requested", "2026-06-15T12:00:00.000Z", { permissionRequestId: "perm_1" })] });
  assert.equal(items[0].kind, "permission_requested");
  assert.equal(items[0].severity, "critical");
});

test("process exits create done or failed attention", () => {
  const items = generateAttentionItems({ observations: [
    obs("obs_done", "process.exited", "2026-06-15T12:00:00.000Z", { exitCode: 0 }),
    obs("obs_fail", "process.exited", "2026-06-15T12:01:00.000Z", { exitCode: 1 })
  ] });
  assert.equal(items.find((item) => item.kind === "agent_done")?.severity, "success");
  assert.equal(items.find((item) => item.kind === "agent_failed")?.severity, "critical");
});

test("quiet resolver returns running after new output", () => {
  const quiet = resolveAgentRunStatus({
    observations: [obs("start", "process.started", "2026-06-15T12:00:00.000Z")],
    now: "2026-06-15T12:11:00.000Z",
    quietThresholdMs: 10 * 60 * 1000
  });
  const running = resolveAgentRunStatus({
    observations: [
      obs("start", "process.started", "2026-06-15T12:00:00.000Z"),
      obs("out", "terminal.output", "2026-06-15T12:10:30.000Z")
    ],
    now: "2026-06-15T12:11:00.000Z",
    quietThresholdMs: 10 * 60 * 1000
  });

  assert.equal(quiet.status, "quiet");
  assert.equal(running.status, "running");
});

test("estimate, dirty worktree, and old capture produce attention", () => {
  const items = generateAttentionItems({
    now: "2026-06-15T13:00:00.000Z",
    workSessions: [{
      id: "ws_1",
      entityId: "ent_1",
      entityPath: "proj/task",
      status: "active",
      estimate: { minutes: 10, source: "user" },
      startedAt: "2026-06-15T12:00:00.000Z",
      startedBy: { id: "u", kind: "user" },
      agentRunIds: [],
      terminalSessionIds: [],
      usageSessionIds: [],
      checkpointIds: [],
      captureIds: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
      evidence: []
    }],
    captures: [{
      schema: "tangent.trees.capture.v1",
      id: "cap_1",
      kind: "note",
      text: "old",
      status: "open",
      source: { id: "test", kind: "manual" },
      createdBy: { id: "u", kind: "user" },
      createdAt: "2026-06-14T12:00:00.000Z",
      evidence: []
    }],
    observations: [obs("dirty", "git.status_changed", "2026-06-15T11:00:00.000Z", { dirty: true })]
  });

  assert.ok(items.some((item) => item.kind === "estimate_exceeded"));
  assert.ok(items.some((item) => item.kind === "dirty_worktree"));
  assert.ok(items.some((item) => item.kind === "capture_unresolved"));
});
