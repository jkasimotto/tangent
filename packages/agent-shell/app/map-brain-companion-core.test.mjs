import assert from "node:assert/strict";
import test from "node:test";
import { mapBrainCanDock, mapBrainMode, mapBrainWidth } from "./public/map-brain-companion-core.js";

test("the companion uses the terminal only for the exact live session", () => {
  assert.deepEqual(mapBrainMode({ live: true, state: "working" }, { name: "tangent-brain" }), { kind: "terminal", session: "tangent-brain" });
  assert.deepEqual(mapBrainMode({ live: true, health: { status: "failed" } }, { name: "stuck-brain" }), { kind: "terminal", session: "stuck-brain" });
});

test("missing processes resume and stopped or absent brains use the existing start control", () => {
  assert.deepEqual(mapBrainMode({ live: true, state: "working" }, null), { kind: "resuming" });
  assert.deepEqual(mapBrainMode({ live: false, status: "inactive" }, null), { kind: "start", resume: true });
  assert.deepEqual(mapBrainMode(null, null), { kind: "start", resume: false });
});

test("dock widths preserve both useful columns and narrow screens fall back", () => {
  assert.equal(mapBrainWidth(560, 1400), 560);
  assert.equal(mapBrainWidth(200, 1400), 420);
  assert.equal(mapBrainWidth(900, 1200), 600);
  assert.equal(mapBrainCanDock(1400, 1400, 560), true);
  assert.equal(mapBrainCanDock(1100, 1100, 540), false);
  assert.equal(mapBrainCanDock(1200, 1000, 560), false);
});
