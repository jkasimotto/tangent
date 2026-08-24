import assert from "node:assert/strict";
import test from "node:test";

import { filterGoalTreesByPerson, goalMatchesPerson, normalizePersonLabel } from "./public/work-desk-view.js";

const root = { file: "goal-root.md", assignees: ["Troy"], assigneeKeys: ["area::troy"] };
const mine = { file: "goal-mine.md", assignees: ["Julian"], assigneeKeys: ["area::julian"] };
const other = { file: "goal-other.md", assignees: ["Dan"], assigneeKeys: ["area::dan"] };

test("a person filter keeps ancestor context and removes unrelated branches", () => {
  const [tree] = filterGoalTreesByPerson([{ root, goals: [root, mine, other] }], "mine");
  assert.deepEqual(tree.goals, [root, mine]);
  assert.deepEqual(tree.personGoals, [mine]);
  assert.deepEqual(filterGoalTreesByPerson([{ root, goals: [root, other] }], "mine"), []);
});

test("Mine and roster keys use stable normalized identity", () => {
  assert.equal(normalizePersonLabel(" Julian  "), "julian");
  assert.equal(goalMatchesPerson({ assignees: ["JULIAN"] }, "mine"), true);
  assert.equal(goalMatchesPerson(mine, "other::julian"), false);
  assert.equal(goalMatchesPerson({ assignees: [], assigneeKeys: [] }, "unassigned"), true);
});
