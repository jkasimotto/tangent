import assert from "node:assert/strict";
import test from "node:test";

import { goalManifest, migrateGoalText, migrateRosterText, rosterManifest } from "./migrate-neara-assignees.mjs";

test("the reviewed 13-file inventory remains the first migration set", () => {
  assert.deepEqual(goalManifest.slice(0, 13).map((entry) => entry.file), [
    "neara/onboarding/goal-build-the-embedded-js-onboarding-walkthrough-app.md",
    "neara/pgande/benchmarking/goal-show-force-difference-model-pole-vs-o-calc-pldb.md",
    "neara/pgande/benchmarking/goal-pldb-mutation-mismatch-plain-diff-check.md",
    "neara/pgande/benchmarking/goal-benchmark-poles-against-o-calc-pldb-forces.md",
    "neara/pgande/dashboards/goal-scope-dashboard-metrics.md",
    "neara/pgande/autodesign/goal-pole-diff-define-what-it-actually-is.md",
    "neara/pgande/autodesign/goal-guy-clearances-scope-what-they-are-and-how-work.md",
    "neara/pgande/autodesign/goal-suppress-checks-and-remediations-per-element.md",
    "neara/pgande/autodesign/goal-decide-reframe-autodesign-remediation-to-consume.md",
    "neara/pgande/autodesign/goal-improved-drill-down-find-dan-s-branch.md",
    "neara/pgande/autodesign/goal-julian-understand-the-existing-autodesign-code.md",
    "neara/pgande/megabranch/goal-julian-land-cad-tooling-snap-points.md",
    "neara/pgande/megabranch/goal-will-land-his-stuff.md",
  ]);
});

test("migration preserves prose, writes the field, and is idempotent", () => {
  const entry = goalManifest.find((item) => item.assignees.length === 2);
  const source = `---\ntype: goal\nstatus: open\n---\n\n# Goal\n\n${entry.owner} Keep this explanation.\n`;
  const first = migrateGoalText(source, entry);
  assert.equal(first.changed, true);
  assert.match(first.text, /^assignees: \[Dan, Brida\]$/m);
  assert.match(first.text, /Keep this explanation\./);
  assert.doesNotMatch(first.text, /^Owner:/m);
  assert.deepEqual(migrateGoalText(first.text, entry), { text: first.text, changed: false });
});

test("migration stops on source drift", () => {
  const entry = goalManifest[0];
  assert.throws(() => migrateGoalText("---\ntype: goal\n---\n", entry), /expected owner clause/);
});

test("roster migration is idempotent and refuses to overwrite later edits", () => {
  const entry = rosterManifest[0];
  const source = `# PG&E\n\n## People\n\n${entry.before.map((name) => `- ${name}`).join("\n")}\n\n## Work\n`;
  const first = migrateRosterText(source, entry);
  assert.equal(first.changed, true);
  assert.deepEqual(migrateRosterText(first.text, entry), { text: first.text, changed: false });
  assert.throws(() => migrateRosterText(first.text.replace("- Julian\n", "- Julian\n- Alex\n"), entry), /expected people roster/);
});

test("a partial migrated Goal does not count as idempotent", () => {
  const entry = goalManifest.find((item) => item.replacement);
  const partial = `---\ntype: goal\nassignees: [${entry.assignees.join(", ")}]\n---\n\n# Goal\n`;
  assert.throws(() => migrateGoalText(partial, entry), /expected owner clause/);
});
