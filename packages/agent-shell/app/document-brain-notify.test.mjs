import assert from "node:assert/strict";
import test from "node:test";
import { activeBrainForArea } from "./public/brain-ownership.js";

test("Document notification chooses the closest live ancestor brain", () => {
  const brains = [
    { area: "otto/neara", status: "running", live: true },
    { area: "otto/neara/hackathon", status: "running", live: true },
  ];
  assert.equal(activeBrainForArea(brains, "otto/neara/hackathon/live-edit")?.area, "otto/neara/hackathon");
});

test("Document notification skips inactive brains and reports no target when none is live", () => {
  const brains = [
    { area: "otto/neara", status: "running", live: true },
    { area: "otto/neara/hackathon", status: "running", live: false },
  ];
  assert.equal(activeBrainForArea(brains, "otto/neara/hackathon/live-edit")?.area, "otto/neara");
  assert.equal(activeBrainForArea([{ area: "otto/neara", status: "stopped", live: false }], "otto/neara/live-edit"), null);
});

test("brain ownership is exact, segment-safe, and never travels down or sideways", () => {
  const parent = { area: "otto/a", status: "running", live: true, session: "parent" };
  const child = { area: "otto/a/child", status: "running", live: true, session: "child" };
  const sibling = { area: "otto/a/sibling", status: "running", live: true, session: "sibling" };
  const stopped = { area: "otto/a/child/deep", status: "stopped", live: false, session: "stopped" };
  const stale = { area: "otto/a/child/stale", status: "running", live: false, session: "stale" };
  const brains = [parent, child, sibling, stopped, stale];

  assert.equal(activeBrainForArea(brains, "otto/a")?.session, "parent", "a descendant never owns upward");
  assert.equal(activeBrainForArea(brains, "otto/a/child")?.session, "child", "the exact live brain wins");
  assert.equal(activeBrainForArea(brains, "otto/a/child/deep")?.session, "child", "a stopped exact record falls back");
  assert.equal(activeBrainForArea(brains, "otto/a/child/stale")?.session, "child", "a stale exact record falls back");
  assert.equal(activeBrainForArea(brains, "otto/a/other")?.session, "parent", "a sibling never owns sideways");
  assert.equal(activeBrainForArea(brains, "otto/alpha"), null, "a text prefix is not an Area ancestor");
  assert.equal(activeBrainForArea([], "otto/a"), null, "an absent record has no owner");
});
