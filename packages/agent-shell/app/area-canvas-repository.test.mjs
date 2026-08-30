import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { canvasHash, serializeAreaCanvas } from "./area-canvas.mjs";
import { createEmptyScene, createTextElement } from "./public/area-board-core.js";

test("creates, stages, commits, and conflict-checks one canonical Excalidraw path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-"));
  const git = []; const commits = [];
  const repository = createAreaCanvasRepository({
    root,
    /** Records repository staging without invoking Git. */
    async runGit(args) { git.push(args); },
    /** Records scoped commits without writing a test repository. */
    async commit(...args) { commits.push(args); return { committed: true, error: null }; },
  });
  const scene = createEmptyScene(); scene.elements.push(createTextElement({ id: "a", text: "A", x: 1, y: 2, width: 30, height: 40 }));
  const created = await repository.save("otto/tangent", scene, { baseHash: null, operationId: "op-1" });
  assert.equal(created.file, "otto/tangent/tangent.excalidraw");
  assert.deepEqual(git[0].slice(-3), ["add", "--", created.file]);
  assert.deepEqual(commits[0][0], [created.file]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, created.file), "utf8")), scene);
  assert.equal((await repository.save("otto/tangent", scene, { baseHash: null })).idempotent, true);
  assert.equal((await repository.save("otto/tangent", createEmptyScene(), { baseHash: "stale" })).status, 409);
});

test("legacy reads write nothing and the first authored save converts atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-migrate-"));
  await mkdir(path.join(root, "tangent"));
  await writeFile(path.join(root, "tangent", "tangent.canvas"), JSON.stringify({ nodes: [{ id: "ink", type: "text", text: "A", x: 1, y: 2, width: 30, height: 40 }], edges: [] }));
  const git = []; const commits = [];
  const repository = createAreaCanvasRepository({
    root,
    /** Records migration staging without invoking Git. */
    async runGit(args) { git.push(args); },
    /** Records the migration commit without writing a test repository. */
    async commit(...args) { commits.push(args); return { committed: true }; },
  });
  const result = await repository.read("tangent");
  assert.equal(result.migrated, true);
  assert.equal(result.file, "tangent/tangent.excalidraw");
  assert.equal(result.canvas.elements[0].type, "text");
  assert.deepEqual(git, []); assert.deepEqual(commits, []);
  await assert.rejects(readFile(path.join(root, "tangent", "tangent.excalidraw"), "utf8"), { code: "ENOENT" });
  const changed = structuredClone(result.scene); changed.elements[0].x = 40;
  const saved = await repository.save("tangent", changed, { baseHash: null });
  assert.equal(saved.committed, true);
  assert.deepEqual(git[0].slice(-4), ["add", "--", "tangent/tangent.excalidraw", "tangent/tangent.canvas"]);
  assert.deepEqual(commits[0][0], ["tangent/tangent.excalidraw", "tangent/tangent.canvas"]);
  await assert.rejects(readFile(path.join(root, "tangent", "tangent.canvas"), "utf8"), { code: "ENOENT" });
});

test("an external Area move reads its one old Excalidraw name and migrates on the next authored save", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-area-move-"));
  const directory = path.join(root, "otto", "renamed");
  await mkdir(directory, { recursive: true });
  const scene = createEmptyScene(); scene.elements.push(createTextElement({ id: "kept", text: "Kept", x: 14, y: 28 }));
  const oldFile = path.join(directory, "former-name.excalidraw");
  const canonicalFile = path.join(directory, "renamed.excalidraw");
  await writeFile(oldFile, serializeAreaCanvas(scene));
  const git = []; const commits = [];
  const repository = createAreaCanvasRepository({
    root,
    /** Records exact migration staging without invoking Git. */
    async runGit(args) { git.push(args); },
    /** Records the scoped migration commit without writing a test repository. */
    async commit(...args) { commits.push(args); return { committed: true }; },
  });

  const opened = await repository.read("otto/renamed");

  assert.equal(opened.migrated, true);
  assert.equal(opened.file, "otto/renamed/renamed.excalidraw");
  assert.equal(opened.hash, null, "the absent canonical file keeps its null optimistic hash");
  assert.equal(opened.legacy.file, "otto/renamed/former-name.excalidraw");
  assert.deepEqual(opened.scene, scene);
  assert.deepEqual(git, []); assert.deepEqual(commits, []);
  assert.deepEqual(JSON.parse(await readFile(oldFile, "utf8")), scene);
  await assert.rejects(readFile(canonicalFile, "utf8"), { code: "ENOENT" });

  const saved = await repository.save("otto/renamed", opened.scene, { baseHash: opened.hash });

  assert.equal(saved.committed, true);
  assert.deepEqual(git[0].slice(-4), ["add", "--", "otto/renamed/renamed.excalidraw", "otto/renamed/former-name.excalidraw"]);
  assert.deepEqual(commits[0][0], ["otto/renamed/renamed.excalidraw", "otto/renamed/former-name.excalidraw"]);
  assert.deepEqual(JSON.parse(await readFile(canonicalFile, "utf8")), scene);
  await assert.rejects(readFile(oldFile, "utf8"), { code: "ENOENT" });
});

