import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { areaCanvasPath, canvasHash, parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import {
  areaResourceCatalogPath,
  areaResourceTargetFingerprint,
  emptyAreaResourceCatalog,
  parseAreaResourceCatalog,
  serializeAreaResourceCatalog,
} from "./area-resource-catalog.mjs";
import { createAreaResourceMutationCoordinator, inspectAreaResourceTarget } from "./area-resource-mutations.mjs";
import { createBlockElements, createEmptyScene, tangentOf } from "./public/area-board-core.js";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

/** Returns the exact revision used by the catalog transaction contract. */
function hash(content) { return content === null ? null : createHash("sha256").update(content).digest("hex"); }

/** Creates an in-memory exact transaction authority with operation replay. */
function transactionFixture(initial = {}, { beforeInstall = null } = {}) {
  const files = new Map(Object.entries(initial).map(([file, content]) => [file, Buffer.from(content)]));
  const receipts = new Map();
  return {
    files,
    /** Reads one exact in-memory file. */
    async readExact(file) {
      const content = files.get(file) ?? null;
      return { file, content, hash: hash(content) };
    },
    /** Installs one exact plan and replays an equal operation identity. */
    async saveExact(buildPlan, options) {
      const digest = JSON.stringify(options.intent);
      const prior = receipts.get(options.operationId);
      if (prior) {
        if (prior.digest !== digest) return { status: 409, code: "operation-id-reused", error: "operation ID reused" };
        const replay = { ...prior.result, idempotent: true };
        return options.rehydrate ? { ...await options.rehydrate(replay, { idempotent: true }), idempotent: true } : replay;
      }
      const plan = await buildPlan();
      await beforeInstall?.({ files, plan, options });
      for (const target of plan.targets ?? []) {
        const current = files.get(target.file) ?? null;
        assert.equal(hash(current), hash(target.oldContent ?? null), `stale fixture target ${target.file}`);
      }
      for (const guard of plan.guards ?? []) {
        const current = files.get(guard.file) ?? null;
        if (hash(current) !== hash(guard.oldContent ?? null)) {
          return { status: 409, code: "guard-race", changedPaths: [guard.file], error: "fixture guard changed" };
        }
      }
      for (const target of plan.targets ?? []) {
        if (target.newContent === null) files.delete(target.file);
        else files.set(target.file, Buffer.from(target.newContent));
      }
      const result = { ...plan.result, committed: true, operationId: options.operationId, idempotent: false };
      receipts.set(options.operationId, { digest, result });
      return options.rehydrate ? await options.rehydrate(result, { idempotent: false }) : result;
    },
  };
}

/** Returns one valid Area scene containing one Tangent Block pair. */
function sceneWithBlock({ id = "source-link", kind = "link", ref = "HTTPS://Example.COM/pull/1", title = "Generic label" } = {}) {
  const scene = createEmptyScene();
  scene.elements.push(...createBlockElements({ id, kind, ref, title, x: 40, y: 60, style: { strokeColor: "#c92a2a" } }));
  return scene;
}

/** Reads one parsed fixture catalog. */
function fixtureCatalog(transactions, owner = "otto/tangent") {
  const parsed = parseAreaResourceCatalog(transactions.files.get(areaResourceCatalogPath(owner)));
  assert.equal(parsed.ok, true);
  return parsed.catalog;
}

/** Reads one parsed fixture source scene. */
function fixtureScene(transactions, owner = "otto/tangent") {
  const parsed = parseAreaCanvas(transactions.files.get(areaCanvasPath(owner)).toString("utf8"));
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

/** Builds one valid source-coupled mutation request. */
async function sceneRequest(transactions, mutation, operationId) {
  const owner = mutation.kind === "associate-generic-link" ? mutation.owner : mutation.oldResource.owner;
  const source = await transactions.readExact(areaCanvasPath(owner));
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: owner,
    mutation,
    expectedCatalogs: [await expectation(transactions, owner)],
    expectedScenes: [{ owner, hash: source.hash }],
  };
}

/** Reads the current revision from one fixture projection. */
async function expectation(transactions, owner) {
  const exact = await transactions.readExact(areaResourceCatalogPath(owner));
  return { owner, revision: exact.hash };
}

/** Builds one valid catalog-only request. */
async function request(transactions, mutation, operationId = "resource-operation-1", viewedFrom = "otto/tangent") {
  const owners = mutation.kind === "add" ? [mutation.owner]
    : ["edit", "remove"].includes(mutation.kind) ? [mutation.resource.owner]
      : mutation.kind === "add-suggestion" ? [mutation.selection.suggestion.owner]
        : mutation.kind === "dismiss-suggestion" ? [mutation.suggestion.owner]
          : mutation.selections.map((selection) => selection.candidate.owner);
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom,
    mutation,
    expectedCatalogs: await Promise.all([...new Set(owners)].map((owner) => expectation(transactions, owner))),
  };
}

