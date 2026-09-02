import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
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
async function fixture(name, { fault = null, recordEvent = null, wrapVault = null } = {}) {
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
  const transactionVault = wrapVault?.(vault) ?? vault;
  const transactions = createAreaMapTransactionRepository({
    root, repository, vault: transactionVault, runGit, transactionRoot, fault, recordEvent,
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
  const events = [];
  const value = await fixture("exact", {
    /** Captures one transaction phase event. */
    recordEvent: (event) => events.push(event),
  });
  await writeFile(path.join(value.root, "unrelated-staged.md"), "user staged\n");
  await runGit(["-C", value.root, "add", "unrelated-staged.md"]);
  await writeFile(path.join(value.root, "unrelated-worktree.md"), "user worktree\n");
  const before = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();
  const writes = [
    { area: "neara", baseHash: null, canvas: scene("Neara"), reason: "Neara extent" },
    { area: "neara/delivery", baseHash: null, canvas: scene("Delivery"), reason: "Delivery extent" },
    { area: "neara/delivery/standards", baseHash: null, canvas: scene("Standards"), reason: "Standards move" },
  ];

  const acknowledgement = { worldId: "world-exact", treeRevision: "tree-exact", worldRevision: "revision-exact" };
  const saved = await value.transactions.saveMany(writes, { operationId: "gesture-1", worldId: "otto", area: "neara/delivery/standards", acknowledgement });

  assert.equal(saved.committed, true);
  assert.deepEqual(saved.acknowledgement, acknowledgement);
  assert.ok(saved.bytes > 0);
  assert.equal((await manifest(value.transactionRoot)).result.bytes, saved.bytes, "the complete response is journaled before the commit becomes acknowledged");
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
  assert.deepEqual(events.filter((event) => event.name === "area_map_save_phase").map((event) => event.phase), [
    "prepared", "ref-installed", "index-installed", "target-installed:0", "target-installed:1", "target-installed:2", "verified", "result-recorded",
  ]);
  assert.ok(events.filter((event) => event.name === "area_map_save_phase").every((event) => event.operationId === "gesture-1" && event.shardCount === 3 && event.duration >= 0));

  const head = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();
  let repeatedPreflight = false;
  const repeated = await value.transactions.saveMany(writes, {
    operationId: "gesture-1", worldId: "otto",
    /** A committed operation must resolve before a now-stale world preflight. */
    async preflight() { repeatedPreflight = true; return { status: 409, code: "world-race" }; },
  });
  assert.equal(repeated.idempotent, true);
  assert.deepEqual(repeated.acknowledgement, acknowledgement, "the committed revision descriptor survives idempotent retries");
  assert.equal(repeatedPreflight, false);
  assert.equal(String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim(), head);
  const reused = await value.transactions.saveMany([{ ...writes[0], canvas: scene("Changed") }], { operationId: "gesture-1", worldId: "otto" });
  assert.equal(reused.status, 409);
});

test("a declared intent replays across changed write bytes while a different intent is refused", async () => {
  const value = await fixture("intent-replay");
  await value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Initial"), reason: "seed" },
  ], { operationId: "seed", worldId: "seed", area: "neara" });
  const before = await value.repository.read("neara");
  const intent = { kind: "place", resource: { owner: "neara", id: "resource-one" } };
  const acknowledgement = { representation: "on-map" };

  const first = await value.transactions.saveMany([
    { area: "neara", baseHash: before.hash, canvas: scene("Placed"), reason: "place" },
  ], { operationId: "place-once", worldId: "resource", area: "neara", intent, acknowledgement });
  assert.equal(first.committed, true);
  assert.equal(first.idempotent, false);
  const after = await value.repository.read("neara");
  assert.notEqual(after.hash, before.hash);
  const head = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();

  // A stateless retry plans from the committed bytes: same intent, different writes.
  const retry = await value.transactions.saveMany([
    { area: "neara", baseHash: after.hash, canvas: after.scene, reason: "place again" },
  ], { operationId: "place-once", worldId: "resource", area: "neara", intent, acknowledgement });
  assert.equal(retry.committed, true);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.acknowledgement, acknowledgement);
  assert.equal(String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim(), head, "the retry adds no Git commit");

  const reused = await value.transactions.saveMany([
    { area: "neara", baseHash: after.hash, canvas: after.scene, reason: "hide" },
  ], { operationId: "place-once", worldId: "resource", area: "neara", intent: { ...intent, kind: "hide" }, acknowledgement });
  assert.equal(reused.status, 409);
  assert.equal(reused.code, "operation-id-reused");
});

