import assert from "node:assert/strict";
import test from "node:test";

import { groupSessionsByProject, projectSlug } from "../dist/index.js";

test("groups sessions by project, newest project first, counting conversations", () => {
  const rail = groupSessionsByProject([
    { id: "a", project: "tangent", lastActivityAt: "2026-06-29T10:00:00.000Z" },
    { id: "b", project: "tangent", lastActivityAt: "2026-06-29T09:00:00.000Z" },
    { id: "c", project: "acme", lastActivityAt: "2026-06-29T11:00:00.000Z" }
  ]);

  assert.deepEqual(rail.map((item) => item.label), ["acme", "tangent"], "most recently active project leads");
  const tangent = rail.find((item) => item.label === "tangent");
  assert.equal(tangent.total, 2);
  assert.equal(tangent.lastActivityAt, "2026-06-29T10:00:00.000Z", "project activity is the newest session's");
});

test("falls back to a (no project) bucket and a stable slug", () => {
  const rail = groupSessionsByProject([{ id: "a" }, { id: "b", project: "otto-tangent" }]);
  const unknown = rail.find((item) => item.label === "(no project)");
  assert.ok(unknown, "sessions without a project fall into (no project)");
  assert.equal(unknown.id, "no-project");
  assert.equal(projectSlug("otto-tangent"), "otto-tangent");
  assert.equal(projectSlug("My App!!"), "my-app");
});

test("sorts the (no project) bucket last regardless of recency", () => {
  const rail = groupSessionsByProject([
    { id: "a", lastActivityAt: "2026-06-29T12:00:00.000Z" }, // no project, most recent overall
    { id: "b", project: "tangent", lastActivityAt: "2026-06-29T09:00:00.000Z" }
  ]);

  assert.deepEqual(rail.map((item) => item.label), ["tangent", "(no project)"], "(no project) sorts last even though it is the most recently active");
});