/** Returns a deterministic coordinator whose local targets all exist. */
function coordinator(transactions, fields = {}) {
  const ids = [FIRST_ID, SECOND_ID];
  /** Reports whether a fixture Area exists. */
  const areaExists = async (area) => ["otto", "otto/tangent"].includes(area);
  /** Reports that one fixture directory target exists. */
  const statPath = async () => ({
    /** Identifies the fixture stat as a directory. */
    isDirectory: () => true,
  });
  /** Inspects one target against the fixture filesystem. */
  const inspectTarget = (target) => inspectAreaResourceTarget(target, { statPath });
  /** Returns the stable fixture clock. */
  const now = () => "2026-09-02T10:00:00.000Z";
  /** Returns the next stable fixture UUID. */
  const generateId = () => ids.shift();
  /** Returns the stable immediate-Undo token. */
  const generateUndoToken = () => "undo-resource-1";
  return createAreaResourceMutationCoordinator({
    transactions,
    areaExists,
    inspectTarget,
    now,
    generateId,
    generateUndoToken,
    ...fields,
  });
}

/** Returns one complete current or partial panel for typed mutation recovery. */
function recoveryPanel(problems = []) {
  const partial = problems.length > 0;
  return {
    state: partial ? "partial" : "current",
    rows: [],
    catalogs: [{ owner: "otto/tangent", revision: null }],
    legacyReview: [],
    suggestions: [],
    counts: partial
      ? { state: "lower-bound", confirmedAssociationsAtLeast: 0, suggestionsAtLeast: 0, legacyReviewAtLeast: 0 }
      : { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
    ...(partial ? { problems } : {}),
  };
}

/** Captures one expected rejected mutation for detailed recovery assertions. */
async function rejected(operation) {
  let failure = null;
  try { await operation; } catch (error) { failure = error; }
  assert.ok(failure, "the mutation must reject");
  return failure;
}

test("target inspection normalizes exact paths and requires no Git or provider integration", async () => {
  /** Reports one directory-shaped fixture target. */
  const statPath = async () => ({
    /** Identifies the fixture stat as a directory. */
    isDirectory: () => true,
  });
  const available = await inspectAreaResourceTarget({ kind: "worktree", path: "/tmp/repo/../repo/worktree/" }, {
    statPath,
  });
  assert.deepEqual(available.normalized, { kind: "worktree", path: "/tmp/repo/worktree" });
  assert.equal(available.state, "available");

  const missing = await inspectAreaResourceTarget({ kind: "repository", path: "/tmp/missing" }, {
    /** Reports one absent fixture path. */
    async statPath() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
  });
  assert.equal(missing.state, "missing");
  const link = await inspectAreaResourceTarget({ kind: "link", url: "HTTPS://GitHub.COM/Org/Repo/pull/1" });
  assert.equal(link.normalized.url, "HTTPS://github.com/Org/Repo/pull/1");
  assert.equal(link.state, "valid");
});

test("one Area records multiple worktrees and safely rejects an exact duplicate", async () => {
  const transactions = transactionFixture();
  const resources = coordinator(transactions);
  const first = await resources.apply(await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "worktree", path: "/tmp/one" }, missingConfirmation: null }, label: "One",
  }, "add-one"));
  const second = await resources.apply(await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "worktree", path: "/tmp/two" }, missingConfirmation: null }, label: "Two",
  }, "add-two"));
  assert.equal(first.resource.locator.id, FIRST_ID);
  assert.equal(second.resource.locator.id, SECOND_ID);
  assert.equal(second.projection.rows.length, 2);

  await assert.rejects(resources.apply(await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "worktree", path: "/tmp/one" }, missingConfirmation: null }, label: null,
  }, "duplicate")), (error) => error.code === "duplicate-resource-target" && error.status === 409);
});

test("missing local targets require an exact reviewed fingerprint", async () => {
  const transactions = transactionFixture();
  /** Reports every fixture path as absent. */
  const statPath = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
  /** Inspects one target against the absent-path fixture. */
  const inspectTarget = (target) => inspectAreaResourceTarget(target, { statPath });
  const resources = coordinator(transactions, { inspectTarget });
  const target = { kind: "worktree", path: "/tmp/future" };
  await assert.rejects(resources.apply(await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target, missingConfirmation: null }, label: null,
  }, "missing-unconfirmed")), (error) => error.code === "missing-target-confirmation-required");
  const added = await resources.apply(await request(transactions, {
    kind: "add",
    owner: "otto/tangent",
    input: { target, missingConfirmation: { targetFingerprint: areaResourceTargetFingerprint(target) } },
    label: null,
  }, "missing-confirmed"));
  assert.equal(added.resource.target.path, "/tmp/future");
});

