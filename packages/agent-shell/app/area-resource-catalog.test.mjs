import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AREA_RESOURCE_CATALOG_SCHEMA,
  activeAreaResourceRecords,
  addAreaResource,
  areaResourceCatalogPath,
  areaResourceCatalogRevision,
  areaResourceTargetFingerprint,
  dismissAreaResourceSuggestion,
  editAreaResource,
  emptyAreaResourceCatalog,
  importAreaResource,
  normalizeAreaResourceTarget,
  parseAreaResourceCatalog,
  projectAreaResourceCatalogs,
  projectAreaShowMapResources,
  reactivateAreaResource,
  readAreaResourceCatalog,
  readAreaResourceProjection,
  removeAreaResource,
  safeAreaResourceCatalogPath,
  safeAreaResourceOwner,
  serializeAreaResourceCatalog,
  validateAreaResourceCatalog,
} from "./area-resource-catalog.mjs";

const NOW = "2026-09-02T01:00:00.000Z";
const LATER = "2026-09-02T02:00:00.000Z";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";
const ID_E = "55555555-5555-4555-8555-555555555555";
const ID_F = "66666666-6666-4666-8666-666666666666";

/** Builds one valid persisted resource record fixture. */
function record(id, target, options = {}) {
  return {
    id,
    label: options.label ?? null,
    membership: options.membership ?? { state: "active" },
    createdAt: options.createdAt ?? NOW,
    updatedAt: options.updatedAt ?? NOW,
    target,
    origin: options.origin ?? null,
    ...options.extra,
  };
}

/** Builds one valid catalog envelope fixture. */
function catalog(resources = [], suggestionDecisions = [], extra = {}) {
  return { schema: AREA_RESOURCE_CATALOG_SCHEMA, resources, suggestionDecisions, ...extra };
}

/** Builds one imported suggestion-decision fixture. */
function imported(resource, evidence, options = {}) {
  const suggestedTarget = options.suggestedTarget ?? resource.target;
  return {
    decision: "imported",
    evidence,
    evidenceHash: options.evidenceHash ?? "evidence-one",
    targetFingerprint: areaResourceTargetFingerprint(suggestedTarget),
    decidedAt: options.decidedAt ?? NOW,
    resourceId: resource.id,
    ...options.extra,
  };
}

/** Returns a deterministic UUID factory for one mutation. */
function generatedId(id) { return () => id; }

test("safe owner and catalog paths cannot address the logical root or leave the vault", () => {
  assert.equal(safeAreaResourceOwner("otto/tangent"), "otto/tangent");
  for (const unsafe of ["", "@root", "/otto", "otto/", "otto//x", "otto/../x", "otto/.git/x", "otto\\x", "otto\0x"]) {
    assert.equal(safeAreaResourceOwner(unsafe), null, unsafe);
  }
  assert.equal(areaResourceCatalogPath("otto/tangent"), "otto/tangent/map-resources.json");
  assert.equal(areaResourceCatalogPath("../outside"), null);
  assert.deepEqual(
    safeAreaResourceCatalogPath("/vault/trees", "otto/tangent/map-resources.json"),
    { owner: "otto/tangent", relative: "otto/tangent/map-resources.json", absolute: "/vault/trees/otto/tangent/map-resources.json" },
  );
  assert.equal(safeAreaResourceCatalogPath("/vault/trees", "otto/tangent/other.json"), null);
});

test("a missing file is an exact empty catalog with revision null", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-catalog-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await readAreaResourceCatalog(root, "otto/tangent");
  assert.deepEqual(result, {
    state: "current",
    owner: "otto/tangent",
    file: "otto/tangent/map-resources.json",
    exists: false,
    revision: null,
    text: null,
    catalog: emptyAreaResourceCatalog(),
  });
});

