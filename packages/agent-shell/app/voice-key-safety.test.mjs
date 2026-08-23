import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("voice keys never fall back to the focused session when an explicit target is missing", async () => {
  const source = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  const branch = source.match(/case "keys": \{([\s\S]*?)case "view":/m)?.[1] ?? "";
  assert.match(branch, /requested \? resolveSession\(requested, sessions\) : focused/);
  assert.match(branch, /if \(!target\)[\s\S]*pressed nothing/);
  assert.doesNotMatch(branch, /resolveSession\([^\n]+\) \?\? focused/);
});
