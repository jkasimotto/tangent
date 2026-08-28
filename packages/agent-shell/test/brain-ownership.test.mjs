import assert from "node:assert/strict";
import test from "node:test";
import { nearestActiveBrain } from "../app/public/brain-ownership.js";

/** One active, live brain record for an Area. */
const active = (area) => ({ area, status: "active", live: true, session: `brain-${area}` });

test("nearestActiveBrain prefers the Area's own active brain", () => {
  const brains = [active("otto"), active("otto/tangent")];
  assert.equal(nearestActiveBrain(brains, "otto/tangent").session, "brain-otto/tangent");
});

test("nearestActiveBrain climbs to the nearest parent with an active brain", () => {
  const brains = [active("otto"), { area: "otto/tangent", status: "inactive", live: false }];
  assert.equal(nearestActiveBrain(brains, "otto/tangent/shell").session, "brain-otto");
});

test("nearestActiveBrain is null when no ancestor brain is active", () => {
  assert.equal(nearestActiveBrain([{ area: "otto", status: "active", live: false }], "otto/tangent"), null);
  assert.equal(nearestActiveBrain([], ""), null);
});