test("the revision hashes exact bytes and serialization preserves additive JSON fields", () => {
  const worktree = record(ID_A, { kind: "worktree", path: "/work/one", futureTarget: { format: 2 } }, {
    label: "One",
    membership: { state: "active", futureMembership: true },
    origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "legacy-one", declaredBranch: "topic/one", futureOrigin: 7 },
    extra: { futureRecord: ["kept"] },
  });
  const repository = record(ID_B, { kind: "repository", path: "/repo/two" }, {
    membership: { state: "removed", removedAt: LATER },
    origin: { kind: "legacy-area-binding", field: "Repository", evidenceHash: "legacy-two", declaredBranch: null },
  });
  const link = record(ID_C, { kind: "link", url: "https://example.test/review/1" });
  const value = catalog([
    worktree,
    repository,
    link,
  ], [
    imported(worktree, { kind: "legacy-area-binding", field: "Worktree", futureEvidence: "kept" }, {
      evidenceHash: "legacy-one",
      extra: { futureDecision: { enabled: true } },
    }),
    imported(link, { kind: "knowledge-line" }, { evidenceHash: "knowledge-one" }),
    {
      decision: "dismissed",
      evidence: { kind: "attempt", jobSlug: "goal-one", run: 1, assignmentId: "assignment-one", attemptId: "attempt-one" },
      evidenceHash: "attempt-one",
      targetFingerprint: areaResourceTargetFingerprint({ kind: "worktree", path: "/work/dismissed" }),
      decidedAt: NOW,
      resourceId: null,
    },
  ], { futureCatalog: { generation: 2 } });

  const text = serializeAreaResourceCatalog(value);
  const parsed = parseAreaResourceCatalog(Buffer.from(text));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.catalog, value);
  assert.equal(parsed.text, text);
  assert.equal(parsed.revision, createHash("sha256").update(Buffer.from(text)).digest("hex"));
  assert.equal(areaResourceCatalogRevision(`${text} `) === parsed.revision, false, "one byte changes the revision");
});

test("malformed catalogs and unsupported union variants remain distinct", () => {
  assert.equal(parseAreaResourceCatalog("{").code, "catalog-invalid");
  assert.equal(validateAreaResourceCatalog({ schema: AREA_RESOURCE_CATALOG_SCHEMA }).code, "catalog-invalid");
  assert.equal(validateAreaResourceCatalog({ ...emptyAreaResourceCatalog(), schema: "area-map-resources.v2" }).code, "catalog-unsupported");

  const base = record(ID_A, { kind: "worktree", path: "/work/one" });
  const variants = [
    ["target", catalog([{ ...base, target: { kind: "workspace", path: "/work/one" } }])],
    ["membership", catalog([{ ...base, membership: { state: "paused" } }])],
    ["origin", catalog([{ ...base, origin: { kind: "future-origin" } }])],
    ["origin field", catalog([{ ...base, origin: { kind: "legacy-area-binding", field: "Checkout", evidenceHash: "x", declaredBranch: null } }])],
    ["evidence", catalog([base], [{ decision: "dismissed", evidence: { kind: "browser-history" }, evidenceHash: "x", targetFingerprint: "y", decidedAt: NOW, resourceId: null }])],
    ["decision", catalog([base], [{ decision: "ignored", evidence: { kind: "knowledge-line" }, evidenceHash: "x", targetFingerprint: "y", decidedAt: NOW, resourceId: null }])],
  ];
  for (const [name, value] of variants) assert.equal(validateAreaResourceCatalog(value).code, "catalog-unsupported", name);

  const additiveNestedKind = catalog([{ ...base, target: { ...base.target, futureFacet: { kind: "provider-v2" } } }], [], { futureState: { state: "new" } });
  assert.equal(validateAreaResourceCatalog(additiveNestedKind).ok, true, "discriminants inside additive data are not mistaken for this reader's union");
  assert.equal(validateAreaResourceCatalog(catalog([{ ...base, target: { kind: "link", url: "javascript:alert(1)" }, origin: null }])).code, "catalog-invalid");
});

