import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonObjectResult, writeJsonObject } from "./json-store.mjs";

test("concurrent writes use different temporary files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-json-store-"));
  const file = path.join(root, "brain.json");
  const originalNow = Date.now;
  Date.now = () => 1_777_777_777_777;
  try {
    await Promise.all([
      writeJsonObject(file, { writer: "first" }),
      writeJsonObject(file, { writer: "second" }),
    ]);
  } finally {
    Date.now = originalNow;
  }
  assert.match(JSON.parse(await readFile(file, "utf8")).writer, /^(first|second)$/);
});

test("a malformed object is different from a missing object", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-json-read-"));
  const missing = await readJsonObjectResult(path.join(root, "missing.json"));
  const file = path.join(root, "brain.json");
  await writeJsonObject(file, { valid: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, "{broken}\n", "utf8");
  const malformed = await readJsonObjectResult(file);
  assert.equal(missing.state, "missing");
  assert.equal(malformed.state, "malformed");
  assert.match(malformed.error, /JSON/);
});
