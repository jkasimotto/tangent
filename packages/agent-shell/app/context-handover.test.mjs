import { test } from "node:test";
import assert from "node:assert/strict";

import {
  continuationSection,
  continuationSessionName
} from "./context-handover.mjs";

test("continuationSessionName: fresh, second, and collision cases", () => {
  // normName (matching pipelineStepSessionName and brainSessionName)
  // collapses "--" separators to a single dash, so a real session name is
  // single-dash even though the design prose writes it with double dashes.
  assert.equal(continuationSessionName("tangent-x-s2", new Set()), "tangent-x-s2-g2");
  assert.equal(continuationSessionName("tangent-x-s2", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3");
  assert.equal(continuationSessionName("tangent-x-s2-g2", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3", "strips the existing generation suffix before deriving the next one");
  assert.equal(continuationSessionName("tangent-x-s2-g2-r3", new Set(["tangent-x-s2-g2"])), "tangent-x-s2-g3", "also strips a collision -r suffix");
});

test("continuationSection orders entries and skips failed ones", () => {
  const entries = [
    { session: "tangent--x--s2", facts: "did part 1" },
    { session: "tangent--x--s2--g2", facts: "never arrived", failed: true },
    { session: "tangent--x--s2--g3", facts: "did part 2" }
  ];
  const section = continuationSection({ index: 2, total: 3, entries, subject: "step" });
  assert.match(section, /^## Continuing this step/);
  assert.match(section, /You are a fresh session continuing step 2 of 3\./);
  assert.match(section, /### Continuation 1 \(from tangent--x--s2\)\n\ndid part 1/);
  assert.match(section, /### Continuation 2 \(from tangent--x--s2--g3\)\n\ndid part 2/);
  assert.doesNotMatch(section, /never arrived/);
  assert.doesNotMatch(section, /tangent--x--s2--g2\)/);
  assert.match(section, /The working tree already holds that session's uncommitted work\. Continue; do not repeat commits or work the facts call finished\.$/);
});

test("continuationSection for a solo Goal names the Goal, not a step", () => {
  const section = continuationSection({ index: 1, total: 1, entries: [{ session: "tangent-x", facts: "wrote the design" }], subject: "Goal" });
  assert.match(section, /^## Continuing this Goal/);
  assert.match(section, /You are a fresh session continuing this Goal\./);
});
