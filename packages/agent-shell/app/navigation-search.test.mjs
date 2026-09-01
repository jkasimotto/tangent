import test from "node:test";
import assert from "node:assert/strict";
import { buildNavigationSearch } from "./navigation-search.mjs";

test("the Area facet stays complete after root material fills the mixed result limit", async () => {
  const areaIds = ["otto", "otto/tangent", "otto/tangent/deep"];
  const result = await buildNavigationSearch({
    query: "",
    requestedLimit: 100,
    areaIds,
    /** Returns enough root Goals to exhaust the mixed result limit. */
    readAreaGoals: async (area) => area === "otto" ? Array.from({ length: 120 }, (_, index) => ({
      title: `Root goal ${index}`,
      slug: `root-${index}`,
      file: `otto/goal-root-${index}.md`,
      status: "active",
    })) : [],
    /** Returns no Documents for this focused fixture. */
    readAreaDocuments: async () => [],
    brains: [],
  });

  assert.equal(result.rows.length, 100, "mixed navigation results stay bounded");
  assert.deepEqual(result.areas.map((area) => area.path), areaIds, "later descendant Areas remain available to the filter");
  assert.equal(result.areasComplete, true);
});
