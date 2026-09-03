import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LegacyReviewRow, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import { shardOwner } from "../../units/ids.ts";
import type { ResourceId } from "../../units/ids.ts";
import { catalogFencesFor, projectionErrorMessage, readResourceFailure, resourceMutationOwners, suggestionReference } from "./resources-wire.ts";

const TANGENT = shardOwner("otto/tangent");
const OTTO = shardOwner("otto");

test("a refused request is read into its code, its words, its evidence and its projection", () => {
  const projection = { state: "current" as const, rows: [], legacyReview: [], suggestions: [] };
  const refused = Object.assign(new Error("thrown words"), { payload: { code: "catalog-revision-changed", error: "Injected catalog conflict", recovery: { projection } } });
  const failure = readResourceFailure(refused, "fallback");
  assert.deepEqual([failure.code, failure.message, failure.aborted], ["catalog-revision-changed", "Injected catalog conflict", false]);
  assert.equal(failure.projection, projection, "the recovery projection is the one the panel installs");
});

test("a thrown value with no payload falls back to its own words, then to the caller's", () => {
  assert.equal(readResourceFailure(new Error("Injected panel read failure"), "fallback").message, "Injected panel read failure");
  assert.equal(readResourceFailure(new Error(""), "fallback").message, "fallback");
  assert.equal(readResourceFailure(null, "fallback").message, "fallback");
  assert.deepEqual([readResourceFailure(null, "fallback").code, readResourceFailure(null, "fallback").recovery], [null, {}]);
  assert.equal(readResourceFailure(Object.assign(new Error("stop"), { name: "AbortError" }), "fallback").aborted, true);
  assert.equal(readResourceFailure(Object.assign(new Error("no payload"), { code: "resource-source-load-failed" }), "fallback").code, "resource-source-load-failed");
});

test("a Suggestion travels back as the exact evidence fields the route contract accepts", () => {
  const suggestion: ResourceSuggestion = { owner: OTTO, proposedLabel: "Shared staging", target: { kind: "worktree", path: "/tmp/staging" }, evidence: { line: 3 }, evidenceHash: "evidence-1", targetFingerprint: "fingerprint-1" };
  assert.deepEqual(suggestionReference(suggestion), { owner: OTTO, target: { kind: "worktree", path: "/tmp/staging" }, evidence: { line: 3 }, evidenceHash: "evidence-1", targetFingerprint: "fingerprint-1" });
  const candidate: LegacyReviewRow = { state: "candidate", owner: TANGENT, field: "Worktree", evidenceHash: "legacy-main" };
  assert.deepEqual(Object.keys(suggestionReference(candidate)).sort(), ["evidence", "evidenceHash", "owner", "target", "targetFingerprint"]);
});

test("each mutation names the catalogs it writes, and the fence keeps only those owners", () => {
  const resource = { owner: TANGENT, id: "worktree-main" as ResourceId };
  const input = { target: { kind: "worktree" as const, path: "/tmp/new" } };
  assert.deepEqual(resourceMutationOwners({ kind: "add", owner: TANGENT, input, label: null }), [TANGENT]);
  assert.deepEqual(resourceMutationOwners({ kind: "edit", resource, input, label: null }), [TANGENT]);
  assert.deepEqual(resourceMutationOwners({ kind: "remove", resource }), [TANGENT]);
  assert.deepEqual(resourceMutationOwners({ kind: "dismiss-suggestion", suggestion: suggestionReference({ owner: OTTO }) }), [OTTO]);
  assert.deepEqual(resourceMutationOwners({ kind: "import-legacy", selections: [{ candidate: suggestionReference({ owner: OTTO }), attachDeclaredBranch: false }] }), [OTTO]);
  assert.deepEqual(resourceMutationOwners({ kind: "undo", token: "undo-1" }), [], "an undo carries no catalog fence");
  assert.deepEqual(resourceMutationOwners(null), []);
  const catalogs = [{ owner: TANGENT, revision: "cat-child" }, { owner: OTTO, revision: "cat-parent" }];
  assert.deepEqual(catalogFencesFor(catalogs, [TANGENT]), [{ owner: TANGENT, revision: "cat-child" }]);
  assert.deepEqual(catalogFencesFor(undefined, [TANGENT]), []);
});

test("a projection error prints its own words, else the fallback sentence", () => {
  assert.equal(projectionErrorMessage({ message: "Source unavailable" }, "did not load"), "Source unavailable");
  assert.equal(projectionErrorMessage(undefined, "did not load"), "did not load");
  assert.equal(projectionErrorMessage({ message: "" }, "did not load"), "did not load");
});
