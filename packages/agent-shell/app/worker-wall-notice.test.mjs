import assert from "node:assert/strict";
import test from "node:test";
import { workerWallNotice } from "./worker-wall-notice.mjs";

const record = { goal: "otto/tangent/goal-auth.md", slug: "auth" };
const step = { id: "step-1", index: 2 };
const wall = { pattern: "claude-quota-reached-v1", harness: "claude", kind: "quota", model: "Opus", text: "You've reached your Opus limit", source: "screen", since: Date.parse("2026-08-30T05:50:55.115Z") };

test("a verified wall notice exposes its exact evidence", () => {
  const notice = workerWallNotice(record, step, { at: wall.since, activity: { source: "none" }, wall });
  assert.match(notice.text, /verified quota wall in claude/);
  assert.match(notice.text, /"You've reached your Opus limit"/);
  assert.match(notice.text, /pattern claude-quota-reached-v1, screen, 2026-08-30T05:50:55.115Z/);
});

test("the server rejects unverified or contradictory wall notices", () => {
  assert.equal(workerWallNotice(record, step, { at: wall.since, activity: { source: "none" }, wall: { ...wall, pattern: null } }), null);
  assert.equal(workerWallNotice(record, step, { at: wall.since, activity: { source: "screen" }, wall }), null);
});
