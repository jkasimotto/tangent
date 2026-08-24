import test from "node:test";
import assert from "node:assert/strict";
import core from "./public/what-happened-core.js";
import areaMap from "./public/area-map-core.js";
const HOUR = 3_600_000;

test("CLOSE_WINDOW_MS is 12 hours", () => {
  assert.equal(core.CLOSE_WINDOW_MS, 12 * HOUR);
});

test("windowCloses drops a close past 12 hours, keeps one just inside it", () => {
  const now = 100 * HOUR;
  const closes = [
    { file: "a/goal-x.md", kind: "done", at: now - 12 * HOUR - 1000, session: null },
    { file: "a/goal-y.md", kind: "done", at: now - (12 * HOUR - 60_000), session: null },
  ];
  assert.deepEqual(core.windowCloses(closes, now).map((c) => c.file), ["a/goal-y.md"]);
});

test("areaCloses keeps a close in the Area itself and in a descendant, drops a sibling", () => {
  const closes = [
    { file: "otto/tangent/goal-a.md", kind: "done", at: 1, session: null },
    { file: "otto/tangent/model/goal-b.md", kind: "done", at: 1, session: null },
    { file: "otto/dnd/goal-c.md", kind: "done", at: 1, session: null },
  ];
  const kept = core.areaCloses(closes, "otto/tangent", areaMap.isInside).map((c) => c.file);
  assert.deepEqual(kept, ["otto/tangent/goal-a.md", "otto/tangent/model/goal-b.md"]);
});

test("closerLabel: Julian without a session, brain g<N> for any Area's brain, otherwise the session without its tangent- prefix", () => {
  assert.equal(core.closerLabel(null), "Julian");
  assert.equal(core.closerLabel(""), "Julian");
  assert.equal(core.closerLabel("tangent-brain-g10"), "brain g10");
  assert.equal(core.closerLabel("dnd-brain-g5"), "brain g5");
  assert.equal(core.closerLabel("dnd-brain"), "brain");
  assert.equal(core.closerLabel("tangent-brain-g10-r2"), "brain g10");
  assert.equal(core.closerLabel("tangent-x-s2"), "x-s2");
});

test("closeMomentLabel: bare time today, yesterday HH:MM across midnight", () => {
  // Fixture timezone: UTC+2 (offset -120), so local time leads UTC by 2 hours.
  const offset = -120;
  const now = Date.UTC(2026, 7, 20, 10, 0, 0); // 2026-08-20 12:00 local
  const sameDay = Date.UTC(2026, 7, 20, 1, 30, 0); // 2026-08-20 03:30 local
  assert.equal(core.closeMomentLabel(sameDay, now, offset), "03:30");
  const yesterday = Date.UTC(2026, 7, 19, 20, 15, 0); // 2026-08-19 22:15 local
  assert.equal(core.closeMomentLabel(yesterday, now, offset), "yesterday 22:15");
});

test("wontDoReason finds the reason after the last heading, \"\" without one", () => {
  assert.equal(core.wontDoReason("### Won't do\n\nToo niche for now.\n\nOlder state."), "Too niche for now.");
  assert.equal(core.wontDoReason("Not started."), "");
});
