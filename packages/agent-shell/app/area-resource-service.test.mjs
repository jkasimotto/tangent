import assert from "node:assert/strict";
import test from "node:test";

import { createAreaResourceService } from "./area-resource-service.mjs";

const AREA = "otto/tangent";
const REPOSITORY_ID = "11111111-1111-4111-8111-111111111111";
const WORKTREE_ID = "22222222-2222-4222-8222-222222222222";

/** Builds one current projection entity fixture. */
function entity(owner, id, target, label = "Resource") {
  return {
    locator: { owner, id },
    label,
    target,
    representation: { state: "current", value: "never-placed" },
    origin: null,
    warnings: [],
    local: { state: "not-checked", value: null, checkedAt: null },
    link: null,
  };
}

/** Builds one explicit discovery Suggestion fixture. */
function suggestion(overrides = {}) {
  return {
    owner: AREA,
    target: { kind: "worktree", path: "/repo/worktree" },
    evidence: { kind: "attempt", jobSlug: "map", run: 1, assignmentId: "a", attemptId: "one" },
    evidenceHash: "evidence-one",
    targetFingerprint: "target-one",
    proposedLabel: "worktree",
    provenanceLabel: "Used by Goal map",
    ...overrides,
  };
}

/** Builds one isolated composed service and observable dependency calls. */
function fixture(overrides = {}) {
  const calls = { discovery: 0, refresh: [], resolve: [], mutation: [], representation: [] };
  let decisions = [];
  const repository = entity(AREA, REPOSITORY_ID, { kind: "repository", path: "/repo" }, "Repo");
  const projection = {
    /** Returns the stable current Area panel fixture. */
    async read() {
      return {
        state: "current",
        viewedFrom: AREA,
        rows: [{ viewedFrom: AREA, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: repository }],
        catalogs: [{ owner: AREA, revision: null }],
        legacyReview: [],
        suggestions: [],
        counts: { state: "current", confirmedAssociations: 1, suggestions: 0, legacyReview: 0 },
      };
    },
    /** Returns mutable durable decision evidence for suppression proof. */
    async evidence() { return { state: "current", owner: AREA, decisions, suggestions: [], legacyReview: [] }; },
    /** Resolves the known worktree and retains unknown ordered locators as gone. */
    async resolve({ resources }) {
      calls.resolve.push(structuredClone(resources));
      return {
        resolutions: resources.map((locator) => locator.id === WORKTREE_ID
          ? { state: "current", value: entity(locator.owner, locator.id, { kind: "worktree", path: "/repo/worktree" }, "WT") }
          : { state: "gone", value: {
              locator: { owner: locator.owner, id: locator.id },
              reason: "missing-record",
              representation: locator.representation ?? "on-map",
              lastKnown: locator.lastKnown ?? null,
              warnings: [],
            } }),
        catalogs: [{ owner: AREA, revision: "r1" }],
      };
    },
  };
  const service = createAreaResourceService({
    projection,
    observations: {
      /** Records the exact current entities admitted to observation. */
      async refresh(resources) { calls.refresh.push(resources.map((item) => item.locator)); },
    },
    mutations: {
      /** Records one catalog mutation adapter call. */
      async apply(input) { calls.mutation.push(input); return { status: 200, operationId: input.operationId }; },
    },
    representations: {
      /** Records one source-representation adapter call. */
      async apply(input) { calls.representation.push(input); return { status: 200, operationId: input.operationId }; },
    },
    /** Returns duplicate target evidence from one explicit bounded scan. */
    async discover({ repositories }) {
      calls.discovery += 1;
      assert.deepEqual(repositories.map((item) => item.locator), [{ owner: AREA, id: REPOSITORY_ID }]);
      return { state: "current", suggestions: [suggestion(), suggestion({ evidenceHash: "duplicate-evidence" })], sources: [], problems: [] };
    },
    /** Confines the fixture to its one physical Area. */
    areaExists: async (area) => area === AREA,
    /** Returns one normalized target without touching the filesystem. */
    inspectTarget: async (target) => ({ kind: "local", normalized: target, state: "available", targetFingerprint: "target" }),
    ...overrides,
  });
  /** Replaces the durable catalog decision fixture. */
  function setDecisions(value) { decisions = value; }
  return { service, calls, setDecisions };
}