test("edit keeps identity, remove creates a tombstone, and immediate Undo restores exact catalog bytes", async () => {
  const transactions = transactionFixture();
  const resources = coordinator(transactions);
  await resources.apply(await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "repository", path: "/tmp/repo" }, missingConfirmation: null }, label: "Repo",
  }, "add"));
  const edited = await resources.apply(await request(transactions, {
    kind: "edit", resource: { owner: "otto/tangent", id: FIRST_ID }, input: { target: { kind: "worktree", path: "/tmp/repo" }, missingConfirmation: null }, label: "Checkout",
  }, "edit"));
  assert.equal(edited.resource.locator.id, FIRST_ID);
  assert.equal(edited.resource.target.kind, "worktree");
  const beforeRemove = Buffer.from(transactions.files.get(areaResourceCatalogPath("otto/tangent")));
  const removed = await resources.apply(await request(transactions, {
    kind: "remove", resource: { owner: "otto/tangent", id: FIRST_ID },
  }, "remove"));
  assert.equal(removed.undo.state, "available");
  assert.equal(removed.projection.rows.length, 0);

  const undone = await resources.apply({
    schema: "area-map-resource-mutation.v1",
    operationId: "undo-remove",
    viewedFrom: "otto/tangent",
    mutation: { kind: "undo", token: removed.undo.token },
  });
  assert.equal(undone.undo.state, "unavailable");
  assert.deepEqual(transactions.files.get(areaResourceCatalogPath("otto/tangent")), beforeRemove);
  assert.equal(undone.projection.rows[0].record.id, FIRST_ID);
});

test("revision fences, inherited writes, stale evidence, and operation reuse fail safely", async () => {
  const transactions = transactionFixture();
  const suggestion = {
    owner: "otto/tangent",
    target: { kind: "link", url: "https://github.com/otto/tangent/pull/7" },
    evidence: { kind: "knowledge-line" },
    evidenceHash: "evidence-1",
    targetFingerprint: areaResourceTargetFingerprint({ kind: "link", url: "https://github.com/otto/tangent/pull/7" }),
  };
  /** Returns the one current Knowledge suggestion. */
  const evidenceReader = async () => ({ suggestions: [suggestion], legacyReview: [] });
  const resources = coordinator(transactions, { evidenceReader });
  const stale = await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "link", url: "https://example.com" } }, label: null,
  }, "stale");
  stale.expectedCatalogs[0].revision = "wrong";
  await assert.rejects(resources.apply(stale), (error) => error.code === "catalog-revision-changed");
  await assert.rejects(resources.apply(await request(transactions, {
    kind: "edit", resource: { owner: "otto", id: FIRST_ID }, input: { target: { kind: "link", url: "https://example.com" } }, label: null,
  }, "inherited", "otto/tangent")), (error) => error.code === "inherited-resource-read-only");
  const changedSuggestion = structuredClone(suggestion); changedSuggestion.evidenceHash = "stale-evidence";
  await assert.rejects(resources.apply(await request(transactions, {
    kind: "add-suggestion", selection: { suggestion: changedSuggestion, input: { target: suggestion.target } }, labelForNewRecord: null,
  }, "stale-suggestion")), (error) => error.code === "suggestion-changed");

  const add = await request(transactions, {
    kind: "add", owner: "otto/tangent", input: { target: { kind: "link", url: "https://example.com" } }, label: null,
  }, "replay");
  const first = await resources.apply(add);
  const replay = await resources.apply(add);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.resource.locator.id, first.resource.locator.id);
  assert.equal(replay.undo.token, first.undo.token);
  const reused = structuredClone(add); reused.mutation.input.target.url = "https://example.org";
  const rejected = await resources.apply(reused);
  assert.equal(rejected.code, "operation-id-reused");
});

