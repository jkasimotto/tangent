import assert from "node:assert/strict";
import test from "node:test";
import { projectDesk } from "./desk-projection.mjs";

test("desk projection owns panels, ordering, and Goal attention", () => {
  const vault = {
    areas: [
      { path: "otto/a", goals: [{ file: "otto/a/goal-one.md", status: "open", changedAt: 10 }], documents: [] },
      { path: "otto/b", goals: [{ file: "otto/b/goal-two.md", status: "active", changedAt: 20 }], documents: [] },
    ],
  };
  const sessions = [{ name: "two", area: "otto/b", goal: "otto/b/goal-two.md", state: "working" }];
  const desk = projectDesk(vault, sessions);
  assert.deepEqual(desk.panels.map((panel) => panel.path), ["otto/b", "otto/a"]);
  assert.equal(desk.attention["otto/a/goal-one.md"], "ready");
  assert.equal(desk.attention["otto/b/goal-two.md"], "working");
});

test("desk projection keeps a Document-only Area visible", () => {
  const vault = { areas: [{ path: "otto/reference", goals: [], documents: [{ file: "otto/reference/note.md", changedAt: 5 }] }] };
  assert.deepEqual(projectDesk(vault, []).panels, [{ path: "otto/reference", sections: [] }]);
});
