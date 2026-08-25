import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRebuildOperations } from "./rebuild-operation.mjs";
import { writeJsonObject } from "./json-store.mjs";

test("a rebuild captures commits, rejects duplicates, and finishes on the new boot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-rebuild-"));
  const file = path.join(root, "rebuild.json");
  const launches = [];
  /** Supplies the commit range captured by the operation. */
  const revisions = async () => ({
    deployedCommit: "aaaa",
    currentCommit: "bbbb",
    commits: [{ hash: "bbbb", shortHash: "bbb", subject: "Visible progress", author: "Julian" }],
  });
  const oldServer = createRebuildOperations({
    file, root, log: path.join(root, "build.log"), bootId: "boot-1", serverPid: 4321, revisions,
    /** Records the detached launch without starting a process. */
    launch: (value) => launches.push(value),
  });

  const started = await oldServer.start();
  assert.equal(started.status, 202);
  assert.equal(started.value.operation.phase, "building");
  assert.equal(started.value.operation.targetCommit, "bbbb");
  assert.equal(launches.length, 1);
  assert.equal(launches[0].serverPid, 4321);
  assert.equal((await oldServer.start()).status, 409);

  await writeJsonObject(file, { ...started.value.operation, phase: "reconnecting", updatedAt: Date.now() });
  const newServer = createRebuildOperations({
    file, root, log: path.join(root, "build.log"), bootId: "boot-2", revisions,
    /** A completed operation does not launch another worker. */
    launch: () => {},
  });
  const completed = await newServer.current();
  assert.equal(completed.phase, "succeeded");
  assert.equal(completed.newBoot, "boot-2");
});

test("a failed rebuild stays available for diagnosis and retry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-rebuild-failed-"));
  const file = path.join(root, "rebuild.json");
  const failed = { id: "failed", phase: "failed", error: "build error", updatedAt: Date.now() };
  await writeJsonObject(file, failed);
  const operations = createRebuildOperations({
    file,
    root,
    log: path.join(root, "build.log"),
    bootId: "boot-1",
    /** Supplies a retry target. */
    revisions: async () => ({ deployedCommit: "a", currentCommit: "b", commits: [] }),
    /** Avoids a real detached process in this unit test. */
    launch: () => {},
  });
  assert.deepEqual(await operations.current(), failed);
  assert.equal((await operations.start()).status, 202);
});
