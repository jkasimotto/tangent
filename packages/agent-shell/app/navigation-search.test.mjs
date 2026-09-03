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
  assert.deepEqual(result.kinds, ["area", "design", "reference"], "object and Document categories survive the bounded projection");
});

test("navigation returns explicit Areas, Area notes, and Brain destinations", async () => {
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

  assert.deepEqual(result.rows.map((row) => row.kind).sort(), ["area", "brain", "note"]);
  assert.equal(result.rows.find((row) => row.kind === "area").area, "otto/tangent");
  assert.equal(result.areas[0].status, "archived");
  assert.deepEqual(result.kinds, ["area", "brain"]);
});

test("retained Work Goals and agents are routable with their responsible Areas", async () => {
  const result = await buildNavigationSearch({
    query: "map first",
    requestedLimit: 100,
    areaIds: ["otto", "otto/tangent"],
    /** Returns the one Document stored in the Tangent fixture Area. */
    readAreaDocuments: async (area) => area === "otto/tangent" ? [{
      file: "otto/tangent/design-map-first.md",
      area,
      kind: "document",
      title: "Map first contract",
      mtime: 10,
      links: [],
    }] : [],
    areas: [
      { id: "otto", label: "Otto", state: "open" },
      { id: "otto/tangent", label: "Tangent", state: "open" },
    ],
    goals: [{
      id: "otto/tangent/goal-map-first.md",
      areaId: "otto/tangent",
      title: "Map first implementation",
      lifecycle: "open",
      startedAt: "2026-09-01T00:00:00.000Z",
    }],
    agents: [
      {
        id: "map-first-worker",
        target: "map-first-worker:0.0",
        role: "worker",
        areaId: null,
        owner: { kind: "assignment", goalId: "otto/tangent/goal-map-first.md" },
        liveness: "live",
        activity: "working",
        activitySince: "2026-09-01T02:00:00.000Z",
        workTitle: "Map first implementation",
      },
      {
        id: "tangent-brain-repair",
        role: "repair",
        areaId: null,
        owner: { kind: "repair", id: "otto/tangent" },
        liveness: "unknown",
        activity: "unknown",
        observedAt: "2026-09-01T01:00:00.000Z",
      },
      {
        id: "completed-worker",
        role: "worker",
        areaId: "otto/tangent",
        owner: { kind: "none", id: null },
        liveness: "ended",
        activity: "unknown",
        observedAt: "2026-09-01T00:30:00.000Z",
        workTitle: "Map first completed worker",
      },
    ],
    brains: [],
  });

  assert.equal(result.rows[0].kind, "agent", "the established live-first rank is unchanged");
  assert.equal(result.rows[0].session, "map-first-worker");
  assert.equal(result.rows[0].area, "otto/tangent", "an assignment resolves through its Goal Area");
  assert.ok(result.rows.some((row) => row.kind === "goal" && row.file === "otto/tangent/goal-map-first.md" && row.area === "otto/tangent"));
  assert.ok(result.rows.some((row) => row.kind === "document" && row.file === "otto/tangent/design-map-first.md" && row.area === "otto/tangent"));
  assert.equal(result.rows.some((row) => row.kind === "agent" && row.session === "completed-worker"), false, "a historical ended Agent is not advertised as a current runtime destination");
  assert.deepEqual(result.kinds, ["area", "goal", "design", "agent"]);

  const repair = await buildNavigationSearch({
    query: "tangent brain repair",
    requestedLimit: 1,
    areaIds: ["otto/tangent"],
    /** Returns no Documents for the repair-only fixture. */
    readAreaDocuments: async () => [],
    goals: [],
    agents: [{
      id: "tangent-brain-repair",
      role: "repair",
      areaId: null,
      owner: { kind: "repair", id: "otto/tangent" },
      liveness: "unknown",
      activity: "unknown",
      observedAt: "2026-09-01T01:00:00.000Z",
    }],
    brains: [],
  });
  assert.equal(repair.rows.length, 1, "the mixed result remains bounded by the requested limit");
  assert.equal(repair.rows[0].area, "otto/tangent", "a repair agent resolves through its Brain Area");
  assert.equal(repair.areas.length, 1, "the result bound does not truncate the Area facet");
});