test("read stays side-effect free while explicit discovery becomes selectable and target-deduplicated", async () => {
  const { service, calls } = fixture();
  assert.equal((await service.read({ area: AREA })).suggestions.length, 0);
  assert.equal(calls.discovery, 0);

  const found = await service.discover({ area: AREA });
  assert.equal(found.suggestions.length, 1);
  assert.equal(calls.discovery, 1);

  const after = await service.read({ area: AREA });
  assert.deepEqual(after.suggestions, found.suggestions);
  assert.equal(after.counts.suggestions, 1);
  assert.equal(calls.discovery, 1);
});

test("durable decisions suppress retained discovery evidence without another Git scan", async () => {
  const { service, calls, setDecisions } = fixture();
  const found = await service.discover({ area: AREA });
  setDecisions([{
    decision: "dismissed",
    evidence: found.suggestions[0].evidence,
    evidenceHash: found.suggestions[0].evidenceHash,
    targetFingerprint: found.suggestions[0].targetFingerprint,
    decidedAt: "2026-09-02T00:00:00.000Z",
  }]);
  assert.equal((await service.read({ area: AREA })).suggestions.length, 0);
  assert.equal((await service.evidence({ area: AREA })).suggestions.length, 0);
  assert.equal(calls.discovery, 1);
});

test("refresh observes only current entities and returns every requested resolution in order", async () => {
  const { service, calls } = fixture();
  const resources = [{ owner: AREA, id: WORKTREE_ID }, { owner: AREA, id: "missing" }];
  const result = await service.refresh({ resources });
  assert.deepEqual(calls.refresh, [[resources[0]]]);
  assert.deepEqual(result.results.map((item) => item.state), ["current", "gone"]);
  assert.deepEqual(result.resolutions.map((item) => item.value.locator), resources);
});

test("resolve preserves validated Last-known and representation facts for a missing record", async () => {
  const { service, calls } = fixture();
  const request = {
    locator: { owner: AREA, id: "missing" },
    representation: "hidden",
    lastKnown: { label: "Former checkout", target: { kind: "worktree", path: "/repo/former" } },
  };
  const resolved = await service.resolve({ resources: [request] });
  assert.deepEqual(calls.resolve[0], [{
    owner: AREA,
    id: "missing",
    representation: "hidden",
    lastKnown: request.lastKnown,
  }]);
  assert.deepEqual(resolved.resolutions[0].value.lastKnown, request.lastKnown);
  assert.equal(resolved.resolutions[0].value.representation, "hidden");

  await assert.rejects(service.resolve({ resources: [{
    ...request,
    lastKnown: { label: "Unsafe", target: { kind: "worktree", path: "relative/path" } },
  }] }), { status: 422, code: "invalid-resource-target" });
});

test("service rejects unsafe Areas and more than 500 locators before calling dependencies", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.read({ area: "@root" }), { status: 422, code: "invalid-resource-target" });
  await assert.rejects(service.read({ area: "missing/area" }), { status: 404, code: "area-not-found" });
  await assert.rejects(service.resolve({ resources: Array.from({ length: 501 }, () => ({ owner: AREA, id: WORKTREE_ID })) }), { status: 400, code: "invalid-resource-request" });
  assert.equal(calls.discovery, 0);
  assert.deepEqual(calls.refresh, []);
});

test("mutation, representation, and target inspection keep their typed adapter contracts", async () => {
  const { service, calls } = fixture();
  assert.equal((await service.inspectTarget({ kind: "worktree", path: "/repo/worktree" })).state, "available");
  await service.apply({ schema: "area-map-resource-mutation.v1", operationId: "add-1" });
  await service.representation({ schema: "area-map-resource-representation.v1", operationId: "place-1" });
  assert.deepEqual(calls.mutation.map((item) => item.operationId), ["add-1"]);
  assert.deepEqual(calls.representation.map((item) => item.operationId), ["place-1"]);
});
