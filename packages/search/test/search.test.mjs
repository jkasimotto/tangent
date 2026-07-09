import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { indexRepo, searchRepo, skeleton, status, symbol, testsFor } from "../dist/sdk/index.js";
import { runSearchCli } from "../dist/cli/index.js";
import { deleteFileIndexRows, SearchDB } from "../dist/core/db.js";

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

test("reports SDK progress while indexing", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-progress-"));
  const repo = await copyFixture("typescript");
  const events = [];

  /** Collects indexer progress events for assertions. */
  const onProgress = (event) => events.push(event);
  const indexed = await indexRepo({ repo, force: true, onProgress });

  assert.equal(indexed.action, "full");
  assert.ok(events.some((event) => event.phase === "start" && event.languages.includes("typescript")));
  assert.ok(events.some((event) => event.phase === "scan" && event.total >= 2));
  assert.ok(events.some((event) => event.phase === "plan" && event.action === "full" && event.total >= 2));
  assert.ok(events.some((event) => event.phase === "parse" && event.current === event.total && event.total >= 2));
  assert.ok(events.some((event) => event.phase === "done" && event.action === "full"));
});

test("reports progress for up-to-date indexes", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-up-to-date-"));
  const repo = await copyFixture("typescript");
  await indexRepo({ repo, force: true });
  const events = [];

  /** Collects indexer progress events for assertions. */
  const onProgress = (event) => events.push(event);
  const indexed = await indexRepo({ repo, onProgress });

  assert.equal(indexed.action, "up-to-date");
  assert.ok(events.some((event) => event.phase === "scan" && event.total >= 2));
  assert.ok(events.some((event) => event.phase === "plan" && event.action === "up-to-date" && event.changed === 0 && event.deleted === 0));
  assert.ok(events.some((event) => event.phase === "done" && event.action === "up-to-date"));
});