test("catalog validation enforces IDs, active duplicates, and suggestion relations", () => {
  const one = record(ID_A, { kind: "worktree", path: "/work/../repo/" });
  const same = record(ID_B, { kind: "worktree", path: "/repo" });
  const removed = record(ID_B, { kind: "worktree", path: "/repo" }, { membership: { state: "removed", removedAt: LATER } });
  const crossKind = record(ID_C, { kind: "repository", path: "/repo" });
  assert.match(validateAreaResourceCatalog(catalog([one, same])).errors.join(" "), /duplicates active resource/);
  assert.equal(validateAreaResourceCatalog(catalog([one, removed, crossKind])).ok, true, "tombstones and cross-kind targets do not collide");
  assert.match(validateAreaResourceCatalog(catalog([one, { ...removed, id: ID_A }])).errors.join(" "), /duplicates another resource ID/);

  const missing = imported(one, { kind: "legacy-area-binding", field: "Worktree" });
  assert.match(validateAreaResourceCatalog(catalog([], [missing])).errors.join(" "), /reference this catalog/);
  const wrongOrigin = { ...one, origin: { kind: "legacy-area-binding", field: "Repository", evidenceHash: "x", declaredBranch: null } };
  assert.match(validateAreaResourceCatalog(catalog([wrongOrigin])).errors.join(" "), /does not match/);
  const priorTargetBaseline = { ...imported(one, { kind: "legacy-area-binding", field: "Worktree" }), targetFingerprint: "prior-target-fingerprint" };
  assert.equal(validateAreaResourceCatalog(catalog([crossKind], [{ ...priorTargetBaseline, resourceId: crossKind.id }])).ok, true,
    "an Edit can change kind and target while its reviewed baseline remains durable");
  const dismissedLegacy = { ...imported(one, { kind: "legacy-area-binding", field: "Worktree" }), decision: "dismissed", resourceId: null };
  assert.match(validateAreaResourceCatalog(catalog([one], [dismissedLegacy])).errors.join(" "), /cannot dismiss/);
  const decision = imported(one, { kind: "legacy-area-binding", field: "Worktree" });
  assert.match(validateAreaResourceCatalog(catalog([one], [decision, structuredClone(decision)])).errors.join(" "), /duplicates another suggestion decision/);
});

test("target normalization expands only home, removes separators, changes host case, and rejects credentials", () => {
  assert.deepEqual(
    normalizeAreaResourceTarget({ kind: "worktree", path: "~/Projects/../Repo///", future: true }, { home: "/Users/Example" }),
    { kind: "worktree", path: "/Users/Example/Repo", future: true },
  );
  assert.deepEqual(normalizeAreaResourceTarget({ kind: "repository", path: "/Volumes/Case/../CASE/" }), { kind: "repository", path: "/Volumes/CASE" });
  assert.deepEqual(
    normalizeAreaResourceTarget({ kind: "link", url: "HTTP://EXAMPLE.COM:80/%7EThing?Q=A#Frag" }),
    { kind: "link", url: "HTTP://example.com:80/%7EThing?Q=A#Frag" },
  );
  assert.throws(() => normalizeAreaResourceTarget({ kind: "worktree", path: "relative/path" }), { code: "invalid-resource-target" });
  assert.throws(() => normalizeAreaResourceTarget({ kind: "worktree", path: "~someone/repo" }), { code: "invalid-resource-target" });
  assert.throws(() => normalizeAreaResourceTarget({ kind: "link", url: "mailto:test@example.com" }), { code: "invalid-resource-target" });
  assert.throws(() => normalizeAreaResourceTarget({ kind: "link", url: "https://example.com/a b" }), { code: "invalid-resource-target" });
  assert.throws(() => normalizeAreaResourceTarget({ kind: "link", url: "https://token:secret@example.com/review" }), { code: "invalid-resource-target" });
  assert.equal(validateAreaResourceCatalog(catalog([
    record(ID_A, { kind: "link", url: "https://token:secret@example.com/review" }),
  ])).ok, false, "catalog parsing cannot admit a credential-bearing Link from older bytes");

  assert.equal(
    areaResourceTargetFingerprint({ kind: "worktree", path: "/repo/child/../" }),
    areaResourceTargetFingerprint({ kind: "worktree", path: "/repo" }),
  );
  assert.equal(
    areaResourceTargetFingerprint({ kind: "link", url: "https://EXAMPLE.com/A?B=C" }),
    areaResourceTargetFingerprint({ kind: "link", url: "https://example.com/A?B=C" }),
  );
  assert.notEqual(
    areaResourceTargetFingerprint({ kind: "worktree", path: "/repo" }),
    areaResourceTargetFingerprint({ kind: "repository", path: "/repo" }),
  );
});

