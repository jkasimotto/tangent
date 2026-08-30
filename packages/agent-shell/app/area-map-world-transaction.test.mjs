import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { createAreaMapTransactionRepository } from "./area-map-transaction-repository.mjs";
import { serializeAreaCanvas } from "./area-canvas.mjs";
import { createVaultRepository } from "./vault-repository.mjs";
import { createEmptyScene, createTextElement } from "./public/area-board-core.js";

const execFileAsync = promisify(execFile);

/** Runs Git with the environment required by the exact-index transaction path. */
async function runGit(args, options = {}) {
  return execFileAsync("git", args, { encoding: "utf8", ...options });
}

/** Returns a valid scene with one easy-to-identify authored element. */
function scene(label, x = 0) {
  const value = createEmptyScene();
  value.elements.push(createTextElement({ id: label.toLowerCase(), text: label, x, y: 20, width: 120, height: 30 }));
  return value;
}

/** Creates a real Git vault and both repositories used by map transactions. */
async function fixture(name, { fault = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `area-map-transaction-${name}-`));
  await runGit(["-C", root, "init", "--quiet"]);
  await runGit(["-C", root, "config", "user.email", "test@tangent.local"]);
  await runGit(["-C", root, "config", "user.name", "Tangent Test"]);
  await mkdir(path.join(root, "neara", "delivery", "standards"), { recursive: true });
  await writeFile(path.join(root, "unrelated-staged.md"), "base staged\n");
  await writeFile(path.join(root, "unrelated-worktree.md"), "base worktree\n");
  await runGit(["-C", root, "add", "."]);
  await runGit(["-C", root, "commit", "--quiet", "-m", "base"]);
  const transactionRoot = path.join(root, ".test-state", "transactions");
  const repository = createAreaCanvasRepository({
    root,
    runGit,
    transactionRoot: path.join(root, ".legacy-state"),
    /** This repository only supplies reads to the transaction authority. */
    async commit() { throw new Error("the transaction authority must own commits"); },
  });
  const vault = createVaultRepository({ root, runGit });
  const transactions = createAreaMapTransactionRepository({
    root, repository, vault, runGit, transactionRoot, fault,
    /** Keeps expected transaction failures quiet in tests. */
    reportError() {},
  });
  return { root, repository, transactionRoot, transactions, vault };
}

/** Reads the only operation manifest in a transaction fixture. */
async function manifest(transactionRoot) {
  const worlds = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const operations = await readdir(path.join(transactionRoot, worlds[0].name));
  return JSON.parse(await readFile(path.join(transactionRoot, worlds[0].name, operations[0], "manifest.json"), "utf8"));
}

test("one gesture writes every source shard in one exact commit and preserves unrelated edits", async () => {
  const value = await fixture("exact");
  await writeFile(path.join(value.root, "unrelated-staged.md"), "user staged\n");
  await runGit(["-C", value.root, "add", "unrelated-staged.md"]);
  await writeFile(path.join(value.root, "unrelated-worktree.md"), "user worktree\n");
  const before = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();
  const writes = [
    { area: "neara", baseHash: null, canvas: scene("Neara"), reason: "Neara extent" },
    { area: "neara/delivery", baseHash: null, canvas: scene("Delivery"), reason: "Delivery extent" },
    { area: "neara/delivery/standards", baseHash: null, canvas: scene("Standards"), reason: "Standards move" },
  ];

  const saved = await value.transactions.saveMany(writes, { operationId: "gesture-1", worldId: "otto", area: "neara/delivery/standards" });

  assert.equal(saved.committed, true);
  assert.equal(String((await runGit(["-C", value.root, "rev-list", "--count", `${before}..HEAD`])).stdout).trim(), "1");
  assert.match(String((await runGit(["-C", value.root, "show", "--format=%B", "--no-patch", "HEAD"])).stdout), /Tangent-Map-Operation: gesture-1/);
  for (const write of writes) {
    const loaded = await value.repository.read(write.area);
    assert.deepEqual(loaded.scene, write.canvas);
    assert.deepEqual(JSON.parse(String((await runGit(["-C", value.root, "show", `HEAD:${loaded.file}`])).stdout)), write.canvas);
  }
  assert.equal(await readFile(path.join(value.root, "unrelated-staged.md"), "utf8"), "user staged\n");
  assert.equal(await readFile(path.join(value.root, "unrelated-worktree.md"), "utf8"), "user worktree\n");
  assert.match(String((await runGit(["-C", value.root, "diff", "--cached", "--name-only"])).stdout), /unrelated-staged\.md/);
  assert.match(String((await runGit(["-C", value.root, "diff", "--name-only"])).stdout), /unrelated-worktree\.md/);

  const head = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();
  assert.equal((await value.transactions.saveMany(writes, { operationId: "gesture-1", worldId: "otto" })).idempotent, true);
  assert.equal(String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim(), head);
  const reused = await value.transactions.saveMany([{ ...writes[0], canvas: scene("Changed") }], { operationId: "gesture-1", worldId: "otto" });
  assert.equal(reused.status, 409);
});

