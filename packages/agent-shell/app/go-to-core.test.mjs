import test from "node:test";
import assert from "node:assert/strict";
import core from "./public/go-to-core.js";
import { buildGoToRows } from "./public/go-to-rows.js";

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

test("fileSlug takes the basename without extension", () => {
  assert.equal(core.fileSlug("otto/tangent/design-done-goals-timeline.md"), "design done goals timeline");
  assert.equal(core.fileSlug(undefined), "");
});

test("a file-name slug finds a Document whose title differs", () => {
  const rows = [
    row({ name: "The timeline: what got done and what happened, day by day", file: "otto/tangent/design-done-goals-timeline.md" }),
    row({ name: "Area map", file: "otto/tangent/design-area-map.md" }),
  ];
  assert.deepEqual(names(core.matchRows(rows, "design-done-goals", 12)), ["The timeline: what got done and what happened, day by day"]);
});

test("a title match ranks above a file-name-slug-only match", () => {
  const rows = [
    row({ name: "Design", file: "otto/tangent/plan-x.md", changedAt: 1 }),
    row({ name: "Other", file: "otto/tangent/design-x.md", changedAt: 9 }),
  ];
  assert.deepEqual(names(core.matchRows(rows, "design", 12)), ["Design", "Other"]);
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

test("a live brain ranks before a newer Document of the same tier", () => {
  const rows = [
    row({ name: "Plan: otto/tangent brain", kindLabel: "plan", changedAt: 9 }),
    row({ name: "Otto / Tangent", kind: "brain", kindLabel: "Brain", changedAt: 1, live: true }),
  ];
  assert.deepEqual(names(core.matchRows(rows, "brain tangent", 12)), ["Otto / Tangent", "Plan: otto/tangent brain"]);
});

test("returnPointFrom copies the identifying keys, the scroll, and the reader's Document", () => {
  const scroll = { screen: 120, inner: [[".document-reader-scroll", 40]] };
  const reader = {
    view: "document",
    currentFile: "otto/tangent/goal-x.md",
    areaSelection: "otto/tangent",
    areaFocus: ["otto/tangent"],
    collapsedDeskSections: new Set(["otto/tangent/nested"]),
    describeDraft: { description: "not copied" },
    document: { file: "otto/tangent/design-x.md" },
    documentTrail: ["otto/tangent/design-x.md"],
    documentTrailIndex: 0,
  };
  const point = core.returnPointFrom(reader, scroll);
  assert.deepEqual(Object.keys(point.state).sort(), [...core.RETURN_POINT_KEYS].sort());
  assert.equal(point.state.view, "document");
  assert.equal(point.state.areaSelection, "otto/tangent");
  assert.deepEqual(point.state.areaFocus, ["otto/tangent"]);
  assert.deepEqual([...point.state.collapsedDeskSections], ["otto/tangent/nested"]);
  reader.areaFocus.push("otto/other");
  reader.collapsedDeskSections.clear();
  assert.deepEqual(point.state.areaFocus, ["otto/tangent"], "the return point snapshots Focus");
  assert.deepEqual([...point.state.collapsedDeskSections], ["otto/tangent/nested"], "the return point snapshots expansion");
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

test("the finder filters Documents by an Area subtree and kind", () => {
  const vault = { documents: [
    { file: "otto/dnd/design-map.md", kind: "document", docKind: "design", title: "Map", area: "otto/dnd", changedAt: 3 },
    { file: "otto/dnd/players/reference-player.md", kind: "document", docKind: "reference", title: "Player", area: "otto/dnd/players", changedAt: 2 },
    { file: "otto/tangent/design-shell.md", kind: "document", docKind: "design", title: "Shell", area: "otto/tangent", changedAt: 1 },
  ] };
  const rows = buildGoToRows({
    vault,
    area: "otto/dnd",
    kind: "design",
    /** Returns the fixture Area label. */
    areaLabel: (value) => value,
    /** Returns an empty fixture brain label. */
    brainStateLabel: () => "",
  });
  assert.deepEqual(rows.map((item) => item.name), ["Map"]);
});

test("visible rows with the same kind, title, and Area show their file names", () => {
  const vault = { documents: [
    { file: "otto/tangent/design-search-a.md", kind: "document", docKind: "design", title: "Search", area: "otto/tangent", changedAt: 2 },
    { file: "otto/tangent/design-search-b.md", kind: "document", docKind: "design", title: "Search", area: "otto/tangent", changedAt: 1 },
    { file: "otto/other/design-search.md", kind: "document", docKind: "design", title: "Search", area: "otto/other", changedAt: 3 },
  ] };
  const rows = buildGoToRows({
    vault,
    query: "search",
    /** Returns the fixture Area label. */
    areaLabel: (value) => value,
    /** Returns an empty fixture brain label. */
    brainStateLabel: () => "",
  });
  assert.deepEqual(rows.map((item) => item.detail), [
    "",
    "otto/tangent · design-search-a.md",
    "otto/tangent · design-search-b.md",
  ]);
});
