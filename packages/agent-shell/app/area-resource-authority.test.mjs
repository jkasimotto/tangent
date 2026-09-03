import assert from "node:assert/strict";
import test from "node:test";

import { createAreaResourceCatalogAuthority } from "./area-resource-authority.mjs";
import { serializeAreaResourceCatalog } from "./area-resource-catalog.mjs";

const ACTIVE_ID = "11111111-1111-4111-8111-111111111111";
const REMOVED_ID = "22222222-2222-4222-8222-222222222222";

/** Creates one transaction reader over an exact optional catalog value. */
function authority(catalog = null) {
  const content = catalog === null ? null : Buffer.from(serializeAreaResourceCatalog(catalog));
  return createAreaResourceCatalogAuthority({ transactions: {
    /** Returns the exact fixture bytes. */
    async readExact(file) { return { file, content, hash: content ? "revision" : null }; },
  } });
}

/** Returns one valid catalog with active and removed membership. */
function catalog() {
  return {
    schema: "area-map-resources.v1",
    resources: [
      { id: ACTIVE_ID, label: "Feature", membership: { state: "active" }, createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", target: { kind: "worktree", path: "/tmp/feature" }, origin: null },
      { id: REMOVED_ID, label: "Old", membership: { state: "removed", removedAt: "2026-09-02T01:00:00Z" }, createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T01:00:00Z", target: { kind: "repository", path: "/tmp/old" }, origin: null },
    ],
    suggestionDecisions: [],
  };
}

test("exact catalog authority distinguishes active, tombstone, and missing identities", async () => {
  const value = authority(catalog());
  assert.equal((await value.resolve({ owner: "otto/tangent", id: ACTIVE_ID })).state, "active");
  assert.equal((await value.resolve({ owner: "otto/tangent", id: REMOVED_ID })).state, "tombstone");
  assert.equal((await value.resolve({ owner: "otto/tangent", id: "33333333-3333-4333-8333-333333333333" })).state, "missing");
});

test("a missing catalog is empty while unsafe owners and unsupported bytes never become missing records", async () => {
  assert.equal((await authority().read("otto/tangent")).revision, null);
  await assert.rejects(authority().resolve({ owner: "@root", id: ACTIVE_ID }), (error) => error.code === "invalid-resource-target");
  const unsupported = createAreaResourceCatalogAuthority({ transactions: {
    /** Returns one newer catalog discriminant. */
    async readExact(file) { return { file, content: Buffer.from('{"schema":"area-map-resources.v2","resources":[],"suggestionDecisions":[]}\n'), hash: "newer" }; },
  } });
  await assert.rejects(unsupported.resolve({ owner: "otto/tangent", id: ACTIVE_ID }), (error) => error.code === "catalog-unsupported" && error.status === 409);
});
