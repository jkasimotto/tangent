import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the server resolves the same Tangent CLI that the package installs", async () => {
  const source = await readFile(path.join(here, "server.mjs"), "utf8");
  const match = source.match(/path\.resolve\(here, "([^"]+dist\/cli\/index\.js)"\)/);
  assert.ok(match, "server.mjs must resolve the built CLI from its own directory");
  const manifest = JSON.parse(await readFile(path.join(here, "..", "..", "..", "package.json"), "utf8"));
  assert.equal(path.resolve(here, match[1]), path.resolve(here, "..", "..", "..", manifest.bin.tangent));
});