test("rolls a file back when its vault commit fails so Retry has a trustworthy hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-rollback-"));
  let commits = 0;
  const repository = createAreaCanvasRepository({ root,
    /** Avoids invoking Git. */
    async runGit() {},
    /** Fails the update commit. */
    async commit() { commits += 1; return { committed: commits === 1, error: commits === 1 ? null : "hook failed" }; },
    /** Keeps the expected failure quiet. */
    reportError() {},
  });
  const before = createEmptyScene(); before.elements.push(createTextElement({ id: "before", text: "Before" }));
  const created = await repository.save("otto", before, { baseHash: null });
  const after = createEmptyScene(); after.elements.push(createTextElement({ id: "after", text: "After" }));
  const failed = await repository.save("otto", after, { baseHash: created.hash });
  assert.equal(failed.status, 503);
  assert.equal(failed.hash, created.hash);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "otto/otto.excalidraw"), "utf8")), before);
});

test("commits a multi-file gesture once and rolls every file back together", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-batch-"));
  const commits = [];
  const repository = createAreaCanvasRepository({ root,
    /** Avoids invoking Git for already tracked fixture files. */
    async runGit() {},
    /** Records one batch commit, then rejects the next gesture. */
    async commit(paths, message) { commits.push({ paths, message }); return { committed: commits.length < 2, error: commits.length < 2 ? null : "hook failed" }; },
    /** Keeps the expected failure quiet. */
    reportError() {},
  });
  const first = createEmptyScene(); first.elements.push(createTextElement({ id: "first", text: "First" }));
  const second = createEmptyScene(); second.elements.push(createTextElement({ id: "second", text: "Second" }));
  const created = await repository.saveMany([{ area: "neara", baseHash: null, canvas: first }, { area: "neara/delivery", baseHash: null, canvas: second }], { area: "neara/delivery" });
  assert.equal(created.committed, true); assert.equal(commits[0].paths.length, 2);
  const nextFirst = structuredClone(first); nextFirst.elements[0].x = 100;
  const nextSecond = structuredClone(second); nextSecond.elements[0].x = 200;
  const failed = await repository.saveMany([{ area: "neara", baseHash: created.hashes.neara, canvas: nextFirst }, { area: "neara/delivery", baseHash: created.hashes["neara/delivery"], canvas: nextSecond, reason: "standards extent" }], { area: "neara/delivery" });
  assert.equal(failed.status, 503);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "neara/neara.excalidraw"), "utf8")), first);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "neara/delivery/delivery.excalidraw"), "utf8")), second);
  assert.match(commits[1].message, /standards extent/);
});

test("records idempotent operation results and rejects operation ID reuse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-operation-"));
  const transactions = path.join(root, "state"); let commits = 0;
  const repository = createAreaCanvasRepository({ root, transactionRoot: transactions,
    /** Avoids invoking Git. */
    async runGit() {},
    /** Counts durable map commits. */
    async commit() { commits += 1; return { committed: true }; },
  });
  const scene = createEmptyScene(); scene.elements.push(createTextElement({ id: "one", text: "One" }));
  const first = await repository.save("otto", scene, { operationId: "same-operation" });
  const repeated = await repository.save("otto", scene, { operationId: "same-operation" });
  assert.equal(first.committed, true); assert.equal(repeated.idempotent, true); assert.equal(commits, 1);
  const changed = structuredClone(scene); changed.elements[0].x = 20;
  const rejected = await repository.save("otto", changed, { baseHash: first.hash, operationId: "same-operation" });
  assert.equal(rejected.status, 409);
});

