import test from "node:test";
import assert from "node:assert/strict";
await import("./public/go-to-core.js");

const core = globalThis.AgentShellGoTo;

/** Builds one finder row with the fields the ranker reads. */
function row(fields) {
  return { key: fields.name, kind: "document", kindLabel: "design", name: "", area: "otto/tangent", changedAt: 0, live: false, ...fields };
}

/** The names of the ranked rows, in order. */
function names(rows) {
  return rows.map((item) => item.name);
}

test("normalizedSearchText strips separators and word endings", () => {
  assert.equal(core.normalizedSearchText("The Right Document, reading"), "the right document read");
});

test("an empty query lists live brains first, then the newest change, within the limit", () => {
  const rows = [
    row({ name: "Newest design", changedAt: 3 }),
    row({ name: "Older note", kind: "note", kindLabel: "Area note", changedAt: 2 }),
    row({ name: "Tangent", kind: "brain", kindLabel: "Brain", changedAt: 1, live: true }),
  ];
  assert.deepEqual(names(core.matchRows(rows, "", 2)), ["Tangent", "Newest design"]);
});

test("word order does not matter", () => {
  const rows = [row({ name: "The right Document at each work moment" }), row({ name: "Area map" })];
  assert.deepEqual(names(core.matchRows(rows, "document right", 12)), ["The right Document at each work moment"]);
});

test("separators do not matter", () => {
  const rows = [row({ name: "Area map" }), row({ name: "Area note", area: "otto/other" })];
  assert.deepEqual(names(core.matchRows(rows, "areamap", 12)), ["Area map"]);
});

test("every typed word must match", () => {
  const rows = [row({ name: "The right Document", area: "otto/tangent" })];
  assert.deepEqual(core.matchRows(rows, "right map", 12), []);
});

test("an Area word narrows two rows of the same name", () => {
  const rows = [row({ name: "Design", area: "otto/tangent" }), row({ name: "Design", area: "neara/pgande" })];
  const matched = core.matchRows(rows, "design tangent", 12);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].area, "otto/tangent");
});

test("a word in the name ranks above a word in the Area path", () => {
  const rows = [
    row({ name: "Area map", kindLabel: "design", area: "otto/tangent", changedAt: 5 }),
    row({ name: "Tangent", kind: "note", kindLabel: "Area note", area: "otto/tangent", changedAt: 5 }),
    row({ name: "Tangent", kind: "brain", kindLabel: "Brain", area: "otto/tangent", changedAt: 5 }),
  ];
  const matched = core.matchRows(rows, "tangent", 12);
  assert.deepEqual(matched.map((item) => item.kindLabel), ["Area note", "Brain", "design"]);
});

test("the kind word narrows the list", () => {
  const rows = [
    row({ name: "Area map", kindLabel: "design", area: "otto/tangent" }),
    row({ name: "Tangent", kind: "note", kindLabel: "Area note", area: "otto/tangent" }),
    row({ name: "Tangent", kind: "brain", kindLabel: "Brain", area: "otto/tangent" }),
  ];
  assert.deepEqual(core.matchRows(rows, "brain tangent", 12).map((item) => item.kind), ["brain"]);
});

test("equal tiers break by the newest change", () => {
  const rows = [row({ name: "Area map old", changedAt: 1 }), row({ name: "Area map new", changedAt: 9 })];
  assert.deepEqual(names(core.matchRows(rows, "area map", 12)), ["Area map new", "Area map old"]);
});

test("returnPointFrom copies the identifying keys, the scroll, and the reader's Document", () => {
  const scroll = { screen: 120, inner: [[".document-reader-scroll", 40]] };
  const reader = {
    view: "document",
    currentFile: "otto/tangent/goal-x.md",
    areaSelection: "otto/tangent",
    describeDraft: { description: "not copied" },
    document: { file: "otto/tangent/design-x.md" },
    documentTrail: ["otto/tangent/design-x.md"],
    documentTrailIndex: 0,
  };
  const point = core.returnPointFrom(reader, scroll);
  assert.deepEqual(Object.keys(point.state).sort(), [...core.RETURN_POINT_KEYS].sort());
  assert.equal(point.state.view, "document");
  assert.equal(point.state.areaSelection, "otto/tangent");
  assert.equal("describeDraft" in point.state, false);
  assert.equal(point.scroll, scroll);
  assert.deepEqual(point.document, { file: "otto/tangent/design-x.md", trail: ["otto/tangent/design-x.md"], trailIndex: 0 });
  assert.equal(core.returnPointFrom({ view: "work" }, scroll).document, null);
});

test("returnPointLabel names the captured screen", () => {
  assert.equal(core.returnPointLabel(null), "Work");
  assert.equal(core.returnPointLabel({ state: { view: "describe-agent" } }), "Agent");
  assert.equal(core.returnPointLabel({ state: { view: "describe-agent" } }, { brain: true }), "Brain");
  assert.equal(core.returnPointLabel({ state: { view: "areas" } }), "Areas");
  assert.equal(core.returnPointLabel({ state: { view: "nowhere" } }), "Work");
});
