import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { areaResourceCatalogPath, areaResourceTargetFingerprint } from "./area-resource-catalog.mjs";
import { createAreaResourceMutationCoordinator, inspectAreaResourceTarget } from "./area-resource-mutations.mjs";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

/** Returns the exact revision used by the catalog transaction contract. */
function hash(content) { return content === null ? null : createHash("sha256").update(content).digest("hex"); }

/** Creates an in-memory exact transaction authority with operation replay. */
function transactionFixture(initial = {}) {
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
        return { ...prior.result, idempotent: true };
      }
      const plan = await buildPlan();
      for (const target of plan.targets ?? []) {
        const current = files.get(target.file) ?? null;
        assert.equal(hash(current), hash(target.oldContent ?? null), `stale fixture target ${target.file}`);
      }
      for (const target of plan.targets ?? []) {
        if (target.newContent === null) files.delete(target.file);
        else files.set(target.file, Buffer.from(target.newContent));
      }
      const result = { ...plan.result, committed: true, operationId: options.operationId, idempotent: false };
      receipts.set(options.operationId, { digest, result });
      return result;
    },
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
