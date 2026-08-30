import assert from "node:assert/strict";
import test from "node:test";
import { areaInRestriction, mapFindMatches, mapFindTextMatches, restrictionFoldRoots } from "./public/area-map-find-core.js";

const areas = [
  { path: "neara", parent: "@root", name: "Neara", depth: 0 },
  { path: "neara/delivery", parent: "neara", name: "Delivery", depth: 1 },
  { path: "neara/delivery/standards", parent: "neara/delivery", name: "Standards", depth: 2 },
  { path: "neara/delivery/portland", parent: "neara/delivery", name: "Portland", depth: 2 },
  { path: "neara/hackathon", parent: "neara", name: "Hackathon", depth: 1 },
  { path: "otto", parent: "@root", name: "Otto", depth: 0 },
];

test("map find starts words and ignores separators", () => {
  assert.equal(mapFindTextMatches("Embedded JS", "embeddedjs"), true);
  assert.equal(mapFindTextMatches("neara/delivery/standards", "del stan"), true);
  assert.equal(mapFindTextMatches("Standards", "andard"), false, "a partial word does not match from its middle");
});

test("map find orders every Area before loaded blocks and returns no rows for a miss", () => {
  const blocks = [
    { kind: "goal", elementId: "goal-1", name: "Standards proof", area: "neara/delivery/standards", hidden: true },
    { kind: "document", elementId: "document-1", name: "Standards guide", area: "neara/delivery", hidden: false },
  ];
  assert.deepEqual(mapFindMatches({ areas, blocks }, "standards").map((row) => [row.kind, row.name, row.hidden]), [
    ["area", "Standards", false],
    ["document", "Standards guide", false],
    ["goal", "Standards proof", true],
  ]);
  assert.deepEqual(mapFindMatches({ areas, blocks }, "not here"), []);
  assert.deepEqual(mapFindMatches({ areas, blocks }, ""), []);
});

test("Only keeps the target line and folds the smallest unrelated branch roots", () => {
  assert.equal(areaInRestriction("neara", "neara/delivery/standards"), true);
  assert.equal(areaInRestriction("neara/delivery/standards/child", "neara/delivery/standards"), true);
  assert.equal(areaInRestriction("neara/delivery/portland", "neara/delivery/standards"), false);
  assert.deepEqual(restrictionFoldRoots(areas, "neara/delivery/standards"), ["neara/delivery/portland", "neara/hackathon", "otto"]);
  assert.deepEqual(restrictionFoldRoots(areas, "missing"), []);
});
