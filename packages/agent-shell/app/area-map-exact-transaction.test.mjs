import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { createAreaMapTransactionRepository } from "./area-map-transaction-repository.mjs";
import { createVaultRepository } from "./vault-repository.mjs";

const execFileAsync = promisify(execFile);

/** Runs Git inside one isolated transaction fixture. */
async function runGit(args, options = {}) { return execFileAsync("git", args, { encoding: "utf8", ...options }); }

/** Creates one real temporary vault and exact transaction authority. */
async function fixture(name, fault = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), `area-map-exact-${name}-`));
  await runGit(["-C", root, "init", "--quiet"]);
  await runGit(["-C", root, "config", "user.email", "test@tangent.local"]);
  await runGit(["-C", root, "config", "user.name", "Tangent Test"]);
  await mkdir(path.join(root, "otto", "tangent"), { recursive: true });
  await writeFile(path.join(root, "otto", "tangent", "tangent.md"), "# Tangent\n", "utf8");
  await runGit(["-C", root, "add", "."]);
  await runGit(["-C", root, "commit", "--quiet", "-m", "base"]);
  const repository = createAreaCanvasRepository({
    root,
    runGit,
    transactionRoot: path.join(root, ".legacy"),
    /** Prevents the legacy map writer from participating in this fixture. */
    async commit() { throw new Error("unexpected legacy commit"); },
  });
  const transactions = createAreaMapTransactionRepository({
    root,
    repository,
    vault: createVaultRepository({ root, runGit }),
    runGit,
    transactionRoot: path.join(root, ".transactions"),
    fault,
    /** Keeps expected conflict diagnostics out of test output. */
    reportError() {},
  });
  return { root, transactions };
}

test("exact reads and replay rehydrate current response facts without reinstalling bytes", async () => {
  const value = await fixture("rehydrate");
  const file = "otto/tangent/map-resources.json";
  let projections = 0;
  /** Rebuilds the deliberately non-durable response projection. */
  const rehydrate = async (result) => ({ ...result, projection: ++projections });
  /** Builds one exact catalog write. */
  const plan = async () => ({ targets: [{ file, oldContent: null, newContent: "{\"schema\":\"area-map-resources.v1\"}\n" }], message: "add: resource", result: { effect: "added" } });
  const first = await value.transactions.saveExact(plan, { operationId: "resource-add", worldId: "resources", area: "otto/tangent", intent: { kind: "add" }, rehydrate });
  assert.equal(first.projection, 1);
  assert.equal((await value.transactions.readExact(file)).content.toString(), "{\"schema\":\"area-map-resources.v1\"}\n");
  const replay = await value.transactions.saveExact(plan, { operationId: "resource-add", worldId: "resources", area: "otto/tangent", intent: { kind: "add" }, rehydrate });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.projection, 2);
  const reused = await value.transactions.saveExact(plan, { operationId: "resource-add", worldId: "resources", area: "otto/tangent", intent: { kind: "edit" } });
  assert.equal(reused.code, "operation-id-reused");
});

test("journals an exact no-op so retry identity cannot be reused with different content", async () => {
  const value = await fixture("noop");
  /** Returns a semantic no-op with a useful durable effect. */
  const noChange = async () => ({ targets: [], message: "no change", result: { effect: "already-present" } });
  const first = await value.transactions.saveExact(noChange, { operationId: "resource-noop", worldId: "resources", intent: { kind: "add", target: "same" } });
  assert.equal(first.idempotent, false);
  const repeated = await value.transactions.saveExact(noChange, { operationId: "resource-noop", worldId: "resources", intent: { kind: "add", target: "same" } });
  assert.equal(repeated.idempotent, true);
  const reused = await value.transactions.saveExact(noChange, { operationId: "resource-noop", worldId: "resources", intent: { kind: "remove" } });
  assert.equal(reused.code, "operation-id-reused");
});

test("rejects a read-only evidence guard that changes after prepare with a stable code", async () => {
  let root;
  const value = await fixture("guard", async (phase) => {
    if (phase === "prepared") await writeFile(path.join(root, "otto", "tangent", "tangent.md"), "# Changed outside transaction\n", "utf8");
  });
  root = value.root;
  const note = "otto/tangent/tangent.md";
  const oldNote = await readFile(path.join(root, note));
  const result = await value.transactions.saveExact(async () => ({
    targets: [{ file: "otto/tangent/map-resources.json", oldContent: null, newContent: "{}\n" }],
    guards: [{ file: note, oldContent: oldNote }],
    message: "add: guarded resource",
  }), { operationId: "guarded", worldId: "resources", area: "otto/tangent", intent: { kind: "import" } });
  assert.equal(result.status, 409);
  assert.equal(result.code, "guard-race");
  await assert.rejects(readFile(path.join(root, "otto", "tangent", "map-resources.json")), { code: "ENOENT" });
});

test("preserves only a validated typed recovery bag across an exact transaction failure", async () => {
  const value = await fixture("typed-recovery");
  const panel = {
    state: "current",
    rows: [],
    catalogs: [{ owner: "otto/tangent", revision: null }],
    legacyReview: [],
    suggestions: [],
    counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
  };
  const result = await value.transactions.saveExact(async () => {
    throw Object.assign(new Error("typed catalog conflict"), {
      status: 409,
      code: "duplicate-resource-target",
      retryable: false,
      existing: { owner: "otto/tangent", id: "resource-1", target: "/private" },
      projection: { ...panel, credentials: "private" },
      providerBody: "private",
      target: { kind: "worktree", path: "/private" },
    });
  }, { operationId: "typed-recovery", worldId: "resources", area: "otto/tangent", intent: { kind: "add" } });

  assert.equal(result.status, 409);
  assert.equal(result.operationId, "typed-recovery");
  assert.deepEqual(result.recovery, {
    code: "duplicate-resource-target",
    existing: { owner: "otto/tangent", id: "resource-1" },
    projection: panel,
  });
  assert.equal(result.providerBody, undefined);
  assert.equal(result.target, undefined);
  assert.equal(JSON.stringify(result.recovery).includes("private"), false);
});