test("restores every old shard before reads after an interrupted prepared transaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-recovery-"));
  const transactions = path.join(root, "state");
  await mkdir(path.join(root, "neara"), { recursive: true });
  const oldScene = createEmptyScene(); oldScene.elements.push(createTextElement({ id: "old", text: "Old" }));
  const newScene = createEmptyScene(); newScene.elements.push(createTextElement({ id: "new", text: "New" }));
  const file = path.join(root, "neara/neara.excalidraw");
  await writeFile(file, JSON.stringify(newScene));
  const operation = path.join(transactions, "interrupted"); await mkdir(operation, { recursive: true });
  await writeFile(path.join(operation, "manifest.json"), JSON.stringify({ schema: "area-map-transaction.v1", operationId: "crash", digest: "x", state: "prepared", targets: [{ area: "neara", file: "neara/neara.excalidraw", oldText: JSON.stringify(oldScene) }] }));
  const repository = createAreaCanvasRepository({ root, transactionRoot: transactions,
    /** Avoids invoking Git. */
    async runGit() {},
    /** Supplies the repository contract. */
    async commit() { return { committed: true }; },
  });
  assert.deepEqual((await repository.read("neara")).scene, oldScene);
  const manifest = JSON.parse(await readFile(path.join(operation, "manifest.json"), "utf8"));
  assert.equal(manifest.state, "recovered");
});

test("finishes every new shard when Git committed before result recording", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-finish-"));
  const transactions = path.join(root, "state");
  await mkdir(path.join(root, "neara"), { recursive: true });
  const oldScene = createEmptyScene(); oldScene.elements.push(createTextElement({ id: "old", text: "Old" }));
  const newScene = createEmptyScene(); newScene.elements.push(createTextElement({ id: "new", text: "New" }));
  const oldText = JSON.stringify(oldScene); const newText = JSON.stringify(newScene);
  const file = path.join(root, "neara/neara.excalidraw"); await writeFile(file, oldText);
  const operation = path.join(transactions, "committed"); await mkdir(operation, { recursive: true });
  await writeFile(path.join(operation, "manifest.json"), JSON.stringify({ schema: "area-map-transaction.v1", operationId: "crash", digest: "x", state: "prepared", targets: [{ area: "neara", file: "neara/neara.excalidraw", oldText, newText, newHash: canvasHash(newText) }] }));
  const repository = createAreaCanvasRepository({ root, transactionRoot: transactions,
    /** Returns the new blob as if the commit succeeded before the crash. */
    async runGit() { return { stdout: newText }; },
    /** Supplies the repository contract. */
    async commit() { return { committed: true }; },
  });
  assert.deepEqual((await repository.read("neara")).scene, newScene);
  const manifest = JSON.parse(await readFile(path.join(operation, "manifest.json"), "utf8"));
  assert.equal(manifest.recoveryOutcome, "finished-new");
});

test("unchanged shard reads reuse the content-addressed scene parse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-cache-"));
  await mkdir(path.join(root, "neara"), { recursive: true });
  const current = createEmptyScene(); current.elements.push(createTextElement({ id: "one", text: "One" }));
  await writeFile(path.join(root, "neara", "neara.excalidraw"), `${JSON.stringify(current, null, 2)}\n`);
  let parses = 0;
  const repository = createAreaCanvasRepository({
    root,
    /** Avoids invoking Git for a read-only cache test. */
    async runGit() {},
    /** Supplies the unused repository commit contract. */
    async commit() { return { committed: true }; },
    /** Counts canonical parses while keeping the real parser contract. */
    parseCanvas(text) { parses += 1; return JSON.parse(text) && { ok: true, errors: [], warnings: [], canvas: JSON.parse(text), scene: JSON.parse(text) }; },
  });

  await repository.read("neara");
  await repository.read("neara");

  assert.equal(parses, 1);
});
