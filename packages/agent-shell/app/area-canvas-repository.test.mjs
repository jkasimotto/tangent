import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";

test("creates, stages, commits, and updates one canonical path atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-canvas-"));
  const git = []; const commits = [];
  const repository = createAreaCanvasRepository({ root, async runGit(args) { git.push(args); }, async commit(...args) { commits.push(args); return { committed: true, error: null }; } });
  const canvas = { nodes: [{ id: "a", type: "text", text: "A", x: 1, y: 2, width: 3, height: 4 }], edges: [] };
  const created = await repository.save("otto/tangent", canvas, { baseHash: null, operationId: "op-1" });
  assert.equal(created.file, "otto/tangent/tangent.canvas");
  assert.deepEqual(git[0].slice(-3), ["add", "--", created.file]);
  assert.deepEqual(commits[0][0], [created.file]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, created.file), "utf8")), canvas);
  assert.equal((await repository.save("otto/tangent", canvas, { baseHash: null })).idempotent, true);
  assert.equal((await repository.save("otto/tangent", { nodes: [], edges: [] }, { baseHash: "stale" })).status, 409);
});