test("add returns typed duplicates, warns across kinds, and never reuses tombstone IDs", () => {
  const active = record(ID_A, { kind: "worktree", path: "/repo" });
  const tombstone = record(ID_B, { kind: "worktree", path: "/retired" }, { membership: { state: "removed", removedAt: NOW } });
  const value = catalog([active, tombstone], [], { futureCatalog: true });
  const duplicate = addAreaResource(value, { target: { kind: "worktree", path: "/repo/" }, label: null }, { owner: "otto", now: LATER, generateId: generatedId(ID_C) });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "duplicate-resource-target");
  assert.deepEqual(duplicate.error.existing, { owner: "otto", id: ID_A });
  assert.deepEqual(value.resources.map((item) => item.id), [ID_A, ID_B], "the input catalog is never mutated");

  const crossKind = addAreaResource(value, { target: { kind: "repository", path: "/repo" }, label: "Repository" }, { owner: "otto", now: LATER, generateId: generatedId(ID_C) });
  assert.equal(crossKind.ok, true);
  assert.deepEqual(crossKind.warnings, [{ kind: "cross-kind-target", other: { owner: "otto", id: ID_A } }]);
  assert.equal(crossKind.catalog.futureCatalog, true);

  const newAfterRemoval = addAreaResource(value, { target: { kind: "worktree", path: "/retired" }, label: "New" }, { owner: "otto", now: LATER, generateId: generatedId(ID_D) });
  assert.equal(newAfterRemoval.ok, true);
  assert.equal(newAfterRemoval.resource.id, ID_D);
  assert.equal(newAfterRemoval.catalog.resources.find((item) => item.id === ID_B).membership.state, "removed");
});

test("edit preserves additive fields, clears legacy origin, and fences active duplicates", () => {
  const first = record(ID_A, { kind: "worktree", path: "/old", futureTarget: "kept" }, {
    label: "Old",
    membership: { state: "active", futureMembership: 3 },
    origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "legacy", declaredBranch: "old", futureOrigin: true },
    extra: { futureRecord: { kept: true } },
  });
  const second = record(ID_B, { kind: "worktree", path: "/taken" });
  const decision = imported(first, { kind: "legacy-area-binding", field: "Worktree", futureEvidence: 1 }, { evidenceHash: "legacy", extra: { futureDecision: 2 } });
  const value = catalog([first, second], [decision], { futureCatalog: 4 });
  const changed = editAreaResource(value, { id: ID_A, target: { kind: "worktree", path: "/new///" }, label: "New" }, { owner: "otto", now: LATER });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.resource.target, { kind: "worktree", path: "/new", futureTarget: "kept" });
  assert.equal(changed.resource.origin, null);
  assert.equal(changed.resource.membership.futureMembership, 3);
  assert.deepEqual(changed.resource.futureRecord, { kept: true });
  assert.deepEqual(changed.catalog.suggestionDecisions, [decision]);
  assert.equal(changed.catalog.futureCatalog, 4);
  assert.equal(value.resources[0].target.path, "/old");

  const duplicate = editAreaResource(value, { id: ID_A, target: { kind: "worktree", path: "/taken/" }, label: null }, { owner: "otto", now: LATER });
  assert.equal(duplicate.error.code, "duplicate-resource-target");
  assert.deepEqual(duplicate.error.existing, { owner: "otto", id: ID_B });
});

test("remove and reactivate preserve tombstone facts and nested additive fields", () => {
  const first = record(ID_A, { kind: "worktree", path: "/one", futureTarget: true }, {
    label: "One",
    membership: { state: "active", futureMembership: { keep: true } },
    extra: { futureRecord: true },
  });
  const removed = removeAreaResource(catalog([first]), { id: ID_A }, { owner: "otto", now: LATER });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.resource.membership, { futureMembership: { keep: true }, state: "removed", removedAt: LATER });
  assert.deepEqual(removed.resource.target, first.target);
  assert.equal(removed.resource.label, "One");
  assert.equal(activeAreaResourceRecords(removed.catalog).length, 0);

  const restored = reactivateAreaResource(removed.catalog, { id: ID_A }, { owner: "otto", now: "2026-09-02T03:00:00.000Z" });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.resource.membership, { futureMembership: { keep: true }, state: "active" });
  assert.equal(restored.resource.id, ID_A);

  const occupied = addAreaResource(removed.catalog, { target: first.target, label: "Replacement" }, { owner: "otto", now: LATER, generateId: generatedId(ID_B) });
  const conflict = reactivateAreaResource(occupied.catalog, { id: ID_A }, { owner: "otto", now: "2026-09-02T03:00:00.000Z" });
  assert.equal(conflict.error.code, "duplicate-resource-target");
  assert.deepEqual(conflict.error.existing, { owner: "otto", id: ID_B });
});

