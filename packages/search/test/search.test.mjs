import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { indexRepo, searchRepo, skeleton, status, testsFor } from "../dist/sdk/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("indexes and searches a TypeScript fixture", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-ts-"));
  const repo = await copyFixture("typescript");

  const indexed = await indexRepo({ repo, force: true });
  assert.ok(indexed.files >= 2);
  assert.ok(indexed.symbols >= 3);

  const results = await searchRepo("format greeting", { repo });
  assert.equal(results.implementationSymbols[0].qualifiedName, "formatGreeting");

  const outline = await skeleton("src/math.ts", { repo });
  assert.equal(outline.path, "src/math.ts");
  assert.ok(outline.rows.some((row) => row.qualifiedName === "Greeter.greet"));
});

test("links likely Dart tests by imports", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-dart-"));
  const repo = await copyFixture("dart");

  const indexed = await indexRepo({ repo, force: true, languages: ["dart"] });
  assert.ok(indexed.files >= 2);

  const linked = await testsFor("lib/calc.dart", { repo, languages: ["dart"] });
  assert.equal(linked.rows[0].path, "test/calc_test.dart");

  const state = await status({ repo });
  assert.equal(state.languages[0].language, "dart");
});

async function copyFixture(name) {
  const source = path.join(here, "fixtures", name);
  const target = await mkdtemp(path.join(tmpdir(), `tangent-search-${name}-repo-`));
  await cp(source, target, { recursive: true });
  return target;
}
