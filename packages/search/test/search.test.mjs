import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { benchSearch, callees, callers, indexRepo, openPlan, searchRepo, skeleton, status, testsFor } from "../dist/sdk/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const engine of ["ts", "rust"]) {
  test(`${engine} engine indexes and searches a TypeScript fixture`, async () => {
    process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), `tangent-search-${engine}-ts-`));
    const repo = await copyFixture("typescript");

    const indexed = await indexRepo({ repo, force: true, engine });
    assert.ok(indexed.files >= 2);
    assert.ok(indexed.symbols >= 3);

    const results = await searchRepo("format greeting", { repo, engine });
    assert.equal(results.implementationSymbols[0].qualifiedName, "formatGreeting");

    const outline = await skeleton("src/math.ts", { repo, engine });
    assert.equal(outline.path, "src/math.ts");
    assert.ok(outline.rows.some((row) => row.qualifiedName === "Greeter.greet"));

    const incoming = await callers("formatGreeting", { repo, engine });
    assert.equal(incoming.root.qualifiedName, "formatGreeting");
    assert.ok(incoming.rows.some((row) => row.qualifiedName === "Greeter.greet"));

    const outgoing = await callees("Greeter.greet", { repo, engine });
    assert.equal(outgoing.root.qualifiedName, "Greeter.greet");
    assert.ok(outgoing.rows.some((row) => row.qualifiedName === "formatGreeting"));

    const plan = await openPlan("format greeting", { repo, engine });
    assert.ok(plan.paths.includes("src/math.ts"));
  });

  test(`${engine} engine links likely Dart tests by imports`, async () => {
    process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), `tangent-search-${engine}-dart-`));
    const repo = await copyFixture("dart");

    const indexed = await indexRepo({ repo, force: true, languages: ["dart"], engine });
    assert.ok(indexed.files >= 2);

    const linked = await testsFor("lib/calc.dart", { repo, languages: ["dart"], engine });
    assert.equal(linked.rows[0].path, "test/calc_test.dart");

    const state = await status({ repo, engine });
    assert.equal(state.languages[0].language, "dart");
  });
}

test("TANGENT_SEARCH_ENGINE selects rust when no engine option is passed", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-env-rust-"));
  process.env.TANGENT_SEARCH_ENGINE = "rust";
  try {
    const repo = await copyFixture("typescript");
    await indexRepo({ repo, force: true });
    const results = await searchRepo("format greeting", { repo });
    assert.equal(results.implementationSymbols[0].qualifiedName, "formatGreeting");
  } finally {
    delete process.env.TANGENT_SEARCH_ENGINE;
  }
});

test("bench compares TypeScript and Rust engines", async () => {
  const repo = await copyFixture("typescript");
  const result = await benchSearch({ repo, query: "format greeting", iterations: 1 });

  assert.deepEqual(result.results.map((item) => item.engine), ["ts", "rust"]);
  assert.equal(result.parity.fileCountsMatch, true);
  assert.equal(result.parity.topHitMatches, true);
});

async function copyFixture(name) {
  const source = path.join(here, "fixtures", name);
  const target = await mkdtemp(path.join(tmpdir(), `tangent-search-${name}-repo-`));
  await cp(source, target, { recursive: true });
  return target;
}
