import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { createAreaMapTransactionRepository } from "./area-map-transaction-repository.mjs";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { moveArea } from "./area-operations.mjs";
import { parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { createVaultRepository } from "./vault-repository.mjs";
import { createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";

const execFileAsync = promisify(execFile);

/** Runs one Git command in a fixture vault. */
async function runGit(args, options = {}) { return execFileAsync("git", args, { encoding: "utf8", ...options }); }

/** Suppresses expected transaction diagnostics in isolated fixtures. */
function ignoreError() {}

/** Writes one canonical Area note. */
async function writeNote(root, area) {
  await mkdir(path.join(root, area), { recursive: true });
  await writeFile(path.join(root, area, `${path.posix.basename(area)}.md`), `# ${path.posix.basename(area)}\n`);
}

/** Writes one canonical Area map. */
async function writeScene(root, area, scene) {
  await writeFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), serializeAreaCanvas(scene));
}

/** Creates one real Git vault with a cross-referenced Area subtree. */
async function fixture(name, fault = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), `area-map-move-transaction-${name}-`));
  await runGit(["-C", root, "init", "--quiet"]);
  await runGit(["-C", root, "config", "user.email", "test@tangent.local"]);
  await runGit(["-C", root, "config", "user.name", "Tangent Test"]);
  for (const area of ["neara", "neara/source", "neara/source/child", "otto", "other"]) await writeNote(root, area);
  const source = createEmptyScene();
  const sourceBlock = createTextElement({ id: "source-id", text: "source", x: 10, y: 20 });
  sourceBlock.customData = {
    tangent: { kind: "document", ref: "neara/source/child/note.md#part" },
    endpoint: { owner: "neara/source/child", sourceId: "child-id" },
  };
  source.elements.push(sourceBlock);
  await writeScene(root, "neara/source", source);
  const child = createEmptyScene(); child.elements.push(createTextElement({ id: "child-id", text: "child", x: 30, y: 40 }));
  await writeScene(root, "neara/source/child", child);
  const oldParent = createEmptyScene(); oldParent.elements.push(...createRegionElements({ id: "old-region", ref: "neara/source/source.md", title: "Source" }));
  await writeScene(root, "neara", oldParent);
  const outside = createEmptyScene();
  const outsideBlock = createTextElement({ id: "outside", text: "outside" });
  outsideBlock.customData = { endpoint: { owner: "neara/source", sourceId: "source-id" } };
  outside.elements.push(outsideBlock);
  await writeScene(root, "otto", outside);
  await writeScene(root, "other", createEmptyScene());
  await writeFile(path.join(root, "unrelated-staged.md"), "base staged\n");
  await writeFile(path.join(root, "unrelated-worktree.md"), "base worktree\n");
  await runGit(["-C", root, "add", "."]);
  await runGit(["-C", root, "commit", "--quiet", "-m", "base"]);
  const transactionRoot = path.join(root, ".test-state", "transactions");
  const repository = createAreaCanvasRepository({
    root, runGit, transactionRoot: path.join(root, ".legacy-state"),
    /** This fixture commits only through the exact transaction authority. */
    async commit() { throw new Error("unexpected legacy commit"); },
  });
  const vault = createVaultRepository({ root, runGit });
  const transactions = createAreaMapTransactionRepository({ root, repository, vault, runGit, transactionRoot, fault, reportError: ignoreError });
  /** Captures one read-only Git result. */
  const runGitCapture = async (args) => String((await runGit(["-C", root, ...args])).stdout);
  return { root, repository, runGitCapture, transactionRoot, transactions, vault };
}

/** Runs the fixture's journaled Area move. */
async function move(value, operationId = "move-source") {
  return moveArea({
    treesRoot: value.root, area: "neara/source", parent: "otto", name: "Renamed",
    runGitCapture: value.runGitCapture, transaction: value.transactions, operationId,
  });
}

/** Reads one canonical map after the move. */
async function readScene(root, area) {
  const parsed = parseAreaCanvas(await readFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), "utf8"));
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

/** Proves that every path and semantic owner is in the complete new state. */
async function assertMoved(value) {
  await assert.rejects(access(path.join(value.root, "neara", "source")), { code: "ENOENT" });
  await access(path.join(value.root, "otto", "renamed", "renamed.md"));
  const movedSource = await readScene(value.root, "otto/renamed");
  assert.equal(movedSource.elements[0].id, "source-id");
  assert.equal(movedSource.elements[0].customData.tangent.ref, "otto/renamed/child/note.md#part");
  assert.equal(movedSource.elements[0].customData.endpoint.owner, "otto/renamed/child");
  assert.equal((await readScene(value.root, "otto/renamed/child")).elements[0].id, "child-id");
  assert.equal((await readScene(value.root, "otto")).elements[0].customData.endpoint.owner, "otto/renamed");
  assert.equal((await readScene(value.root, "neara")).elements[0].customData.tangent.ref, "otto/renamed/renamed.md");
  await assert.rejects(runGit(["-C", value.root, "cat-file", "-e", "HEAD:neara/source/source.md"]));
  await runGit(["-C", value.root, "cat-file", "-e", "HEAD:otto/renamed/renamed.md"]);
}

/** Reads the only move manifest in one fixture. */
async function manifest(transactionRoot) {
  const worlds = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const operations = await readdir(path.join(transactionRoot, worlds[0].name));
  return JSON.parse(await readFile(path.join(transactionRoot, worlds[0].name, operations[0], "manifest.json"), "utf8"));
}

