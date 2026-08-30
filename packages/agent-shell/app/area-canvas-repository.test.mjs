import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
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