test("reviewed import creates or reuses membership and stores the evidence decision atomically", () => {
  const legacyEvidence = { kind: "legacy-area-binding", field: "Worktree", futureEvidence: "keep" };
  const target = { kind: "worktree", path: "/repo/worktree" };
  const created = importAreaResource(emptyAreaResourceCatalog(), {
    owner: "otto",
    target,
    label: "Imported",
    evidence: legacyEvidence,
    evidenceHash: "legacy-hash",
    targetFingerprint: areaResourceTargetFingerprint(target),
    declaredBranch: "topic/import",
  }, { now: NOW, generateId: generatedId(ID_A) });
  assert.equal(created.ok, true);
  assert.equal(created.reused, false);
  assert.equal(created.resource.id, ID_A);
  assert.deepEqual(created.resource.origin, {
    kind: "legacy-area-binding",
    field: "Worktree",
    evidenceHash: "legacy-hash",
    declaredBranch: "topic/import",
  });
  assert.equal(created.decision.resourceId, ID_A);
  assert.equal(created.decision.evidence.futureEvidence, "keep");

  const replay = importAreaResource(created.catalog, {
    owner: "otto",
    target,
    label: "Ignored replacement label",
    evidence: legacyEvidence,
    evidenceHash: "legacy-hash",
    targetFingerprint: areaResourceTargetFingerprint(target),
    declaredBranch: "topic/import",
  }, { now: LATER, generateId: generatedId(ID_B) });
  assert.equal(replay.ok, true);
  assert.equal(replay.reused, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.resource.label, "Imported");
  assert.equal(replay.catalog.resources.length, 1);
  assert.equal(replay.catalog.suggestionDecisions.length, 1);

  const preexisting = record(ID_B, target, {
    label: "Keep catalog label",
    origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "older", declaredBranch: "older", futureOrigin: 9 },
  });
  const reused = importAreaResource(catalog([preexisting]), {
    owner: "otto",
    target,
    label: "Do not use",
    evidence: legacyEvidence,
    evidenceHash: "legacy-hash",
    targetFingerprint: areaResourceTargetFingerprint(target),
    declaredBranch: "topic/new",
  }, { now: LATER, generateId: generatedId(ID_C) });
  assert.equal(reused.ok, true);
  assert.equal(reused.resource.id, ID_B);
  assert.equal(reused.resource.label, "Keep catalog label");
  assert.equal(reused.resource.origin.futureOrigin, 9);
  assert.equal(reused.resource.origin.declaredBranch, "topic/new");
});

test("reviewed import rejects cross-paired evidence, targets, and fingerprints", () => {
  const worktree = { kind: "worktree", path: "/reviewed/worktree" };
  const repository = { kind: "repository", path: worktree.path };
  const legacy = {
    owner: "otto",
    target: worktree,
    evidence: { kind: "legacy-area-binding", field: "Repository" },
    evidenceHash: "legacy",
    targetFingerprint: areaResourceTargetFingerprint(repository),
  };
  assert.equal(importAreaResource(emptyAreaResourceCatalog(), legacy, { now: NOW, generateId: generatedId(ID_A) }).error.code, "invalid-resource-target");

  const attempt = {
    owner: "otto",
    target: repository,
    evidence: { kind: "attempt", jobSlug: "goal", run: 1, assignmentId: "assignment", attemptId: "attempt" },
    evidenceHash: "attempt",
    targetFingerprint: areaResourceTargetFingerprint(worktree),
  };
  assert.equal(importAreaResource(emptyAreaResourceCatalog(), attempt, { now: NOW, generateId: generatedId(ID_A) }).error.code, "invalid-resource-target");

  const localSuggestion = { kind: "local-path", path: "/reviewed/original" };
  const changedPath = importAreaResource(emptyAreaResourceCatalog(), {
    owner: "otto",
    target: { kind: "worktree", path: "/reviewed/changed" },
    suggestionTarget: localSuggestion,
    evidence: { kind: "knowledge-line" },
    evidenceHash: "knowledge",
    targetFingerprint: areaResourceTargetFingerprint(localSuggestion),
  }, { now: NOW, generateId: generatedId(ID_A) });
  assert.equal(changedPath.error.code, "invalid-resource-target");

  const changedFingerprint = importAreaResource(emptyAreaResourceCatalog(), {
    owner: "otto",
    target: worktree,
    evidence: { kind: "git-worktree", repositoryTargetFingerprint: "repo", pathFingerprint: "path" },
    evidenceHash: "git",
    targetFingerprint: "stale-fingerprint",
  }, { now: NOW, generateId: generatedId(ID_A) });
  assert.equal(changedFingerprint.error.code, "suggestion-changed");
});