test("a no-change source gesture durably claims its operation intent", async () => {
  const value = await fixture("no-change-receipt");
  const initial = scene("Initial");
  await value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: initial, reason: "seed" },
  ], { operationId: "seed", worldId: "seed", area: "neara" });
  const current = await value.repository.read("neara");
  const writes = [{ area: "neara", baseHash: current.hash, canvas: current.scene, reason: "already hidden" }];
  const intent = { kind: "hide", resource: { owner: "neara", id: "resource-one" } };
  const acknowledgement = { representation: "hidden" };
  const head = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();

  const first = await value.transactions.saveMany(writes, {
    operationId: "no-change", worldId: "resource", area: "neara", intent, acknowledgement,
  });
  assert.equal(first.committed, true);
  assert.equal(first.idempotent, true);
  assert.deepEqual(first.acknowledgement, acknowledgement);
  assert.equal(String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim(), head, "a no-change receipt adds no Git commit");

  const replay = await value.transactions.saveMany(writes, {
    operationId: "no-change", worldId: "resource", area: "neara", intent, acknowledgement,
  });
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.acknowledgement, acknowledgement);

  const reused = await value.transactions.saveMany(writes, {
    operationId: "no-change", worldId: "resource", area: "neara", intent: { ...intent, kind: "restore" }, acknowledgement,
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.code, "operation-id-reused");
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

    const recoveryEvents = [];
    const restarted = createAreaMapTransactionRepository({
      root: value.root, repository: value.repository, vault: value.vault, runGit,
      transactionRoot: value.transactionRoot,
      /** Captures recovery results from the restarted authority. */
      recordEvent: (event) => recoveryEvents.push(event),
      /** Keeps expected transaction failures quiet in tests. */
      reportError() {},
    });
    await restarted.waitForReadable();
    for (const write of writes) assert.deepEqual((await value.repository.read(write.area)).scene, write.canvas);
    assert.equal((await manifest(value.transactionRoot)).state, "committed");
    assert.deepEqual(recoveryEvents.filter((event) => event.name === "area_map_recovery").map(({ priorPhase, outcome }) => ({ priorPhase, outcome })), phase === "result-recorded" ? [] : [
      { priorPhase: "prepared", outcome: "started" },
      { priorPhase: "prepared", outcome: "completed" },
    ], "a durable committed result needs no later recovery event");
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

test("an ordinary install error keeps waiting readers on complete Git authority and recovers in process", async () => {
  let releaseFailure;
  const failurePaused = new Promise((resolve) => { releaseFailure = resolve; });
  let reachedFailure;
  const failureReached = new Promise((resolve) => { reachedFailure = resolve; });
  let failed = false;
  const value = await fixture("same-process-recovery", {
    /** Fails once after one target install without simulating process death. */
    async fault(phase) {
      if (failed || phase !== "target-installed:0") return;
      failed = true;
      reachedFailure();
      await failurePaused;
      throw new Error("ordinary target install failure");
    },
  });
  const saving = value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Neara") },
    { area: "neara/delivery", baseHash: null, canvas: scene("Delivery") },
  ], { operationId: "same-process-recovery", worldId: "otto" });
  await failureReached;
  let readDone = false;
  const reading = value.transactions.withRead(async () => {
    const result = await Promise.all([value.transactions.read("neara"), value.transactions.read("neara/delivery")]);
    readDone = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(readDone, false, "the reader stays behind the active install barrier");

  releaseFailure();
  const [saveResult, [nearRead, deliveryRead]] = await Promise.all([saving, reading]);
  assert.equal(saveResult.status, 503);
  assert.deepEqual([nearRead.scene.elements[0].text, deliveryRead.scene.elements[0].text], ["Neara", "Delivery"], "the waiting reader uses one complete Git revision");

  const recovered = await Promise.all([value.transactions.read("neara"), value.transactions.read("neara/delivery")]);
  assert.deepEqual(recovered.map((entry) => entry.scene.elements[0].text), ["Neara", "Delivery"]);
  assert.equal((await manifest(value.transactionRoot)).state, "committed", "the same process completes journal recovery before its next fresh read");
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

test("an unrelated commit during prepare is a retryable head race, not permanent recovery", async () => {
  let value;
  let advanced = false;
  value = await fixture("head-race", {
    /** Advances the branch with unrelated durable work after the map commit was prepared. */
    async fault(phase) {
      if (phase !== "prepared" || advanced) return;
      advanced = true;
      await writeFile(path.join(value.root, "unrelated-race.md"), "unrelated durable work\n");
      await runGit(["-C", value.root, "add", "unrelated-race.md"]);
      await runGit(["-C", value.root, "commit", "--quiet", "-m", "unrelated race"]);
    },
  });
  const writes = [{ area: "neara", baseHash: null, canvas: scene("Gesture") }];

  const raced = await value.transactions.saveMany(writes, { operationId: "head-race", worldId: "otto" });

  assert.deepEqual({ status: raced.status, code: raced.code, retryable: raced.retryable }, { status: 409, code: "head-race", retryable: true });
  assert.equal((await manifest(value.transactionRoot)).state, "aborted");
  await value.transactions.waitForReadable();
  assert.deepEqual((await value.repository.read("neara")).scene.elements, [], "the failed pre-ref attempt did not change map authority");

  const retried = await value.transactions.saveMany(writes, { operationId: "head-race", worldId: "otto" });
  assert.equal(retried.committed, true, "the same idempotency key can safely reprepare on the new head");
  assert.equal((await value.repository.read("neara")).scene.elements[0].text, "Gesture");
  assert.equal(await readFile(path.join(value.root, "unrelated-race.md"), "utf8"), "unrelated durable work\n");
});

test("a lost update-ref success enters recovery instead of aborting the installed commit", async () => {
  let lost = false;
  const value = await fixture("lost-ref-success", {
    /** Simulates a wrapper losing the successful response after update-ref became durable. */
    wrapVault(vault) {
      return {
        ...vault,
        /** Installs the commit, then loses the first successful acknowledgement. */
        async installPreparedCommit(prepared) {
          await vault.installPreparedCommit(prepared);
          if (!lost) { lost = true; throw new Error("lost update-ref success response"); }
        },
      };
    },
  });
  const writes = [{ area: "neara", baseHash: null, canvas: scene("Installed Neara") }];
  const acknowledgement = { worldId: "world-lost", treeRevision: "tree-lost", worldRevision: "revision-lost" };

  const interrupted = await value.transactions.saveMany(writes, { operationId: "lost-ref-success", worldId: "otto", acknowledgement });

  assert.deepEqual({ status: interrupted.status, code: interrupted.code, retryable: interrupted.retryable }, { status: 503, code: "install-interrupted", retryable: true });
  assert.equal((await manifest(value.transactionRoot)).state, "prepared", "the installed ref remains recoverable instead of becoming an ignored abort");
  await value.transactions.waitForReadable();
  assert.equal((await manifest(value.transactionRoot)).state, "committed");
  assert.equal((await value.repository.read("neara")).scene.elements[0].text, "Installed Neara");
  const recovered = await value.transactions.saveMany(writes, { operationId: "lost-ref-success", worldId: "otto" });
  assert.equal(recovered.idempotent, true);
  assert.deepEqual(recovered.acknowledgement, acknowledgement, "recovery retains the descriptor that was journaled before update-ref");
});

test("the transaction preflight rejects a stale world before prepare while holding the writer lock", async () => {
  const value = await fixture("preflight-lock");
  let releasePreflight;
  const preflightPaused = new Promise((resolve) => { releasePreflight = resolve; });
  let preflightEntered;
  const preflightStarted = new Promise((resolve) => { preflightEntered = resolve; });
  const first = value.transactions.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Stale Neara") },
  ], {
    operationId: "preflight-first", worldId: "otto",
    /** Holds the stale-world decision open so a later writer proves lock ownership. */
    async preflight() {
      preflightEntered();
      await preflightPaused;
      return { status: 409, conflict: true, code: "world-race", retryable: false, error: "map world changed while the gesture was preparing" };
    },
  });
  await preflightStarted;
  let secondFinished = false;
  const second = value.transactions.saveMany([
    { area: "neara/delivery", baseHash: null, canvas: scene("Fresh Delivery") },
  ], { operationId: "preflight-second", worldId: "otto" }).then((result) => { secondFinished = true; return result; });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(secondFinished, false, "a later writer cannot pass the stale-world preflight boundary");
  releasePreflight();
  const [rejected, saved] = await Promise.all([first, second]);
  assert.deepEqual({ status: rejected.status, code: rejected.code, retryable: rejected.retryable }, { status: 409, code: "world-race", retryable: false });
  assert.equal(rejected.operationId, "preflight-first");
  assert.deepEqual((await value.repository.read("neara")).scene.elements, [], "the stale gesture never reaches preparation");
  assert.equal(saved.committed, true);
  assert.equal((await value.repository.read("neara/delivery")).scene.elements[0].text, "Fresh Delivery");
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

  const restartedAgain = createAreaMapTransactionRepository({
    root: value.root, repository: value.repository, vault: value.vault, runGit,
    transactionRoot: value.transactionRoot,
    /** Keeps expected transaction failures quiet in tests. */
    reportError() {},
  });
  await assert.rejects(restartedAgain.waitForReadable(), (error) => error.status === 503 && error.recoveryRequired?.reason.includes("unrelated bytes"));
  assert.deepEqual((await restartedAgain.read("neara")).scene.elements, [], "a second restart still serves the last complete Git snapshot");
  const blocked = await restartedAgain.saveMany([
    { area: "neara", baseHash: null, canvas: scene("Later") },
  ], { operationId: "blocked-after-second-restart", worldId: "otto" });
  assert.equal(blocked.status, 503, "a second restart cannot resume map writes around durable recovery evidence");
});

test("startup removes a stale ownerless map lock", async () => {
  const value = await fixture("ownerless-lock");
  const lock = path.join(value.transactionRoot, ".vault-map.lock");
  await mkdir(lock, { recursive: true });
  const stale = new Date(Date.now() - 20_000);
  await utimes(lock, stale, stale);

  await value.transactions.recover();

  await assert.rejects(access(lock), { code: "ENOENT" });
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
