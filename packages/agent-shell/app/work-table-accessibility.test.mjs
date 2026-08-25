// The automated accessibility scan of the Work screen
// (otto/tangent/design-redesign-work-as-a-compact-table, proof 6). axe-core
// runs over the rendered page of each fixture and must report no serious or
// critical violation. The scan reads structure, names, and roles; colour
// contrast needs real layout and is proved in the browser, not here.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { bootWorkTable } from "./work-table-harness.mjs";
import { workTableFixture, withDirectAsks, plannedWorkFixture } from "./work-table-fixture.mjs";

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core"), "utf8");

/**
 * Runs axe-core inside one booted Work page and returns every violation that
 * axe rates serious or critical. Rules that need layout report nothing under
 * jsdom, so they are turned off instead of passing by accident.
 */
async function scan(fixture, options = {}) {
  const { window } = await bootWorkTable(fixture, options);
  window.eval(axeSource);
  const result = await window.axe.run(window.document, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  // The spread rebuilds the list in this realm: axe returns a jsdom array, and
  // a strict comparison against one of ours fails on the prototype alone.
  return [...result.violations].filter((violation) => ["serious", "critical"].includes(violation.impact));
}

/** Names one violation and the first element it found, for a readable failure. */
function describe(violation) {
  return `${violation.impact} ${violation.id}: ${violation.nodes[0]?.html ?? ""}`;
}

test("the current work screen has no serious or critical accessibility violation", async () => {
  const violations = await scan(withDirectAsks(workTableFixture()));
  assert.deepEqual(violations.map(describe), []);
});

test("the planned work screen has no serious or critical accessibility violation", async () => {
  const violations = await scan(plannedWorkFixture(), { workFilter: "inactive" });
  assert.deepEqual(violations.map(describe), []);
});

test("the narrow work screen has no serious or critical accessibility violation", async () => {
  const violations = await scan(withDirectAsks(workTableFixture()), { width: 390 });
  assert.deepEqual(violations.map(describe), []);
});
