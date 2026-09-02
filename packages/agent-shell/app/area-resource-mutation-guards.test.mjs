import assert from "node:assert/strict";
import test from "node:test";

import { emptyAreaResourceCatalog } from "./area-resource-catalog.mjs";
import { createAreaResourceMutationGuardReader } from "./area-resource-mutation-guards.mjs";

/** Returns one exact in-memory note reader for guard tests. */
function exactNotes(values) {
  return {
    /** Reads one fixture path as exact bytes or an exact missing value. */
    readExact: async (file) => ({ file, content: Object.hasOwn(values, file) ? Buffer.from(values[file]) : null }),
  };
}

test("mutation guards capture every owner ancestor and derive note evidence from those exact bytes", async () => {
  const notes = {
    "otto/otto.md": "---\ntype: area\nstatus: active\n---\n# Otto\n## Resources\nRepository: `/tmp/repository`\nBranch: main\n",
    "otto/tangent/tangent.md": "---\ntype: area\nstatus: active\n---\n# Tangent\n## Knowledge\nReview https://github.com/otto/tangent/pull/42\n",
  };
  const retained = [{
    owner: "otto/tangent",
    target: { kind: "worktree", path: "/tmp/feature" },
    evidence: { kind: "attempt", jobSlug: "goal-map", run: 1, assignmentId: "step-1", attemptId: "attempt-1" },
    evidenceHash: "attempt-evidence",
    targetFingerprint: "attempt-target",
  }];
  const reader = createAreaResourceMutationGuardReader({
    transactions: exactNotes(notes),
    /** Returns one exact empty catalog for each evidence owner. */
    readCatalog: async (owner) => ({ state: "current", owner, revision: null, catalog: emptyAreaResourceCatalog() }),
    /** Adds process-local explicit discovery to the evidence lookup. */
    discoverySuggestions: async () => retained,
  });
  const result = await reader({ viewedFrom: "otto/tangent", owners: ["otto", "otto/tangent"], needsEvidence: true });
  assert.deepEqual(result.guards.map(({ file, kind }) => ({ file, kind })), [
    { file: "otto/otto.md", kind: "evidence" },
    { file: "otto/tangent/tangent.md", kind: "evidence" },
  ]);
  assert.equal(result.evidence.legacyReview.length, 1);
  assert.equal(result.evidence.legacyReview[0].declaredBranch, "main");
  assert.equal(result.evidence.suggestions.some((item) => item.target?.url === "https://github.com/otto/tangent/pull/42"), true);
  assert.equal(result.evidence.suggestions.at(-1), retained[0]);
});

test("catalog-only mutation guards include hidden-status ancestors without starting evidence", async () => {
  let catalogReads = 0;
  const reader = createAreaResourceMutationGuardReader({
    transactions: exactNotes({ "otto/otto.md": "", "otto/tangent/tangent.md": "" }),
    /** Records any forbidden catalog read during a catalog-only guard plan. */
    readCatalog: async () => { catalogReads += 1; return { state: "current", catalog: emptyAreaResourceCatalog() }; },
  });
  const result = await reader({ viewedFrom: "otto/tangent", owners: ["otto/tangent"], needsEvidence: false });
  assert.deepEqual(result.guards.map(({ file, kind }) => ({ file, kind })), [
    { file: "otto/otto.md", kind: "status" },
    { file: "otto/tangent/tangent.md", kind: "status" },
  ]);
  assert.equal(result.evidence, null);
  assert.equal(catalogReads, 0);
});

test("invalid UTF-8 evidence is a source error instead of an empty guard", async () => {
  const reader = createAreaResourceMutationGuardReader({
    transactions: {
      /** Returns one deliberately malformed UTF-8 note. */
      readExact: async (file) => ({ file, content: Buffer.from([0xc3, 0x28]) }),
    },
    /** Supplies catalog authority that must not turn bad note bytes into empty evidence. */
    readCatalog: async () => ({ state: "current", catalog: emptyAreaResourceCatalog() }),
  });
  await assert.rejects(
    reader({ viewedFrom: "otto/tangent", owners: ["otto/tangent"], needsEvidence: true }),
    (error) => error.code === "resource-source-invalid" && error.status === 409,
  );
});
