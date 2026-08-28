import assert from "node:assert/strict";
import test from "node:test";
import { areaDirectory, areaFilePrefix, ROOT_AREA, rootAreaRow } from "./area-identity.mjs";

test("Root has a nonempty API identity but maps to the vault root", () => {
  assert.equal(ROOT_AREA, "@root");
  assert.equal(areaDirectory("/vault/trees", ROOT_AREA), "/vault/trees");
  assert.equal(areaFilePrefix(ROOT_AREA), "");
  assert.equal(areaDirectory("/vault/trees", "otto/tangent"), "/vault/trees/otto/tangent");
  assert.equal(areaFilePrefix("otto/tangent"), "otto/tangent/");
});

test("the Root row is virtual and leaves physical top-level paths unchanged", () => {
  assert.deepEqual(rootAreaRow(["neara", "otto"]).topLevelAreas, ["neara", "otto"]);
  assert.deepEqual(rootAreaRow().children, []);
  assert.equal(rootAreaRow().virtual, true);
});
