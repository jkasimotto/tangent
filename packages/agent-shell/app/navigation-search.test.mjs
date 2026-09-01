import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildNavigationSearch } from "./navigation-search.mjs";

test("a late nested Document is found from a complete production-shaped corpus within a strict bound", async () => {
  const areaIds = Array.from({ length: 240 }, (_, index) => `neara/delivery/area-${String(index).padStart(3, "0")}`);
  areaIds.push("neara/delivery/standards");
  const startedAt = performance.now();
  const result = await buildNavigationSearch({
    query: "design-standards",
    requestedLimit: 100,
    areaIds,
    /** Simulates one filesystem turn per Area and many earlier title matches. */
    readAreaDocuments: async (area) => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      if (area === "neara/delivery/standards") return [{
        file: "neara/delivery/standards/design-standards-handbook.md",
        area,
        kind: "document",
        title: "Standards handbook",
        mtime: 1,
        links: [],
      }];
      const index = Number(area.split("-").at(-1));
      return Array.from({ length: index < 120 ? 2 : 0 }, (_, item) => ({
        file: `${area}/reference-${item}.md`,
        area,
        kind: "document",
        title: `Design standards background ${index}-${item}`,
        mtime: index,
        links: [],
      }));
    },
    /** Returns one active Area note. */
    readAreaNote: async (area) => `---\ntype: work\nstatus: active\n---\n\n# ${area.split("/").at(-1)}\n`,
    brains: [],
  });
  const elapsed = performance.now() - startedAt;

  assert.ok(elapsed < 750, `the complete corpus search took ${elapsed.toFixed(0)}ms`);
  assert.equal(result.rows[0].file, "neara/delivery/standards/design-standards-handbook.md", "the exact late file-name match outranks earlier title matches");
  assert.ok(result.rows.some((row) => row.file === "neara/delivery/standards/design-standards-handbook.md"));
  assert.equal(result.areas.length, areaIds.length, "the Area facet stays complete after the mixed row bound");
  assert.equal(result.areasComplete, true);
  assert.deepEqual(result.kinds, ["design", "reference"], "Document categories survive the bounded projection");
});

test("navigation returns Area notes and Brain destinations without scanning Goals", async () => {
  const result = await buildNavigationSearch({
    query: "tangent",
    requestedLimit: 100,
    areaIds: ["otto/tangent"],
    /** Returns no Documents for this destination-only fixture. */
    readAreaDocuments: async () => [],
    /** Returns the archived Area note destination. */
    readAreaNote: async () => "---\ntype: work\nstatus: archived\n---\n\n# Tangent\n",
    brains: [{ areaId: "otto/tangent", agentId: "tangent-brain", updatedAt: "2026-09-01T01:00:00.000Z" }],
  });

  assert.deepEqual(result.rows.map((row) => row.kind).sort(), ["brain", "note"]);
  assert.equal(result.areas[0].status, "archived");
});
