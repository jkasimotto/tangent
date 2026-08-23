import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CONTINUATION_SCHEMA,
  continuationPath,
  newContinuationRecord,
  readAllContinuations,
  readContinuation,
  writeContinuation
} from "./continuation-record.mjs";

test("write and read round trip through the area path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "continuations-"));
  const record = newContinuationRecord({
    goal: "otto/tangent/goal-x.md",
    area: "otto/tangent",
    slug: "x",
    session: "tangent-x",
    now: "2026-08-23T10:00:00.000Z"
  });
  assert.equal(record.schema, CONTINUATION_SCHEMA);
  assert.deepEqual(record.continuations, []);
  assert.deepEqual(record.contextReminders, {});

  const written = await writeContinuation(root, record);
  assert.equal(written, record);
  assert.notEqual(record.updatedAt, "2026-08-23T10:00:00.000Z");
  assert.equal(record.createdAt, "2026-08-23T10:00:00.000Z");

  const file = continuationPath(root, "otto/tangent", "x");
  assert.equal(file, path.join(root, "otto/tangent/x.json"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), record);
  assert.deepEqual(await readContinuation(root, "otto/tangent", "x"), record);

  const leftovers = (await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "atomic write leaves no tmp file");
});

test("readContinuation returns null for a missing or unparsable file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "continuations-"));
  assert.equal(await readContinuation(root, "otto/tangent", "nope"), null);
  await mkdir(path.join(root, "otto/tangent"), { recursive: true });
  await writeFile(continuationPath(root, "otto/tangent", "bad"), "{");
  assert.equal(await readContinuation(root, "otto/tangent", "bad"), null);
});

test("readAllContinuations walks every area, skips junk and other schemas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "continuations-"));
  await writeContinuation(root, newContinuationRecord({ goal: "a.md", area: "otto/tangent", slug: "one", session: "s1" }));
  await writeContinuation(root, newContinuationRecord({ goal: "b.md", area: "neara/pgande", slug: "two", session: "s2" }));
  await writeFile(path.join(root, "otto/tangent/notes.txt"), "not json");
  await writeFile(path.join(root, "otto/tangent/broken.json"), "{ nope");
  await writeFile(path.join(root, "otto/tangent/other.json"), JSON.stringify({ schema: "something-else.v1" }));
  const all = await readAllContinuations(root);
  assert.deepEqual(all.map((r) => `${r.area}/${r.slug}`).sort(), ["neara/pgande/two", "otto/tangent/one"]);
});

test("readAllContinuations is empty when the root is missing", async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), "continuations-")), "missing");
  assert.deepEqual(await readAllContinuations(root), []);
});

test("writeContinuation overwrites atomically, leaving no tmp file behind", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "continuations-"));
  const record = newContinuationRecord({ goal: "a.md", area: "otto/tangent", slug: "x", session: "s1" });
  await writeContinuation(root, record);
  record.continuations.push({ session: "s1", next: "s1--g2", facts: "did part 1", at: "2026-08-23T11:00:00.000Z", fill: { usedTokens: 310_000, windowTokens: 1_000_000 } });
  record.session = "s1--g2";
  await writeContinuation(root, record);
  const reread = await readContinuation(root, "otto/tangent", "x");
  assert.equal(reread.session, "s1--g2");
  assert.equal(reread.continuations.length, 1);
  const leftovers = (await readdir(path.join(root, "otto/tangent"))).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});