for (const phase of ["prepared", "ref-installed", "index-installed", "target-installed:0", "target-installed:1", "verified", "result-recorded"]) {
  test(`startup recovery completes the ${phase} crash phase before a read`, async () => {
    let crashed = false;
    const value = await fixture(phase.replaceAll(":", "-"), {
      /** Simulates one process exit at the selected durable checkpoint. */
      fault(current) {
      if (!crashed && current === phase) { crashed = true; throw Object.assign(new Error(`crash at ${phase}`), { simulatedCrash: true }); }
      },
    });
    const writes = [
      { area: "neara", baseHash: null, canvas: scene("Neara new", 40) },
      { area: "neara/delivery", baseHash: null, canvas: scene("Delivery new", 80) },
    ];
    await assert.rejects(value.transactions.saveMany(writes, { operationId: `crash-${phase}`, worldId: "otto" }), /crash at/);

    const restarted = createAreaMapTransactionRepository({
      root: value.root, repository: value.repository, vault: value.vault, runGit,
      transactionRoot: value.transactionRoot,
      /** Keeps expected transaction failures quiet in tests. */
      reportError() {},
    });
    await restarted.waitForReadable();
    for (const write of writes) assert.deepEqual((await value.repository.read(write.area)).scene, write.canvas);
    assert.equal((await manifest(value.transactionRoot)).state, "committed");
  });
}

test("readers wait through the complete multi-shard install window", async () => {
  let releaseInstall;
  const installPaused = new Promise((resolve) => { releaseInstall = resolve; });
  let reachedInstall;
  const installReached = new Promise((resolve) => { reachedInstall = resolve; });
  const value = await fixture("barrier", {
    /** Pauses the simulated installer after the prepared ref becomes current. */
    async fault(phase) {
      if (phase === "ref-installed") { reachedInstall(); await installPaused; }
    },
  });
  const saving = value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Neara") },
    { area: "neara/delivery", baseHash: null, canvas: scene("Delivery") },
  ], { operationId: "barrier", worldId: "otto" });
  await installReached;
  let readable = false;
  const reading = value.transactions.read("neara").then((result) => { readable = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(readable, false);
  releaseInstall();
  const [, loaded] = await Promise.all([saving, reading]);
  assert.equal(readable, true);
  assert.equal(loaded.scene.elements[0].text, "Neara");
});

test("a writer waits for a reader that started before the multi-shard install", async () => {
  let refInstalled = false;
  const value = await fixture("active-reader", {
    /** Records the first externally visible commit phase. */
    fault(phase) { if (phase === "ref-installed") refInstalled = true; },
  });
  const originalRead = value.repository.read;
  let releaseRead;
  const readPaused = new Promise((resolve) => { releaseRead = resolve; });
  let readerEntered;
  const readerStarted = new Promise((resolve) => { readerEntered = resolve; });
  let pauseFirstRead = true;
  value.repository.read = async (area) => {
    const result = await originalRead(area);
    if (pauseFirstRead) {
      pauseFirstRead = false;
      readerEntered();
      await readPaused;
    }
    return result;
  };

  const reading = value.transactions.read("neara");
  await readerStarted;
  const saving = value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Neara") },
    { area: "neara/delivery", baseHash: null, canvas: scene("Delivery") },
  ], { operationId: "active-reader", worldId: "otto" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(refInstalled, false, "the branch ref stays old while a complete old-state read is active");

  releaseRead();
  const [oldRead, saved] = await Promise.all([reading, saving]);
  assert.deepEqual(oldRead.scene.elements, []);
  assert.equal(saved.committed, true);
  assert.equal(refInstalled, true);
});