test("one exact Area move preserves unrelated staged and worktree edits", async () => {
  const value = await fixture("exact");
  await writeFile(path.join(value.root, "unrelated-staged.md"), "user staged\n");
  await runGit(["-C", value.root, "add", "unrelated-staged.md"]);
  await writeFile(path.join(value.root, "unrelated-worktree.md"), "user worktree\n");
  const before = String((await runGit(["-C", value.root, "rev-parse", "HEAD"])).stdout).trim();
  const moved = await move(value);
  assert.equal(moved.committed, true);
  await assertMoved(value);
  assert.equal(String((await runGit(["-C", value.root, "rev-list", "--count", `${before}..HEAD`])).stdout).trim(), "1");
  assert.equal(await readFile(path.join(value.root, "unrelated-staged.md"), "utf8"), "user staged\n");
  assert.equal(await readFile(path.join(value.root, "unrelated-worktree.md"), "utf8"), "user worktree\n");
  assert.match(String((await runGit(["-C", value.root, "diff", "--cached", "--name-only"])).stdout), /unrelated-staged\.md/);
  assert.match(String((await runGit(["-C", value.root, "diff", "--name-only"])).stdout), /unrelated-worktree\.md/);
  const repeated = await move(value);
  assert.equal(repeated.idempotent, true);
  assert.equal(String((await runGit(["-C", value.root, "rev-list", "--count", `${before}..HEAD`])).stdout).trim(), "1");
});

for (const phase of ["prepared", "ref-installed", "index-installed", "target-installed:0", "directory-cleaned:0", "verified", "result-recorded"]) {
  test(`Area move recovery completes the ${phase} crash without partial owners`, async () => {
    let crashed = false;
    const value = await fixture(phase.replaceAll(":", "-"), (current) => {
      if (!crashed && current === phase) { crashed = true; throw Object.assign(new Error(`crash at ${phase}`), { simulatedCrash: true }); }
    });
    await assert.rejects(move(value, `move-${phase}`), /crash at/);
    const restarted = createAreaMapTransactionRepository({
      root: value.root, repository: value.repository, vault: value.vault, runGit,
      transactionRoot: value.transactionRoot, reportError: ignoreError,
    });
    await restarted.waitForReadable();
    await assertMoved(value);
    assert.equal((await manifest(value.transactionRoot)).state, "committed");
  });
}

test("a map save waits for an exact Area move and commits after its complete install", async () => {
  let releaseMove;
  const paused = new Promise((resolve) => { releaseMove = resolve; });
  let reachedPrepare;
  const prepared = new Promise((resolve) => { reachedPrepare = resolve; });
  const value = await fixture("concurrent", async (phase, detail) => {
    if (phase === "prepared" && detail.operationId === "move-concurrent") { reachedPrepare(); await paused; }
  });
  const other = await value.repository.read("other");
  const moving = move(value, "move-concurrent");
  await prepared;
  let saveDone = false;
  const scene = createEmptyScene(); scene.elements.push(createTextElement({ id: "later", text: "later", x: 10, y: 20 }));
  const saving = value.transactions.saveMany([{ area: "other", baseHash: other.hash, canvas: scene }], { operationId: "save-concurrent", worldId: "world", area: "other" }).then((result) => { saveDone = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(saveDone, false);
  releaseMove();
  const [moved, saved] = await Promise.all([moving, saving]);
  assert.equal(moved.committed, true);
  assert.equal(saved.committed, true);
  await assertMoved(value);
  assert.equal((await value.repository.read("other")).scene.elements[0].text, "later");
});

test("a complete world read cannot observe the Area directory between move targets", async () => {
  let releaseInstall;
  const paused = new Promise((resolve) => { releaseInstall = resolve; });
  let reachedRef;
  const refInstalled = new Promise((resolve) => { reachedRef = resolve; });
  const value = await fixture("reader", async (phase, detail) => {
    if (phase === "ref-installed" && detail.operationId === "move-reader") { reachedRef(); await paused; }
  });
  /** Lists Area directories from the current worktree. */
  async function listAreas() {
    const result = [];
    /** Walks one fixture Area directory. */
    async function walk(directory, relative = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const area = relative ? `${relative}/${entry.name}` : entry.name;
        result.push(area); await walk(path.join(directory, entry.name), area);
      }
    }
    await walk(value.root); return result.filter((area) => !area.startsWith(".test-state"));
  }
  const index = createAreaMapWorldIndex({ root: value.root, repository: value.transactions, listAreas });
  const moving = move(value, "move-reader");
  await refInstalled;
  let readDone = false;
  const reading = index.snapshot(null).then((world) => { readDone = true; return world; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(readDone, false);
  releaseInstall();
  const [, world] = await Promise.all([moving, reading]);
  assert.equal(world.areas.some((entry) => entry.key === "neara/source"), false);
  assert.equal(world.areas.some((entry) => entry.key === "otto/renamed"), true);
});

test("an outer world lease can finish nested shard reads while an Area move waits", async () => {
  let reachedPrepare;
  const prepared = new Promise((resolve) => { reachedPrepare = resolve; });
  const value = await fixture("nested-reader", (phase, detail) => {
    if (phase === "prepared" && detail.operationId === "move-nested-reader") reachedPrepare();
  });
  let releaseOuter;
  const held = new Promise((resolve) => { releaseOuter = resolve; });
  let enteredOuter;
  const entered = new Promise((resolve) => { enteredOuter = resolve; });
  const reading = value.transactions.withRead(async () => {
    enteredOuter();
    await held;
    return value.transactions.read("other");
  });
  await entered;
  const moving = move(value, "move-nested-reader");
  await prepared;
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseOuter();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("nested map read deadlocked with the waiting Area move")), 5_000); });
  const [shard, moved] = await Promise.race([Promise.all([reading, moving]), timeout]).finally(() => clearTimeout(timer));
  assert.equal(shard.area, "other");
  assert.equal(moved.committed, true);
  await assertMoved(value);
});