test("generic Link association commits catalog and scene together, then semantic Undo preserves later layout", async () => {
  const owner = "otto/tangent";
  const sourceFile = areaCanvasPath(owner);
  const initialScene = sceneWithBlock();
  const transactions = transactionFixture({ [sourceFile]: serializeAreaCanvas(initialScene) });
  const resources = coordinator(transactions, {
    /** Supplies the post-commit world revision authority for a source update. */
    sourceRevisionReader: async () => ({ treeRevision: "tree-after-association", worldRevision: "world-after-association" }),
  });
  const associated = await resources.apply(await sceneRequest(transactions, {
    kind: "associate-generic-link",
    owner,
    sourceElementId: "source-link",
    labelForNewRecord: "Pull request",
  }, "associate-link"));

  assert.equal(associated.resource.locator.id, FIRST_ID);
  assert.deepEqual(associated.resource.target, { kind: "link", url: "HTTPS://example.com/pull/1" });
  assert.equal(associated.undo.state, "available");
  assert.equal(associated.sourceUpdates.length, 1);
  assert.equal(associated.sourceUpdates[0].hash, canvasHash(associated.sourceUpdates[0].serializedSource));
  assert.equal(associated.sourceUpdates[0].treeRevision, "tree-after-association");
  assert.equal(associated.sourceUpdates[0].worldRevision, "world-after-association");
  assert.deepEqual(tangentOf(fixtureScene(transactions).elements.find((element) => element.id === "source-link")), {
    kind: "resource",
    ref: FIRST_ID,
  });

  const later = fixtureScene(transactions);
  const laterRoot = later.elements.find((element) => element.id === "source-link");
  laterRoot.x = 777;
  laterRoot.strokeColor = "#1971c2";
  laterRoot.customData.unrelated = { retained: true };
  transactions.files.set(sourceFile, Buffer.from(serializeAreaCanvas(later)));
  const undone = await resources.apply({
    schema: "area-map-resource-mutation.v1",
    operationId: "undo-associate-link",
    viewedFrom: owner,
    mutation: { kind: "undo", token: associated.undo.token },
  });
  const restored = fixtureScene(transactions).elements.find((element) => element.id === "source-link");
  assert.deepEqual(tangentOf(restored), { kind: "link", ref: "HTTPS://Example.COM/pull/1" });
  assert.equal(restored.x, 777);
  assert.equal(restored.strokeColor, "#1971c2");
  assert.deepEqual(restored.customData.unrelated, { retained: true });
  assert.equal(fixtureCatalog(transactions).resources[0].membership.state, "removed", "Undo retains a tombstone for the ended identity");
  assert.equal(undone.sourceUpdates[0].hash, canvasHash(undone.sourceUpdates[0].serializedSource));
});

