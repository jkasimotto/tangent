import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readBuildIdentity } from "../dist/index.js";

/** Builds a temp shell root with an assets/ dir holding the given files. */
async function makeRoot(files) {
  const root = path.join(tmpdir(), `tangent-build-id-${process.hrtime.bigint()}`);
  await mkdir(path.join(root, "assets"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(root, "assets", name), body);
  }
  return root;
}

test("reports a stable id and the newest asset mtime", async () => {
  const root = await makeRoot({ "index.js": "a", "index.css": "b" });
  try {
    const stamp = new Date("2026-06-25T14:32:00.000Z");
    await utimes(path.join(root, "assets", "index.js"), stamp, stamp);
    await utimes(path.join(root, "assets", "index.css"), new Date("2026-06-25T10:00:00.000Z"), new Date("2026-06-25T10:00:00.000Z"));
    const first = readBuildIdentity(root);
    const second = readBuildIdentity(root);
    assert.equal(first.buildId, second.buildId, "id is stable when nothing changed");
    assert.equal(first.builtAt, stamp.toISOString(), "builtAt is the newest asset mtime");
    assert.match(first.buildId, /^[0-9a-f]{12}$/, "id is a short hex token");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("id changes when an asset's bytes change", async () => {
  const root = await makeRoot({ "index.js": "a" });
  try {
    const before = readBuildIdentity(root);
    await writeFile(path.join(root, "assets", "index.js"), "a-changed");
    const after = readBuildIdentity(root);
    assert.notEqual(before.buildId, after.buildId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("throws when the assets directory is missing", async () => {
  const root = path.join(tmpdir(), `tangent-build-id-empty-${process.hrtime.bigint()}`);
  await mkdir(root, { recursive: true });
  try {
    assert.throws(() => readBuildIdentity(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