test("a target edit after prepare aborts before the branch ref or worktree is overwritten", async () => {
  let value;
  const external = scene("External edit", 70);
  let changed = false;
  value = await fixture("prepare-race", {
    /** Simulates an editor changing one target after its optimistic read. */
    async fault(phase) {
      if (phase !== "prepared" || changed) return;
      changed = true;
      await writeFile(path.join(value.root, "neara", "neara.excalidraw"), serializeAreaCanvas(external));
    },
  });
  const before = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();

  const saved = await value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Gesture") },
  ], { operationId: "prepare-race", worldId: "otto" });

  assert.equal(saved.status, 409);
  assert.equal(saved.conflict, true);
  assert.deepEqual((await value.repository.read("neara")).scene, external);
  assert.equal(String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim(), before);
  assert.equal((await manifest(value.transactionRoot)).state, "conflict");
});

test("recovery refuses to overwrite unrelated target bytes", async () => {
  let crashed = false;
  const value = await fixture("unrelated", {
    /** Stops once after the journal is durable and before Git changes. */
    fault(phase) {
      if (!crashed && phase === "prepared") { crashed = true; throw Object.assign(new Error("crash"), { simulatedCrash: true }); }
    },
  });
  await assert.rejects(value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Neara") },
  ], { operationId: "unrelated", worldId: "otto" }));
  await mkdir(path.join(value.root, "neara"), { recursive: true });
  await writeFile(path.join(value.root, "neara", "neara.excalidraw"), `${JSON.stringify(scene("Unrelated"), null, 2)}\n`);
  const restarted = createAreaMapTransactionRepository({
    root: value.root, repository: value.repository, vault: value.vault, runGit,
    transactionRoot: value.transactionRoot,
    /** Keeps expected transaction failures quiet in tests. */
    reportError() {},
  });
  await assert.rejects(restarted.waitForReadable(), (error) => error.status === 503 && error.recoveryRequired?.reason.includes("unrelated bytes"));
  const lastComplete = await restarted.read("neara");
  assert.deepEqual(lastComplete.scene.elements, [], "map reads use the last complete Git snapshot");
  assert.equal((await manifest(value.transactionRoot)).state, "recovery-required");
  assert.equal(JSON.parse(await readFile(path.join(value.root, "neara", "neara.excalidraw"), "utf8")).elements[0].text, "Unrelated");
});

test("a writer recovers an earlier operation that failed after its startup recovery", async () => {
  let crashed = false;
  const value = await fixture("later-writer", {
    /** Leaves one prepared operation after another writer already started. */
    fault(phase) {
      if (!crashed && phase === "prepared") { crashed = true; throw Object.assign(new Error("writer exited"), { simulatedCrash: true }); }
    },
  });
  const later = createAreaMapTransactionRepository({
    root: value.root, repository: value.repository, vault: value.vault, runGit,
    transactionRoot: value.transactionRoot,
    /** Keeps expected transaction failures quiet in tests. */
    reportError() {},
  });
  await later.recover();
  await assert.rejects(value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Neara") },
  ], { operationId: "earlier", worldId: "otto" }), /writer exited/);

  const stale = await later.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Later", 90) },
  ], { operationId: "stale-later", worldId: "otto" });
  assert.equal(stale.status, 409, "the later write sees the recovered committed hash");
  assert.equal((await value.repository.read("neara")).scene.elements[0].text, "Neara");
  const recoveredHash = (await value.repository.read("neara")).hash;
  const saved = await later.saveMany([
    { area: "neara", baseHash: recoveredHash, canvas: scene("Later", 90) },
  ], { operationId: "later", worldId: "otto" });

  assert.equal(saved.committed, true);
  assert.equal((await value.repository.read("neara")).scene.elements[0].text, "Later");
  assert.equal(String((await runGit(["-C", value.root, "rev-list", "--count", "HEAD~2..HEAD"])).stdout).trim(), "2");
});
