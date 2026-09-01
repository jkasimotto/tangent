import assert from "node:assert/strict";
import test from "node:test";
import { areaBrainPaneMode } from "./public/area-brain-pane-core.js";

test("the Brain pane uses a terminal only for the exact live session", () => {
  assert.deepEqual(areaBrainPaneMode({ live: true, state: "working" }, { name: "tangent-brain" }), { kind: "terminal", session: "tangent-brain" });
  assert.deepEqual(areaBrainPaneMode({ live: true, health: { status: "failed" } }, { name: "stuck-brain" }), { kind: "terminal", session: "stuck-brain" });
});

test("missing processes resume while stopped or absent Brains wait for Julian", () => {
  assert.deepEqual(areaBrainPaneMode({ live: true, state: "working" }, null), { kind: "resuming" });
  assert.deepEqual(areaBrainPaneMode({ live: false, status: "inactive" }, null), { kind: "start", resume: true });
  assert.deepEqual(areaBrainPaneMode(null, null), { kind: "start", resume: false });
});