test("reports granular progress inside incremental index writes", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-incremental-progress-"));
  const repo = await copyFixture("typescript");
  await indexRepo({ repo, force: true });
  const sourcePath = path.join(repo, "src", "math.ts");
  await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nexport const extraValue = 42;\n`, "utf8");
  const events = [];

  /** Collects indexer progress events for assertions. */
  const onProgress = (event) => events.push(event);
  const indexed = await indexRepo({ repo, onProgress });

  assert.equal(indexed.action, "incremental");
  assert.ok(events.some((event) => event.phase === "write" && event.stage === "affected"));
  assert.ok(events.some((event) => event.phase === "write" && event.stage === "upsert" && event.current === event.total));
  assert.ok(events.some((event) => event.phase === "edges" && event.stage === "import"));
  assert.ok(events.some((event) => event.phase === "edges" && event.stage === "symbol"));
  assert.ok(events.some((event) => event.phase === "edges" && event.stage === "test"));
});

test("reports slow operation warnings through SDK progress", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-slow-progress-"));
  const repo = await copyFixture("typescript");
  const events = [];

  /** Collects indexer progress events for assertions. */
  const onProgress = (event) => events.push(event);
  await indexRepo({ repo, force: true, slowOperationMs: 0, onProgress });

  assert.ok(events.some((event) => event.level === "warning" && event.step === "warning" && event.durationMs !== undefined));
  assert.ok(events.some((event) => event.level === "warning" && event.path && event.message));
});

test("bulk cleanup removes indexed rows without per-entity progress spam", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-bulk-cleanup-"));
  const repo = await copyFixture("typescript");
  const indexed = await indexRepo({ repo, force: true });
  const db = new SearchDB(indexed.dbPath);
  try {
    const file = db.conn.prepare("SELECT id FROM files WHERE path=?").get("src/math.ts");
    assert.ok(file);
    const symbols = db.conn.prepare("SELECT id FROM symbols WHERE file_id=?").all(file.id);
    assert.ok(symbols.length >= 2);
    db.conn.prepare("INSERT INTO edges(from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?)").run(file.id, null, "fixture_from", 1, "from file");
    db.conn.prepare("INSERT INTO edges(from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?)").run(null, file.id, "fixture_to", 1, "to file");
    const beforeEntities = countEntities(db, file.id, symbols.map((row) => row.id));
    const beforeFts = countFts(db, file.id, symbols.map((row) => row.id));
    const events = [];

    const result = deleteFileIndexRows(db, file.id, false, (event) => events.push(event));

    assert.ok(result.edges >= 2);
    assert.equal(result.symbols, symbols.length);
    assert.equal(result.entities, beforeEntities);
    if (db.ftsEnabled) assert.equal(result.fts, beforeFts);
    assert.equal(countRows(db, "symbols", "file_id=?", [file.id]), 0);
    assert.equal(countEntities(db, file.id, symbols.map((row) => row.id)), 0);
    if (db.ftsEnabled) assert.equal(countFts(db, file.id, symbols.map((row) => row.id)), 0);
    assert.equal(events.filter((event) => event.step === "entities").length, 1);
    assert.equal(events.filter((event) => event.step === "fts").length, 1);
  } finally {
    db.close();
  }
});

test("bulk cleanup falls back when FTS delete is unavailable", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-fts-fallback-"));
  const repo = await copyFixture("typescript");
  const indexed = await indexRepo({ repo, force: true });
  const db = new SearchDB(indexed.dbPath);
  try {
    if (!db.ftsEnabled) return;
    const file = db.conn.prepare("SELECT id FROM files WHERE path=?").get("src/math.ts");
    assert.ok(file);
    db.conn.exec("DROP TABLE entities_fts");

    const result = deleteFileIndexRows(db, file.id, false);

    assert.equal(result.ftsMode, "fallback");
    assert.equal(countRows(db, "symbols", "file_id=?", [file.id]), 0);
  } finally {
    db.close();
  }
});

test("CLI prints index progress to stderr and final summary to stdout", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-cli-progress-"));
  const repo = await copyFixture("typescript");
  const output = await captureConsole(() => runSearchCli(["index", repo, "--force"]));

  assert.match(output.stderr.join("\n"), /search index: starting /);
  assert.match(output.stderr.join("\n"), /search index: scanning files/);
  assert.match(output.stderr.join("\n"), /search index: full rebuild; parsing \d+ files/);
  assert.match(output.stderr.join("\n"), /search index: upserting \d+ parsed files/);
  assert.match(output.stderr.join("\n"), /search index: rebuilding import edges/);
  assert.match(output.stdout.join("\n"), /search full: \d+ files, \d+ symbols, \d+ edges/);
});

test("CLI verbose index progress identifies per-file write and edge steps", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-cli-verbose-"));
  const repo = await copyFixture("typescript");
  await indexRepo({ repo, force: true });
  const sourcePath = path.join(repo, "src", "math.ts");
  await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nexport const cliVerboseValue = 7;\n`, "utf8");

  const output = await captureConsole(() => runSearchCli(["index", repo, "--verbose"]));
  const stderr = output.stderr.join("\n");

  assert.match(stderr, /search index: start/);
  assert.match(stderr, /context db done .*fts=/);
  assert.match(stderr, /plan .*action=incremental/);
  assert.match(stderr, /parse file start .*src\/math\.ts/);
  assert.match(stderr, /write upsert start .*src\/math\.ts/);
  assert.match(stderr, /write delete-old start .*src\/math\.ts/);
  assert.match(stderr, /write upsert entities-done .*src\/math\.ts/);
  assert.match(stderr, /write delete-old fts .*ftsMode=/);
  assert.ok(output.stderr.filter((line) => /write delete-old entities/.test(line)).length <= 1);
  assert.match(stderr, /edges import/);
  assert.match(stderr, /duration=/);
  assert.match(output.stdout.join("\n"), /search incremental: \d+ files, \d+ symbols, \d+ edges/);
});

