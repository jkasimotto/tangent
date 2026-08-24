import assert from "node:assert/strict";
import test from "node:test";

import {
  assigneesFromFrontmatter,
  nearestRosterArea,
  peopleFromAreaNote,
  personKey,
  projectAssignees,
  validateAssignees,
  withAssigneesFrontmatter,
  withPeopleSection,
} from "./human-assignees.mjs";

test("a child inherits the nearest roster and a nested roster replaces it", () => {
  const notes = new Map([
    ["otto", "# Otto\n\n## People\n\n- Julian\n- Dan\n"],
    ["otto/pgande", "# PG&E\n"],
    ["otto/pgande/local", "# Local\n\n## People\n\n- Troy\n"],
  ]);
  assert.equal(nearestRosterArea("otto/pgande", notes), "otto");
  assert.equal(nearestRosterArea("otto/pgande/local", notes), "otto/pgande/local");
  assert.equal(nearestRosterArea("other", notes), null);
});

test("same labels in separate rosters have separate keys while descendants retain a key", () => {
  assert.notEqual(personKey("one", "Dan"), personKey("two", "Dan"));
  assert.equal(personKey("one", "Dan"), personKey("one", " dan "));
});

test("assignees are validated as a set and stored in roster order", () => {
  assert.deepEqual(validateAssignees(["Brida", "Dan"], ["Julian", "Dan", "Brida"]), ["Dan", "Brida"]);
  assert.throws(() => validateAssignees(["Dan", "dan"], ["Dan"]), /more than once/);
  assert.throws(() => validateAssignees(["Troy"], []), /no people roster/);
});

test("projection keeps one Goal with two labels and explicit unassigned data", () => {
  assert.deepEqual(projectAssignees(["Dan", "Brida"], "otto/pgande"), {
    assignees: ["Dan", "Brida"],
    assigneeKeys: ["otto/pgande::dan", "otto/pgande::brida"],
    unassigned: false,
  });
  assert.equal(projectAssignees([], "otto/pgande").unassigned, true);
});

test("People and assignee storage round-trip", () => {
  const note = "---\ntype: area\n---\n\n# Area\n\n## Purpose\n\nWork.\n";
  const changed = withPeopleSection(note, ["Julian", "Troy"]);
  assert.deepEqual(peopleFromAreaNote(changed), ["Julian", "Troy"]);
  const goal = withAssigneesFrontmatter("---\ntype: goal\nstatus: open\n---\n\n# Goal\n", ["Troy"]);
  assert.deepEqual(assigneesFromFrontmatter("[Troy]"), ["Troy"]);
  assert.match(goal, /^assignees: \[Troy\]$/m);
});