test("suggestion import retains an existing origin, and dismissal is non-legacy and idempotent", () => {
  const target = { kind: "worktree", path: "/knowledge/path" };
  const existing = record(ID_A, target, {
    label: "Existing",
    origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "legacy", declaredBranch: null },
  });
  const evidence = { kind: "knowledge-line", futureEvidence: { keep: true } };
  const suggestedTarget = { kind: "local-path", path: target.path };
  const added = importAreaResource(catalog([existing]), {
    owner: "otto",
    target,
    suggestionTarget: suggestedTarget,
    evidence,
    evidenceHash: "knowledge-hash",
    targetFingerprint: areaResourceTargetFingerprint(suggestedTarget),
  }, { now: NOW, generateId: generatedId(ID_B) });
  assert.equal(added.ok, true);
  assert.deepEqual(added.resource.origin, existing.origin);
  assert.equal(added.resource.label, "Existing");

  const suggestion = {
    evidence: { kind: "attempt", jobSlug: "goal-one", run: 1, assignmentId: "assignment-one", attemptId: "attempt-one", futureEvidence: 8 },
    evidenceHash: "attempt-hash",
    targetFingerprint: areaResourceTargetFingerprint({ kind: "worktree", path: "/attempt" }),
  };
  const dismissed = dismissAreaResourceSuggestion(added.catalog, suggestion, { now: NOW });
  assert.equal(dismissed.ok, true);
  assert.equal(dismissed.decision.decision, "dismissed");
  assert.equal(dismissed.decision.resourceId, null);
  assert.equal(dismissed.decision.evidence.futureEvidence, 8);
  const replay = dismissAreaResourceSuggestion(dismissed.catalog, suggestion, { now: LATER });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.catalog.suggestionDecisions.length, 2);

  const legacy = dismissAreaResourceSuggestion(dismissed.catalog, {
    evidence: { kind: "legacy-area-binding", field: "Worktree" },
    evidenceHash: "legacy",
    targetFingerprint: areaResourceTargetFingerprint(target),
  }, { now: NOW });
  assert.equal(legacy.error.code, "invalid-resource-target");
});

test("import replacement preserves additive decision and evidence fields", () => {
  const target = { kind: "worktree", path: "/same" };
  const retired = record(ID_A, target, { membership: { state: "removed", removedAt: NOW } });
  const active = record(ID_B, target, { label: "Current" });
  const evidence = { kind: "legacy-area-binding", field: "Worktree", futureEvidence: "keep" };
  const prior = imported(retired, evidence, { evidenceHash: "legacy", extra: { futureDecision: "keep" } });
  const result = importAreaResource(catalog([retired, active], [prior]), {
    owner: "otto",
    target,
    evidence,
    evidenceHash: "legacy",
    targetFingerprint: areaResourceTargetFingerprint(target),
    declaredBranch: null,
  }, { now: LATER, generateId: generatedId(ID_C) });
  assert.equal(result.ok, true);
  assert.equal(result.decision.resourceId, ID_B);
  assert.equal(result.decision.futureDecision, "keep");
  assert.equal(result.decision.evidence.futureEvidence, "keep");
  assert.equal(result.catalog.resources.length, 2);
});

/** Writes one catalog into an ephemeral vault fixture. */
async function writeCatalog(root, owner, value) {
  const file = safeAreaResourceCatalogPath(root, areaResourceCatalogPath(owner));
  await mkdir(path.dirname(file.absolute), { recursive: true });
  await writeFile(file.absolute, serializeAreaResourceCatalog(value));
}

