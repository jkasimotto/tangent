import assert from "node:assert/strict";
import test from "node:test";
import { activeBrainForArea } from "./public/brain-ownership.js";

test("Document notification chooses only the exact live Area brain", () => {
  const brains = [
    { area: "otto/neara", status: "active", live: true },
    { area: "otto/neara/hackathon", status: "active", live: true },
  ];
  assert.equal(activeBrainForArea(brains, "otto/neara/hackathon")?.area, "otto/neara/hackathon");
  assert.equal(activeBrainForArea(brains, "otto/neara/hackathon/live-edit"), null);
});

test("Document notification skips inactive brains and reports no target when none is live", () => {
  const brains = [
    { area: "otto/neara", status: "active", live: true },
    { area: "otto/neara/hackathon", status: "active", live: false },
  ];
  assert.equal(activeBrainForArea(brains, "otto/neara/hackathon"), null);
  assert.equal(activeBrainForArea([{ area: "otto/neara", status: "inactive", live: false }], "otto/neara"), null);
});

test("brain ownership is exact, segment-safe, and never travels down or sideways", () => {
  const parent = { area: "otto/a", status: "active", live: true, session: "parent" };
  const child = { area: "otto/a/child", status: "active", live: true, session: "child" };
  const sibling = { area: "otto/a/sibling", status: "active", live: true, session: "sibling" };
  const stopped = { area: "otto/a/child/deep", status: "inactive", live: false, session: "stopped" };
  const stale = { area: "otto/a/child/stale", status: "active", live: false, session: "stale" };
  const brains = [parent, child, sibling, stopped, stale];

  assert.equal(activeBrainForArea(brains, "otto/a")?.session, "parent", "a descendant never owns upward");
  assert.equal(activeBrainForArea(brains, "otto/a/child")?.session, "child", "the exact live brain wins");
  assert.equal(activeBrainForArea(brains, "otto/a/child/deep"), null, "an inactive exact record has no live owner");
  assert.equal(activeBrainForArea(brains, "otto/a/child/stale"), null, "an active brain without a live process is unavailable");
  assert.equal(activeBrainForArea(brains, "otto/a/other"), null, "a parent never owns downward");
  assert.equal(activeBrainForArea(brains, "otto/alpha"), null, "a text prefix is not an Area ancestor");
  assert.equal(activeBrainForArea([], "otto/a"), null, "an absent record has no owner");
});
