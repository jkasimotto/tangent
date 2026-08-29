import test from "node:test";
import assert from "node:assert/strict";
import picker from "./public/area-board-picker.js";

test("picker sections follow product order and keep sub-Areas contextual", () => {
  const index = [{ kind: "area", area: "otto/tangent/desk", file: "otto/tangent/desk/desk.md", title: "Desk" }, { kind: "goal", area: "otto/tangent", file: "otto/tangent/goal-a.md", title: "A", status: "open" }, { kind: "document", area: "otto/tangent", file: "otto/tangent/design.md", title: "Design", changedAt: 2 }];
  const sections = picker.pickerSections("otto/tangent", index, { commits: [{ sha: "abc", subject: "change", at: 1 }], links: [{ url: "https://example.com", label: "Example" }] });
  assert.deepEqual(sections.map((section) => section.title), ["Goals", "Documents", "Sub-Areas", "Commits", "Links"]);
  assert.equal(sections.find((section) => section.title === "Sub-Areas").choices[0].area, "otto/tangent/desk");
});

test("wide search ranks a title prefix before a recent substring", () => {
  const result = picker.wideChoices("tan", [{ kind: "document", file: "new.md", title: "About tangent", changedAt: 10 }, { kind: "area", file: "tangent.md", title: "Tangent", changedAt: 1 }]);
  assert.equal(result[0].title, "Tangent");
});