test("does not index Dart constructor or method parameters as fields", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-dart-params-"));
  const repo = await copyFixture("dart");
  const indexed = await indexRepo({ repo, force: true, languages: ["dart"] });
  const db = new SearchDB(indexed.dbPath);
  try {
    const rows = db.conn.prepare("SELECT qualified_name AS qname, kind FROM symbols WHERE qualified_name LIKE 'CalcToolState%'").all();
    const byName = new Map(rows.map((row) => [row.qname, row.kind]));
    assert.equal(byName.get("CalcToolState.sharedCalculator"), undefined);
    assert.equal(byName.get("CalcToolState.seedEntry"), undefined);
    assert.equal(byName.get("CalcToolState.left"), undefined);
    assert.equal(byName.get("CalcToolState.right"), undefined);
    assert.equal(byName.get("CalcToolState.calculator"), "field");
    assert.equal(byName.get("CalcToolState.history"), "field");
    assert.equal(byName.get("CalcToolState.emptyEntry"), "field");
    assert.equal(byName.get("CalcToolState.lastTotal"), "getter");
    const enumRows = db.conn.prepare("SELECT qualified_name AS qname, kind, signature FROM symbols WHERE qualified_name LIKE 'CalcMode%'").all();
    const enumByName = new Map(enumRows.map((row) => [row.qname, row]));
    assert.equal(enumByName.get("CalcMode.standard")?.kind, "enum_value");
    assert.equal(enumByName.get("CalcMode.scientific")?.kind, "enum_value");
    assert.match(enumByName.get("CalcMode.scientific")?.signature || "", /scientific/);
  } finally {
    db.close();
  }
});

test("ranks distinct declarations above members in fuzzy symbol lookup", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-dart-rank-"));
  const repo = await copyFixture("dart");
  await indexRepo({ repo, force: true, languages: ["dart"] });

  const results = await symbol("ToolState", { repo, languages: ["dart"] });

  const classNames = results.filter((row) => row.kind === "class").map((row) => row.qualifiedName);
  assert.deepEqual(classNames.sort(), ["CalcToolState", "ReplayToolState"]);
  assert.equal(results[0].kind, "class");
  assert.equal(results[1].kind, "class");
  for (const row of results) {
    const ownName = row.qualifiedName.split(".").pop() || "";
    assert.ok(ownName.includes("ToolState"), `member matched only via parent: ${row.qualifiedName}`);
  }
});

test("force reindex succeeds on a populated index", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-force-repop-"));
  const repo = await copyFixture("dart");
  await indexRepo({ repo, force: true, languages: ["dart"] });

  const again = await indexRepo({ repo, force: true, languages: ["dart"] });

  assert.equal(again.action, "full");
  assert.ok(again.symbols >= 3);
});

test("rebuilds the index when the stored index version changes", async () => {
  process.env.TANGENT_SEARCH_HOME = await mkdtemp(path.join(tmpdir(), "tangent-search-version-"));
  const repo = await copyFixture("typescript");
  const indexed = await indexRepo({ repo, force: true });
  const db = new SearchDB(indexed.dbPath);
  db.setMeta("version", "0.0.1");
  db.close();

  const events = [];
  /** Collects indexer progress events for assertions. */
  const onProgress = (event) => events.push(event);
  const reindexed = await indexRepo({ repo, onProgress });

  assert.equal(reindexed.action, "full");
  assert.ok(events.some((event) => event.phase === "plan" && event.reason === "index-version-changed"));
});

/** Copies a language fixture repo into a temp directory for one test. */
async function copyFixture(name) {
  const source = path.join(here, "fixtures", name);
  const target = await mkdtemp(path.join(tmpdir(), `tangent-search-${name}-repo-`));
  await cp(source, target, { recursive: true });
  return target;
}

/** Runs fn while capturing console.log/console.error lines for assertions. */
async function captureConsole(fn) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => stdout.push(values.join(" "));
  console.error = (...values) => stderr.push(values.join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout, stderr };
}

/** Counts rows in a table matching the where clause. */
function countRows(db, table, where, params) {
  return db.conn.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(...params).c;
}

/** Counts entity rows for a file and its symbols. */
function countEntities(db, fileId, symbolIds) {
  const symbolCount = symbolIds.length
    ? countRows(db, "entities", `entity_type='symbol' AND entity_id IN (${symbolIds.map(() => "?").join(",")})`, symbolIds)
    : 0;
  return symbolCount + countRows(db, "entities", "entity_type='file' AND entity_id=?", [fileId]);
}

/** Counts FTS rows for a file and its symbols, or 0 when FTS is disabled. */
function countFts(db, fileId, symbolIds) {
  if (!db.ftsEnabled) return 0;
  const symbolCount = symbolIds.length
    ? countRows(db, "entities_fts", `entity_type='symbol' AND entity_id IN (${symbolIds.map(() => "?").join(",")})`, symbolIds)
    : 0;
  return symbolCount + countRows(db, "entities_fts", "entity_type='file' AND entity_id=?", [fileId]);
}
