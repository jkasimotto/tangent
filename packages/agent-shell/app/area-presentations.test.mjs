import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dismissAreaDocument, markAreaDocumentOpened, presentAreaDocuments, projectAreaPresentations, pruneMissingAreaPresentations, readAreaPresentations, removeAreaPresentations, withdrawAreaDocument } from "./area-presentations.mjs";

/** Builds one Document row for the test. */
const doc = (file, hash) => ({ file, hash, title: path.basename(file, ".md") });

test("Area Document lifecycle preserves opening and fences dismissal by content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-presentations-"));
  const area = "otto/tangent";
  let result = await presentAreaDocuments(root, area, [doc(`${area}/one.md`, "a")], { session: "brain", role: "brain" }, "read", "2026-01-01T00:00:00Z");
  assert.equal(result.changed, true);
  result = await presentAreaDocuments(root, area, [doc(`${area}/one.md`, "a")]);
  assert.equal(result.changed, false);
  await markAreaDocumentOpened(root, area, `${area}/one.md`, "a");
  assert.equal(projectAreaPresentations(await readAreaPresentations(root, area)).length, 1, "opening keeps the row");
  await dismissAreaDocument(root, area, `${area}/one.md`);
  assert.equal(projectAreaPresentations(await readAreaPresentations(root, area)).length, 0);
  assert.equal((await presentAreaDocuments(root, area, [doc(`${area}/one.md`, "a")])).changed, false, "same content stays dismissed");
  await presentAreaDocuments(root, area, [doc(`${area}/one.md`, "b")]);
  assert.equal(projectAreaPresentations(await readAreaPresentations(root, area)).length, 1, "changed content returns");
  await withdrawAreaDocument(root, area, `${area}/one.md`);
  assert.equal((await presentAreaDocuments(root, area, [doc(`${area}/one.md`, "b")])).changed, true, "withdrawal permits same content to return");
});

test("Area mutations serialize, project newest first, prune, and remove", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-presentations-"));
  const area = "otto/tangent";
  await Promise.all([
    presentAreaDocuments(root, area, [doc(`${area}/one.md`, "a")], {}, "", "2026-01-01T00:00:00Z"),
    presentAreaDocuments(root, area, [doc(`${area}/two.md`, "b")], {}, "", "2026-01-02T00:00:00Z"),
  ]);
  let record = await readAreaPresentations(root, area);
  assert.deepEqual(projectAreaPresentations(record).map((item) => item.file), [`${area}/two.md`, `${area}/one.md`]);
  await pruneMissingAreaPresentations(root, record, async (item) => item.file.endsWith("two.md"));
  record = await readAreaPresentations(root, area);
  assert.deepEqual(record.items.map((item) => item.file), [`${area}/two.md`]);
  await removeAreaPresentations(root, "otto", true);
  assert.equal((await readAreaPresentations(root, area)).items.length, 0);
});
