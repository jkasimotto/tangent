import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { createAreaMapTransactionRepository } from "./area-map-transaction-repository.mjs";
import { createAreaResourceMutationCoordinator } from "./area-resource-mutations.mjs";
import { areaResourceCatalogPath, parseAreaResourceCatalog } from "./area-resource-catalog.mjs";
import { createVaultRepository } from "./vault-repository.mjs";

const run = promisify(execFile);
const OWNER = "otto/tangent";
const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

/** Runs one Git command inside an isolated fixture vault. */
async function git(root, args) { return run("git", ["-C", root, ...args], { encoding: "utf8" }); }

/** Suppresses expected transaction diagnostics inside conflict assertions. */
function ignoreError() {}

/** Creates one real Git vault and the production exact transaction repository. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-transaction-"));
  await mkdir(path.join(root, OWNER), { recursive: true });
  await writeFile(path.join(root, OWNER, "tangent.md"), "# Tangent\n\n## Purpose\n\nTest resources.\n");
  await writeFile(path.join(root, "staged.md"), "base staged\n");
  await writeFile(path.join(root, "working.md"), "base working\n");
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "test@tangent.local"]);
  await git(root, ["config", "user.name", "Tangent Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "--quiet", "-m", "base"]);
  const vault = createVaultRepository({
    root,
    /** Runs one production-shaped Git operation in the fixture vault. */
    runGit: (args, options = {}) => run("git", args, options),
  });
  const repository = createAreaCanvasRepository({
    root,
    /** Runs one production-shaped Git operation in the fixture vault. */
    runGit: (args, options = {}) => run("git", args, options),
    /** Refuses the legacy commit path. */
    async commit() { throw new Error("unexpected legacy commit"); },
    transactionRoot: path.join(root, ".state", "legacy"),
  });
  const transactions = createAreaMapTransactionRepository({
    root,
    repository,
    vault,
    /** Runs one production-shaped Git operation in the fixture vault. */
    runGit: (args, options = {}) => run("git", args, options),
    transactionRoot: path.join(root, ".state", "transactions"),
    reportError: ignoreError,
  });
  /** Returns the fixed fixture clock. */
  const now = () => "2026-09-02T12:00:00.000Z";
  /** Returns the fixed fixture resource ID. */
  const generateId = () => RESOURCE_ID;
  /** Returns the fixed process-local Undo token. */
  const generateUndoToken = () => "undo-real-add";
  const resources = createAreaResourceMutationCoordinator({
    transactions,
    /** Confirms only the two physical fixture Areas. */
    areaExists: async (area) => ["otto", OWNER].includes(area),
    /** Returns a normalized available target without touching a real worktree. */
    inspectTarget: async (target) => ({ kind: "local", normalized: target, targetFingerprint: "fixture-target", state: "available" }),
    now,
    generateId,
    generateUndoToken,
  });
  return { root, resources, transactions };
}

/** Builds the one first-write request against a missing catalog revision. */
function addRequest(operationId = "real-add") {
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: OWNER,
    mutation: {
      kind: "add",
      owner: OWNER,
      input: { target: { kind: "worktree", path: "/tmp/exact-worktree" }, missingConfirmation: null },
      label: "Exact worktree",
    },
    expectedCatalogs: [{ owner: OWNER, revision: null }],
  };
}

test("real exact catalog commits preserve unrelated edits, replay safely, and Undo exact bytes", async () => {
  const value = await fixture();
  await writeFile(path.join(value.root, "staged.md"), "user staged\n");
  await git(value.root, ["add", "staged.md"]);
  await writeFile(path.join(value.root, "working.md"), "user working\n");
  const base = String((await git(value.root, ["rev-parse", "HEAD"])).stdout).trim();

  const added = await value.resources.apply(addRequest());

  assert.equal(added.committed, true);
  assert.equal(added.resource.locator.id, RESOURCE_ID);
  assert.deepEqual(added.undo, { state: "available", token: "undo-real-add" });
  assert.equal(String((await git(value.root, ["rev-list", "--count", `${base}..HEAD`])).stdout).trim(), "1");
  const catalog = parseAreaResourceCatalog(await readFile(path.join(value.root, areaResourceCatalogPath(OWNER))));
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.catalog.resources.map((record) => [record.id, record.target.path]), [[RESOURCE_ID, "/tmp/exact-worktree"]]);
  assert.equal(await readFile(path.join(value.root, "staged.md"), "utf8"), "user staged\n");
  assert.equal(await readFile(path.join(value.root, "working.md"), "utf8"), "user working\n");
  assert.match(String((await git(value.root, ["diff", "--cached", "--name-only"])).stdout), /staged\.md/);
  assert.match(String((await git(value.root, ["diff", "--name-only"])).stdout), /working\.md/);

  const replay = await value.resources.apply(addRequest());
  assert.equal(replay.operationId, "real-add");
  assert.equal(replay.undo.token, "undo-real-add");
  assert.equal(String((await git(value.root, ["rev-list", "--count", `${base}..HEAD`])).stdout).trim(), "1");

  const undone = await value.resources.apply({
    schema: "area-map-resource-mutation.v1",
    operationId: "real-undo",
    viewedFrom: OWNER,
    mutation: { kind: "undo", token: added.undo.token },
  });
  assert.equal(undone.committed, true);
  assert.equal(undone.projection.rows.length, 0);
  await assert.rejects(readFile(path.join(value.root, areaResourceCatalogPath(OWNER))), { code: "ENOENT" });
  assert.equal(String((await git(value.root, ["rev-list", "--count", `${base}..HEAD`])).stdout).trim(), "2");
  assert.equal(await readFile(path.join(value.root, "staged.md"), "utf8"), "user staged\n");
  assert.equal(await readFile(path.join(value.root, "working.md"), "utf8"), "user working\n");
});

test("a durable replay after coordinator restart cannot recreate a process-local Undo token", async () => {
  const value = await fixture();
  await value.resources.apply(addRequest("restart-add"));
  const restarted = createAreaResourceMutationCoordinator({
    transactions: value.transactions,
    /** Confirms only the fixture owner. */
    areaExists: async (area) => ["otto", OWNER].includes(area),
  });
  const replay = await restarted.apply(addRequest("restart-add"));
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.undo, { state: "unavailable" });
  assert.equal(replay.projection.rows.length, 1);
});
