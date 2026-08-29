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

test("first read converts a legacy canvas and removes it in the same scoped commit", async () => {
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
  assert.deepEqual(git[0].slice(-4), ["add", "--", "tangent/tangent.excalidraw", "tangent/tangent.canvas"]);
  assert.deepEqual(commits[0][0], ["tangent/tangent.excalidraw", "tangent/tangent.canvas"]);
});
