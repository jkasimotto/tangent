import assert from "node:assert/strict";
import test from "node:test";

import {
  publicAreaResourceFailure,
  sanitizeAreaResourceRecovery,
} from "./area-resource-recovery.mjs";

/** Returns one minimal complete current panel projection. */
function projection(fields = {}) {
  return {
    state: "current",
    rows: [],
    catalogs: [{ owner: "otto/tangent", revision: "catalog-revision" }],
    legacyReview: [],
    suggestions: [],
    counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
    ...fields,
  };
}

test("reconstructs every accepted resource recovery arm as a closed union", () => {
  const panel = projection();
  const fixtures = [
    ["duplicate-resource-target", { existing: { owner: "otto/tangent", id: "resource-1", target: "/private" } }],
    ["catalog-revision-changed", {}],
    ["suggestion-changed", {}],
    ["missing-target-confirmation-required", {
      inspection: {
        kind: "local",
        state: "missing",
        normalized: { kind: "worktree", path: "/repo/topic", credential: "secret" },
        targetFingerprint: "missing-fingerprint",
        providerBody: "private",
      },
    }],
    ["legacy-branch-choice-required", {
      choices: [{ owner: "otto/tangent", field: "Worktree", targetFingerprint: "choice-fingerprint", label: "topic", target: "/private" }],
    }],
    ["resource-representation-conflict", {
      currentScenes: [{ owner: "otto/tangent", hash: "scene-hash", serializedSource: "private" }],
    }],
    ["resource-source-load-failed", {
      problem: { source: "source-scene", owner: "otto/tangent", code: "resource-source-load-failed", message: "The source could not be loaded.", retryable: true, credentials: "private" },
    }],
    ["resource-source-invalid", {
      problem: { source: "area-note", owner: "otto/tangent", code: "resource-source-invalid", message: "The source is invalid.", retryable: false, providerBody: "private" },
    }],
    ["undo-unavailable", {}],
    ["undo-stale", {}],
  ];

  for (const [code, fields] of fixtures) {
    const value = sanitizeAreaResourceRecovery({
      code,
      recovery: { code, projection: { ...panel, credentials: "private" }, ...fields, arbitrary: "private" },
    });
    assert.equal(value.code, code);
    assert.deepEqual(value.projection, panel);
    assert.equal(value.arbitrary, undefined);
    assert.equal(value.projection.credentials, undefined);
  }

  assert.deepEqual(sanitizeAreaResourceRecovery({
    code: "duplicate-resource-target",
    projection: panel,
    existing: { owner: "otto/tangent", id: "resource-1", target: "/private" },
  }).existing, { owner: "otto/tangent", id: "resource-1" });
  assert.deepEqual(sanitizeAreaResourceRecovery({
    code: "missing-target-confirmation-required",
    projection: panel,
    normalized: { kind: "repository", path: "/repo" },
    targetFingerprint: "direct-fingerprint",
  }).inspection, {
    kind: "local",
    state: "missing",
    normalized: { kind: "repository", path: "/repo" },
    targetFingerprint: "direct-fingerprint",
  }, "the boundary normalizes the existing direct transaction fields into the accepted inspection arm");
  assert.deepEqual(sanitizeAreaResourceRecovery({
    code: "resource-representation-conflict",
    projection: panel,
    owner: "otto/tangent",
    currentHash: null,
  }).currentScenes, [{ owner: "otto/tangent", hash: null }], "the boundary normalizes the existing direct scene fields");
});

test("deeply allowlists panel facts and refuses cross-Area or credential-bearing targets", () => {
  const resource = {
    locator: { owner: "otto/tangent", id: "resource-1", privateTarget: "/private" },
    label: "PR 42",
    target: { kind: "link", url: "https://github.com/otto/tangent/pull/42", providerBody: "private" },
    representation: { state: "current", value: "on-map", serializedSource: "private" },
    origin: null,
    warnings: [],
    local: null,
    link: {
      kind: "github-pr",
      owner: "otto",
      repository: "tangent",
      number: 42,
      token: "private",
      lifecycle: {
        state: "current",
        value: {
          stateLabel: "Merged",
          treatment: "success",
          providerUpdatedAt: "2026-09-02T00:00:00.000Z",
          providerBody: "private",
        },
        checkedAt: "2026-09-02T00:00:01.000Z",
        credentials: "private",
      },
    },
  };
  const value = sanitizeAreaResourceRecovery({
    code: "duplicate-resource-target",
    existing: resource.locator,
    projection: projection({
      rows: [{
        viewedFrom: "otto/tangent",
        relation: { kind: "direct" },
        alsoFrom: [],
        launchMatch: { state: "current", value: false },
        entity: resource,
        providerBody: "private",
      }],
      counts: { state: "current", confirmedAssociations: 1, suggestions: 0, legacyReview: 0 },
    }),
  });
  assert.deepEqual(value.projection.rows[0].entity.target, { kind: "link", url: "https://github.com/otto/tangent/pull/42" });
  assert.deepEqual(value.projection.rows[0].entity.link.lifecycle.value, {
    stateLabel: "Merged",
    treatment: "success",
    providerUpdatedAt: "2026-09-02T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(value).includes("private"), false);

  const outsideArea = structuredClone(value.projection);
  outsideArea.rows[0].viewedFrom = "other/area";
  assert.equal(sanitizeAreaResourceRecovery({ code: "duplicate-resource-target", existing: resource.locator, projection: outsideArea }), null);

  const credentialTarget = structuredClone(value.projection);
  credentialTarget.rows[0].entity.target.url = "https://token:secret@github.com/otto/tangent/pull/42";
  assert.equal(sanitizeAreaResourceRecovery({ code: "duplicate-resource-target", existing: resource.locator, projection: credentialTarget }), null);
});

test("public failure serialization drops arbitrary transport fields and unsafe recovery", () => {
  const value = publicAreaResourceFailure({
    status: 409,
    code: "duplicate-resource-target",
    error: "provider response body with credential=secret",
    retryable: true,
    operationId: "resource-operation-1",
    target: { kind: "worktree", path: "/unrequested" },
    credentials: "secret",
    providerBody: "private",
    recovery: {
      code: "duplicate-resource-target",
      existing: { owner: "otto/tangent", id: "resource-1" },
      projection: projection(),
      credentials: "secret",
    },
  });
  assert.deepEqual(value, {
    status: 409,
    code: "duplicate-resource-target",
    error: "The target is already an active Map resource.",
    retryable: true,
    operationId: "resource-operation-1",
    recovery: {
      code: "duplicate-resource-target",
      existing: { owner: "otto/tangent", id: "resource-1" },
      projection: projection(),
    },
  });

  const unknown = publicAreaResourceFailure({
    status: 503,
    code: "provider-internal-response",
    message: "token=secret",
    recovery: { code: "provider-internal-response", projection: projection(), providerBody: "private" },
  });
  assert.deepEqual(unknown, {
    status: 503,
    code: "provider-internal-response",
    error: "The Map resource operation failed.",
    retryable: false,
  });
});