test("nearest-first projection suppresses only inherited direct matches and counts before suppression", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-projection-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const shared = "/targets/shared";
  const inheritedOnly = "/targets/inherited";
  await writeCatalog(root, "root", catalog([
    record(ID_A, { kind: "worktree", path: shared }, { label: "Root shared" }),
    record(ID_B, { kind: "worktree", path: inheritedOnly }, { label: "Root inherited" }),
    record(ID_C, { kind: "repository", path: "/targets/cross" }, { label: "Root repository" }),
    record(ID_D, { kind: "worktree", path: "/targets/cross" }, { label: "Root worktree" }),
    record(ID_E, { kind: "link", url: "https://example.test/removed" }, { membership: { state: "removed", removedAt: NOW } }),
  ]));
  await writeCatalog(root, "root/child", catalog([
    record(ID_A, { kind: "worktree", path: shared }, { label: "Child shared" }),
    record(ID_B, { kind: "worktree", path: inheritedOnly }, { label: "Child inherited" }),
  ]));
  await writeCatalog(root, "root/child/leaf", catalog([
    record(ID_A, { kind: "worktree", path: shared }, { label: "Leaf shared" }),
    record(ID_F, { kind: "link", url: "https://EXAMPLE.test/review/1" }, { label: "Leaf link" }),
    record(ID_E, { kind: "repository", path: "/targets/retired" }, { membership: { state: "removed", removedAt: NOW } }),
  ]));

  const projection = await readAreaResourceProjection(root, "root/child/leaf");
  assert.equal(projection.state, "current");
  assert.equal(projection.counts.confirmedAssociations, 8, "all active identities count before two inherited shared rows are hidden");
  assert.equal(projection.rows.length, 6);
  assert.deepEqual(projection.rows.slice(0, 2).map((row) => row.label), ["Leaf shared", "Leaf link"]);
  const direct = projection.rows.find((row) => row.label === "Leaf shared");
  assert.deepEqual(direct.alsoFrom, ["root/child", "root"]);
  assert.deepEqual(
    projection.rows.filter((row) => row.target.path === inheritedOnly).map((row) => row.relation),
    [{ kind: "inherited", sourceArea: "root/child" }, { kind: "inherited", sourceArea: "root" }],
    "inherited matches remain separate when no direct row suppresses them",
  );
  assert.equal(projection.rows.some((row) => row.locator.id === ID_E && row.target.kind === "link"), false, "ancestor tombstones never inherit");
  const rootRepository = projection.rows.find((row) => row.label === "Root repository");
  assert.deepEqual(rootRepository.warnings, [{ kind: "cross-kind-target", other: { owner: "root", id: ID_D } }]);

  const shown = projectAreaShowMapResources(projection);
  assert.equal(shown.state, "current");
  assert.deepEqual(shown.rows[0], {
    locator: { owner: "root/child/leaf", id: ID_A },
    label: "Leaf shared",
    target: { kind: "worktree", path: shared },
    source: { kind: "direct" },
    origin: null,
  });
  assert.equal(shown.rows.some((row) => row.locator.id === ID_E), false);
});

test("ancestor read errors make a lower-bound projection while a direct error is unavailable", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-projection-errors-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeCatalog(root, "root/child", catalog([record(ID_A, { kind: "worktree", path: "/child" })]));
  await writeCatalog(root, "root/child/leaf", catalog([record(ID_B, { kind: "repository", path: "/leaf" })]));
  const rootFile = safeAreaResourceCatalogPath(root, areaResourceCatalogPath("root"));
  await mkdir(path.dirname(rootFile.absolute), { recursive: true });
  await writeFile(rootFile.absolute, "{not json");

  const partial = await readAreaResourceProjection(root, "root/child/leaf");
  assert.equal(partial.state, "partial");
  assert.equal(partial.counts.state, "lower-bound");
  assert.equal(partial.counts.confirmedAssociationsAtLeast, 2);
  assert.equal(partial.problems[0].owner, "root");
  assert.equal(partial.problems[0].code, "catalog-invalid");
  assert.equal(projectAreaShowMapResources(partial).state, "partial");

  const leafFile = safeAreaResourceCatalogPath(root, areaResourceCatalogPath("root/child/leaf"));
  await writeFile(leafFile.absolute, JSON.stringify({ ...emptyAreaResourceCatalog(), schema: "area-map-resources.v2" }));
  const unavailable = await readAreaResourceProjection(root, "root/child/leaf");
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.error.owner, "root/child/leaf");
  assert.equal(unavailable.error.code, "catalog-unsupported");
});

test("pure projection accepts exact read snapshots and rejects a missing direct snapshot", () => {
  const current = {
    state: "current",
    owner: "root/child",
    revision: null,
    catalog: catalog([record(ID_A, { kind: "link", url: "https://example.test" })]),
  };
  const projection = projectAreaResourceCatalogs("root/child", [current, {
    state: "current", owner: "root", revision: null, catalog: emptyAreaResourceCatalog(),
  }]);
  assert.equal(projection.state, "current");
  assert.equal(projection.rows[0].label, "example.test");
  assert.equal(projectAreaResourceCatalogs("root/child", []).state, "unavailable");
});
