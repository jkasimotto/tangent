import assert from "node:assert/strict";
import test from "node:test";
import { activeBrainForArea } from "./public/document-reader-view.js";

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
