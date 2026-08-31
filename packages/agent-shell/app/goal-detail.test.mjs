import assert from "node:assert/strict";
import test from "node:test";
import { projectGoalDetail } from "./goal-detail.mjs";

test("Goal detail returns intent and relations without Job execution", () => {
  const detail = projectGoalDetail({
    goal: {
      file: "otto/test/goal-ship.md", slug: "ship", title: "Ship", status: "active", session: "worker", doneWhen: "The change ships.",
      documents: [{ file: "otto/test/design.md", title: "Design" }],
      dependsOn: [{ file: "goal-api.md", title: "API", status: "deferred" }, { file: "goal-schema.md", title: "Schema", status: "done" }],
      requiredBy: [{ file: "goal-release.md", title: "Release", status: "open" }], unresolvedDependencies: ["missing"],
    },
    markdown: "# Ship\n",
    queue: { revision: 7, assignments: [{ id: "a1" }] },
    sessions: [{ name: "worker" }],
  });
  assert.equal(detail.markdown, "# Ship\n");
  assert.equal(detail.dependencies.blocked, true);
  assert.deepEqual(detail.dependencies.blockers.map((item) => item.status), ["parked", "missing"]);
  assert.deepEqual(detail.relatedDocuments.map((item) => item.file), ["otto/test/design.md"]);
  for (const field of ["queue", "job", "sessions", "attempts", "current"]) assert.equal(Object.hasOwn(detail, field), false, `${field} belongs to Job or Agent detail`);
  assert.deepEqual(detail.commands.map((item) => item.id), ["read", "status"]);
});

test("Goal detail exposes explicit server command reasons unchanged", () => {
  const detail = projectGoalDetail({ goal: { file: "otto/test/goal-ready.md", status: "open" }, commands: [
    { id: "read", label: "Read Goal", enabled: false, reason: "Unavailable." },
    { id: "status", label: "Goal status" },
  ] });
  assert.deepEqual(detail.commands, [
    { id: "read", label: "Read Goal", enabled: false, reason: "Unavailable." },
    { id: "status", label: "Goal status", enabled: true, reason: null },
  ]);
});

test("legacy Deferred never escapes the Goal detail read model", () => {
  const detail = projectGoalDetail({ goal: { file: "otto/test/goal-later.md", status: "deferred" } });
  assert.equal(detail.goal.status, "parked");
});