test("generic Link association reuses an unplaced direct resource and Undo leaves its catalog exact", async () => {
  const owner = "otto/tangent";
  const sourceFile = areaCanvasPath(owner);
  const catalogFile = areaResourceCatalogPath(owner);
  const catalog = emptyAreaResourceCatalog();
  catalog.resources.push({
    id: FIRST_ID,
    label: "Catalog authority",
    membership: { state: "active" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    target: { kind: "link", url: "HTTPS://example.com/pull/1" },
    origin: null,
  });
  const catalogBytes = Buffer.from(serializeAreaResourceCatalog(catalog));
  const transactions = transactionFixture({
    [catalogFile]: catalogBytes,
    [sourceFile]: serializeAreaCanvas(sceneWithBlock({ title: "Different generic label" })),
  });
  const resources = coordinator(transactions);
  const associated = await resources.apply(await sceneRequest(transactions, {
    kind: "associate-generic-link",
    owner,
    sourceElementId: "source-link",
    labelForNewRecord: "Ignored new label",
  }, "associate-existing"));
  assert.equal(associated.resource.locator.id, FIRST_ID);
  assert.equal(associated.resource.label, "Catalog authority");
  assert.deepEqual(transactions.files.get(catalogFile), catalogBytes);

  await resources.apply({
    schema: "area-map-resource-mutation.v1",
    operationId: "undo-associate-existing",
    viewedFrom: owner,
    mutation: { kind: "undo", token: associated.undo.token },
  });
  assert.deepEqual(transactions.files.get(catalogFile), catalogBytes);
  assert.deepEqual(tangentOf(fixtureScene(transactions).elements.find((element) => element.id === "source-link")), {
    kind: "link",
    ref: "HTTPS://Example.COM/pull/1",
  });
});

test("Add back ends the gone identity, creates a new ID, and exact Undo restores its tombstone and ref", async () => {
  const owner = "otto/tangent";
  const sourceFile = areaCanvasPath(owner);
  const catalogFile = areaResourceCatalogPath(owner);
  const catalog = emptyAreaResourceCatalog();
  catalog.resources.push({
    id: FIRST_ID,
    label: "Former checkout",
    membership: { state: "removed", removedAt: "2026-09-01T01:00:00.000Z" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T01:00:00.000Z",
    target: { kind: "worktree", path: "/tmp/former" },
    origin: null,
  });
  const catalogBytes = Buffer.from(serializeAreaResourceCatalog(catalog));
  const transactions = transactionFixture({
    [catalogFile]: catalogBytes,
    [sourceFile]: serializeAreaCanvas(sceneWithBlock({ id: "gone", kind: "resource", ref: FIRST_ID, title: "Last known" })),
  });
  /** Generates the one fresh identity after the fixture's retired identity. */
  const generateId = () => SECOND_ID;
  const resources = coordinator(transactions, { generateId });
  const added = await resources.apply(await sceneRequest(transactions, {
    kind: "add-back-gone",
    oldResource: { owner, id: FIRST_ID },
    source: { kind: "tombstone" },
  }, "add-back"));
  assert.equal(added.resource.locator.id, SECOND_ID);
  assert.equal(added.resource.label, "Former checkout");
  assert.equal(fixtureCatalog(transactions).resources[0].membership.state, "removed");
  assert.deepEqual(tangentOf(fixtureScene(transactions).elements.find((element) => element.id === "gone")), {
    kind: "resource",
    ref: SECOND_ID,
  });

  await resources.apply({
    schema: "area-map-resource-mutation.v1",
    operationId: "undo-add-back",
    viewedFrom: owner,
    mutation: { kind: "undo", token: added.undo.token },
  });
  assert.deepEqual(transactions.files.get(catalogFile), catalogBytes);
  assert.deepEqual(tangentOf(fixtureScene(transactions).elements.find((element) => element.id === "gone")), {
    kind: "resource",
    ref: FIRST_ID,
  });
});

test("missing-record Add back requires confirmed Last-known facts and still creates a new identity", async () => {
  const owner = "otto/tangent";
  const sourceFile = areaCanvasPath(owner);
  const transactions = transactionFixture({
    [sourceFile]: serializeAreaCanvas(sceneWithBlock({ id: "missing", kind: "resource", ref: FIRST_ID, title: "Cached label" })),
  });
  /** Generates the required identity distinct from the missing old reference. */
  const generateId = () => SECOND_ID;
  const resources = coordinator(transactions, { generateId });
  const added = await resources.apply(await sceneRequest(transactions, {
    kind: "add-back-gone",
    oldResource: { owner, id: FIRST_ID },
    source: {
      kind: "confirmed-last-known",
      input: { target: { kind: "link", url: "https://example.test/former" } },
      label: "",
    },
  }, "add-back-last-known"));
  assert.equal(added.resource.locator.id, SECOND_ID);
  assert.equal(added.resource.label, "");
  assert.deepEqual(added.resource.target, { kind: "link", url: "https://example.test/former" });
  assert.deepEqual(tangentOf(fixtureScene(transactions).elements.find((element) => element.id === "missing")), {
    kind: "resource",
    ref: SECOND_ID,
  });
});

test("legacy import requires one explicit Branch attachment across ambiguous selected targets", async () => {
  const owner = "otto/tangent";
  /** Creates one exact legacy review candidate. */
  const candidate = (field, kind, targetPath, evidenceHash) => {
    const target = { kind, path: targetPath };
    return {
      state: "candidate",
      owner,
      target,
      evidence: { kind: "legacy-area-binding", field },
      evidenceHash,
      targetFingerprint: areaResourceTargetFingerprint(target),
      declaredBranch: "topic/resources",
      proposedLabel: targetPath.split("/").at(-1),
    };
  };
  const repository = candidate("Repository", "repository", "/tmp/repository", "legacy-repository");
  const worktree = candidate("Worktree", "worktree", "/tmp/worktree", "legacy-worktree");
  const transactions = transactionFixture();
  const resources = coordinator(transactions, {
    /** Rederives both exact legacy declarations for every attempt. */
    evidenceReader: async () => ({ suggestions: [], legacyReview: [repository, worktree] }),
  });
  /** Creates the complete two-target selection. */
  const selections = (repositoryChoice, worktreeChoice) => [
    { candidate: repository, attachDeclaredBranch: repositoryChoice },
    { candidate: worktree, attachDeclaredBranch: worktreeChoice },
  ];
  await assert.rejects(resources.apply(await request(transactions, {
    kind: "import-legacy",
    selections: selections(false, false),
  }, "legacy-no-branch")), (error) => error.code === "legacy-branch-choice-required");
  await assert.rejects(resources.apply(await request(transactions, {
    kind: "import-legacy",
    selections: selections(true, true),
  }, "legacy-two-branches")), (error) => error.code === "legacy-branch-choice-required");

  await resources.apply(await request(transactions, {
    kind: "import-legacy",
    selections: selections(false, true),
  }, "legacy-one-branch"));
  const records = fixtureCatalog(transactions).resources;
  assert.equal(records.find((record) => record.target.kind === "repository").origin.declaredBranch, null);
  assert.equal(records.find((record) => record.target.kind === "worktree").origin.declaredBranch, "topic/resources");
});

test("one evidence-guard replan accepts an unrelated note edit but rederives the reviewed tuple", async () => {
  const owner = "otto/tangent";
  const noteFile = `${owner}/tangent.md`;
  const target = { kind: "link", url: "https://example.test/review/1" };
  const suggestion = {
    owner,
    target,
    evidence: { kind: "knowledge-line" },
    evidenceHash: "knowledge-line-1",
    targetFingerprint: areaResourceTargetFingerprint(target),
  };
  let installAttempts = 0;
  let evidenceReads = 0;
  const transactions = transactionFixture({ [noteFile]: "Knowledge:\n- https://example.test/review/1\n" }, {
    /** Changes only unrelated note prose between prepare and install once. */
    beforeInstall({ files }) {
      if (installAttempts++ === 0) files.set(noteFile, Buffer.from("Knowledge:\n- https://example.test/review/1\n\nUnrelated prose.\n"));
    },
  });
  /** Rederives the exact current suggestion baseline. */
  const evidenceReader = async () => { evidenceReads += 1; return { suggestions: [suggestion], legacyReview: [] }; };
  /** Co-snapshots evidence and the exact note guard inside each plan. */
  const guardReader = async ({ readEvidence }) => ({
    evidence: await readEvidence(),
    guards: [{ file: noteFile, oldContent: (await transactions.readExact(noteFile)).content, kind: "evidence" }],
  });
  const resources = coordinator(transactions, { evidenceReader, guardReader });
  const result = await resources.apply(await request(transactions, {
    kind: "add-suggestion",
    selection: { suggestion, input: { target } },
    labelForNewRecord: "Review",
  }, "guard-replan-success"));
  assert.equal(result.resource.locator.id, SECOND_ID, "the abandoned first plan never persists its generated identity");
  assert.equal(installAttempts, 2);
  assert.equal(evidenceReads, 2);
});

test("guard replans surface changed evidence and a newly hidden Area without partial writes", async (t) => {
  const owner = "otto/tangent";
  const noteFile = `${owner}/tangent.md`;
  const target = { kind: "link", url: "https://example.test/review/2" };
  const suggestion = {
    owner,
    target,
    evidence: { kind: "knowledge-line" },
    evidenceHash: "knowledge-line-2",
    targetFingerprint: areaResourceTargetFingerprint(target),
  };

  await t.test("evidence changed", async () => {
    let currentSuggestions = [suggestion];
    let raced = false;
    const transactions = transactionFixture({ [noteFile]: "first evidence\n" }, {
      /** Replaces the reviewed evidence immediately before the first install. */
      beforeInstall({ files }) {
        if (raced) return;
        raced = true;
        currentSuggestions = [];
        files.set(noteFile, Buffer.from("changed evidence\n"));
      },
    });
    /** Returns the evidence that remains current at each transaction plan. */
    const evidenceReader = async () => ({ suggestions: currentSuggestions, legacyReview: [] });
    /** Co-snapshots the current evidence and its exact source bytes. */
    const guardReader = async ({ readEvidence }) => ({
      evidence: await readEvidence(),
      guards: [{ file: noteFile, oldContent: (await transactions.readExact(noteFile)).content, kind: "evidence" }],
    });
    const resources = coordinator(transactions, { evidenceReader, guardReader });
    await assert.rejects(resources.apply(await request(transactions, {
      kind: "add-suggestion",
      selection: { suggestion, input: { target } },
      labelForNewRecord: null,
    }, "guard-replan-evidence")), (error) => error.code === "suggestion-changed");
    assert.equal(transactions.files.has(areaResourceCatalogPath(owner)), false);
  });

  await t.test("ancestor status became hidden", async () => {
    let hidden = false;
    let raced = false;
    const transactions = transactionFixture({ [noteFile]: "status: active\n" }, {
      /** Hides the Area immediately before the first install. */
      beforeInstall({ files }) {
        if (raced) return;
        raced = true;
        hidden = true;
        files.set(noteFile, Buffer.from("status: done\n"));
      },
    });
    /** Captures the exact note supplying the inherited Area status. */
    const guardReader = async () => ({
      guards: [{ file: noteFile, oldContent: (await transactions.readExact(noteFile)).content, kind: "status" }],
    });
    /** Rederives the nearest Area status within every transaction plan. */
    const areaReadOnly = async () => hidden;
    const resources = coordinator(transactions, { areaReadOnly, guardReader });
    await assert.rejects(resources.apply(await request(transactions, {
      kind: "add",
      owner,
      input: { target, missingConfirmation: null },
      label: null,
    }, "guard-replan-status")), (error) => error.code === "area-resource-read-only" && error.status === 423);
    assert.equal(transactions.files.has(areaResourceCatalogPath(owner)), false);
  });
});

test("head races retry once while exact catalog target races never retry", async () => {
  const headTransactions = transactionFixture();
  const exactSave = headTransactions.saveExact.bind(headTransactions);
  let headAttempts = 0;
  /** Injects one unrelated prepared-head race before the exact transaction succeeds. */
  headTransactions.saveExact = async (...args) => {
    headAttempts += 1;
    if (headAttempts === 1) return { status: 409, code: "head-race", error: "unrelated head moved" };
    return exactSave(...args);
  };
  const headResources = coordinator(headTransactions);
  const committed = await headResources.apply(await request(headTransactions, {
    kind: "add",
    owner: "otto/tangent",
    input: { target: { kind: "link", url: "https://example.test/head" } },
    label: null,
  }, "head-replan"));
  assert.equal(committed.resource.locator.id, FIRST_ID);
  assert.equal(headAttempts, 2);

  const targetTransactions = transactionFixture();
  let targetAttempts = 0;
  /** Reports one exact target race without running a mutation plan. */
  targetTransactions.saveExact = async () => {
    targetAttempts += 1;
    return { status: 409, code: "target-race", error: "catalog changed" };
  };
  const targetResources = coordinator(targetTransactions);
  const conflict = await targetResources.apply(await request(targetTransactions, {
    kind: "add",
    owner: "otto/tangent",
    input: { target: { kind: "link", url: "https://example.test/target" } },
    label: null,
  }, "target-no-replan"));
  assert.equal(conflict.code, "catalog-revision-changed");
  assert.equal(targetAttempts, 1);
});

test("coordinator synthesizes every accepted current recovery arm", async (t) => {
  const panel = recoveryPanel();
  /** Supplies a new immutable panel snapshot for each failed mutation. */
  const projectionReader = async () => structuredClone(panel);

  await t.test("duplicate and missing targets", async () => {
    const duplicateTransactions = transactionFixture();
    await coordinator(duplicateTransactions).apply(await request(duplicateTransactions, {
      kind: "add", owner: "otto/tangent", input: { target: { kind: "worktree", path: "/tmp/duplicate" }, missingConfirmation: null }, label: null,
    }, "recovery-add"));
    const duplicate = await rejected(coordinator(duplicateTransactions, { projectionReader }).apply(await request(duplicateTransactions, {
      kind: "add", owner: "otto/tangent", input: { target: { kind: "worktree", path: "/tmp/duplicate" }, missingConfirmation: null }, label: null,
    }, "recovery-duplicate")));
    assert.deepEqual(duplicate.recovery, {
      code: "duplicate-resource-target",
      existing: { owner: "otto/tangent", id: FIRST_ID },
      projection: panel,
    });

    const missingTransactions = transactionFixture();
    const target = { kind: "worktree", path: "/tmp/missing" };
    const targetFingerprint = areaResourceTargetFingerprint(target);
    const missing = await rejected(coordinator(missingTransactions, {
      projectionReader,
      /** Returns the exact missing-path fact the form must confirm. */
      inspectTarget: async () => ({ kind: "local", normalized: target, targetFingerprint, state: "missing" }),
    }).apply(await request(missingTransactions, {
      kind: "add", owner: "otto/tangent", input: { target, missingConfirmation: null }, label: null,
    }, "recovery-missing")));
    assert.deepEqual(missing.recovery, {
      code: "missing-target-confirmation-required",
      inspection: { kind: "local", normalized: target, targetFingerprint, state: "missing" },
      projection: panel,
    });
  });

  await t.test("catalog and suggestion changes", async () => {
    const catalogTransactions = transactionFixture();
    const stale = await request(catalogTransactions, {
      kind: "add", owner: "otto/tangent", input: { target: { kind: "link", url: "https://example.test/catalog" } }, label: null,
    }, "recovery-catalog");
    stale.expectedCatalogs[0].revision = "stale";
    const catalog = await rejected(coordinator(catalogTransactions, { projectionReader }).apply(stale));
    assert.deepEqual(catalog.recovery, { code: "catalog-revision-changed", projection: panel });

    const suggestionTransactions = transactionFixture();
    const suggestion = {
      owner: "otto/tangent",
      target: { kind: "link", url: "https://example.test/suggestion" },
      evidence: { kind: "knowledge-line" },
      evidenceHash: "reviewed-evidence",
      targetFingerprint: areaResourceTargetFingerprint({ kind: "link", url: "https://example.test/suggestion" }),
    };
    /** Reports that the reviewed suggestion is no longer current. */
    const changedEvidence = async () => ({ suggestions: [], legacyReview: [] });
    const changed = await rejected(coordinator(suggestionTransactions, {
      projectionReader,
      evidenceReader: changedEvidence,
    }).apply(await request(suggestionTransactions, {
      kind: "add-suggestion",
      selection: { suggestion, input: { target: suggestion.target } },
      labelForNewRecord: null,
    }, "recovery-suggestion")));
    assert.deepEqual(changed.recovery, { code: "suggestion-changed", projection: panel });
  });

  await t.test("ambiguous legacy Branch choices", async () => {
    /** Creates one current legacy candidate with the shared ambiguous Branch. */
    const candidate = (field, kind, targetPath) => ({
      state: "candidate",
      owner: "otto/tangent",
      target: { kind, path: targetPath },
      evidence: { kind: "legacy-area-binding", field },
      evidenceHash: `legacy-${kind}`,
      targetFingerprint: areaResourceTargetFingerprint({ kind, path: targetPath }),
      declaredBranch: "topic/recovery",
      proposedLabel: kind,
    });
    const repository = candidate("Repository", "repository", "/tmp/recovery-repository");
    const worktree = candidate("Worktree", "worktree", "/tmp/recovery-worktree");
    const transactions = transactionFixture();
    /** Rederives both current candidates before enforcing the Branch choice. */
    const branchEvidence = async () => ({ suggestions: [], legacyReview: [repository, worktree] });
    const branch = await rejected(coordinator(transactions, {
      projectionReader,
      evidenceReader: branchEvidence,
    }).apply(await request(transactions, {
      kind: "import-legacy",
      selections: [
        { candidate: repository, attachDeclaredBranch: false },
        { candidate: worktree, attachDeclaredBranch: false },
      ],
    }, "recovery-branch")));
    assert.deepEqual(branch.recovery, {
      code: "legacy-branch-choice-required",
      choices: [
        { owner: "otto/tangent", field: "Repository", targetFingerprint: repository.targetFingerprint, label: "repository" },
        { owner: "otto/tangent", field: "Worktree", targetFingerprint: worktree.targetFingerprint, label: "worktree" },
      ],
      projection: panel,
    });
  });

  await t.test("representation conflict with current source hashes", async () => {
    const owner = "otto/tangent";
    const sourceFile = areaCanvasPath(owner);
    const transactions = transactionFixture({ [sourceFile]: serializeAreaCanvas(sceneWithBlock()) });
    const operation = await sceneRequest(transactions, {
      kind: "associate-generic-link", owner, sourceElementId: "source-link", labelForNewRecord: null,
    }, "recovery-representation");
    const currentHash = operation.expectedScenes[0].hash;
    operation.expectedScenes[0].hash = "stale-scene";
    const conflict = await rejected(coordinator(transactions, { projectionReader }).apply(operation));
    assert.deepEqual(conflict.recovery, {
      code: "resource-representation-conflict",
      currentScenes: [{ owner, hash: currentHash }],
      projection: panel,
    });
  });

  await t.test("source load and invalid problems", async () => {
    const owner = "otto/tangent";
    const sourceFile = areaCanvasPath(owner);
    for (const [code, retryable] of [["resource-source-load-failed", true], ["resource-source-invalid", false]]) {
      const problem = { source: "source-scene", owner, code, message: `Fixture ${code}.`, retryable };
      const sourcePanel = recoveryPanel([{ kind: "projection", error: problem }]);
      const transactions = transactionFixture({ ...(code === "resource-source-invalid" ? { [sourceFile]: "not a scene" } : {}) });
      if (code === "resource-source-load-failed") {
        const readExact = transactions.readExact.bind(transactions);
        /** Fails only the source-scene read with a bounded source code. */
        transactions.readExact = async (file) => {
          if (file === sourceFile) throw Object.assign(new Error("private filesystem detail"), { code, status: 503, retryable: true });
          return readExact(file);
        };
      }
      /** Returns the partial panel carrying the matching source-owned problem. */
      const sourceProjection = async () => structuredClone(sourcePanel);
      const failure = await rejected(coordinator(transactions, {
        projectionReader: sourceProjection,
      }).apply({
        schema: "area-map-resource-mutation.v1",
        operationId: `recovery-source-${retryable}`,
        viewedFrom: owner,
        mutation: { kind: "associate-generic-link", owner, sourceElementId: "source-link", labelForNewRecord: null },
        expectedCatalogs: [{ owner, revision: null }],
        expectedScenes: [{ owner, hash: null }],
      }));
      assert.deepEqual(failure.recovery, { code, problem, projection: sourcePanel });
    }
  });

  await t.test("Undo unavailable and stale", async () => {
    const unavailableTransactions = transactionFixture();
    const unavailable = await rejected(coordinator(unavailableTransactions, { projectionReader }).apply({
      schema: "area-map-resource-mutation.v1",
      operationId: "recovery-undo-unavailable",
      viewedFrom: "otto/tangent",
      mutation: { kind: "undo", token: "missing-token" },
    }));
    assert.deepEqual(unavailable.recovery, { code: "undo-unavailable", projection: panel });

    const staleTransactions = transactionFixture();
    const resources = coordinator(staleTransactions, { projectionReader });
    const added = await resources.apply(await request(staleTransactions, {
      kind: "add", owner: "otto/tangent", input: { target: { kind: "link", url: "https://example.test/undo" } }, label: null,
    }, "recovery-undo-add"));
    const catalogFile = areaResourceCatalogPath("otto/tangent");
    staleTransactions.files.set(catalogFile, Buffer.concat([staleTransactions.files.get(catalogFile), Buffer.from(" ")]));
    const stale = await rejected(resources.apply({
      schema: "area-map-resource-mutation.v1",
      operationId: "recovery-undo-stale",
      viewedFrom: "otto/tangent",
      mutation: { kind: "undo", token: added.undo.token },
    }));
    assert.deepEqual(stale.recovery, { code: "undo-stale", projection: panel });
  });
});
