import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStyleNote, createStyleNotes, filterStyleNotes, summarizeStyleNotes } from "./style-notes.mjs";

/** One temporary corpus file, removed with the test, that the real ~/.tangent/style-notes.jsonl never sees. */
async function corpus(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "style-notes-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "nested", "style-notes.jsonl");
}

/** The smallest valid input, with any field overridden. */
function input(overrides = {}) {
  return {
    note: "Three clauses before the subject.",
    document: { file: "otto/tangent/design-scene.md", area: "otto/tangent", title: "Scene" },
    ...overrides,
  };
}

test("a style note is a self-contained fact, not a pointer into a Document", () => {
  const { entry } = buildStyleNote(input({
    tags: ["Buried Lede", "buried-lede", "  "],
    quote: { text: "Because the pipeline resolves each anchor, the scene is stable.", line: 42, heading: "Rendering" },
    author: { source: "blame-trailer", commit: "9c1e", session: "tangent-scene-2", harness: "claude-otto", model: "opus-5", effort: "high" },
    observer: { kind: "brain", session: "tangent-brain-g44", area: "otto/tangent", harness: "claude-otto", model: "opus-5", effort: "high" },
  }), { id: "id-1", at: "2026-09-02T21:14:07.221Z" });

  assert.equal(entry.schema, "tangent.style-note.v1");
  assert.equal(entry.quote.text, "Because the pipeline resolves each anchor, the scene is stable.", "the snapshot is what survives the rewrite");
  assert.equal(entry.quote.line, 42);
  assert.deepEqual(entry.tags, ["buried-lede"], "free-text tags normalize and deduplicate");
  assert.equal(entry.author.known, true);
  assert.equal(entry.author.model, "opus-5");
  assert.equal(entry.observer.kind, "brain");
});

test("provenance is recorded or explicitly null with a reason, never inferred", () => {
  const noTrailer = buildStyleNote(input({ author: { source: "no-trailer", commit: "abc1234" } })).entry;
  assert.deepEqual(
    { known: noTrailer.author.known, source: noTrailer.author.source, model: noTrailer.author.model },
    { known: false, source: "no-trailer", model: null },
  );
  const halfKnown = buildStyleNote(input({ author: { source: "blame-trailer", session: "gone" } })).entry;
  assert.equal(halfKnown.author.known, false, "a blame-trailer hit with no launch facts is still an unknown author");
  const invented = buildStyleNote(input({ author: { source: "made-up" } })).entry;
  assert.equal(invented.author.source, "no-blame", "an unrecognized reason never becomes a claim of knowledge");
});

test("a style note refuses to exist without its observation or its Document", () => {
  assert.match(buildStyleNote(input({ note: "   " })).error, /observation/);
  assert.match(buildStyleNote(input({ document: { file: "" } })).error, /Document/);
});

test("one entry stays one short line so a concurrent append is unlikely to interleave", () => {
  const { entry } = buildStyleNote(input({ note: `${"x".repeat(2000)}`, quote: { text: "y".repeat(4000) } }));
  assert.equal(entry.note.length, 1000);
  assert.equal(entry.quote.text.length, 2000);
  assert.ok(!JSON.stringify(entry).includes("\n"));
});

test("the corpus appends, reads back newest first, and creates its file on first use", async (context) => {
  const file = await corpus(context);
  const notes = createStyleNotes({ file, newId: (() => { let n = 0; return () => `id-${n += 1}`; })() });
  assert.deepEqual(await notes.read(), { entries: [], skipped: 0, total: 0, counts: summarizeStyleNotes([]) }, "a missing corpus reads as empty");

  await notes.add(input({ note: "First." }));
  await notes.add(input({ note: "Second." }));
  const { entries, total } = await notes.read();
  assert.deepEqual(entries.map((entry) => entry.note), ["Second.", "First."]);
  assert.equal(total, 2);
  const lines = (await readFile(file, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2, "each note is exactly one line");
  assert.equal(JSON.parse(lines[0]).note, "First.", "the file itself stays append only");
  assert.equal((await notes.show("id-1")).note, "First.");
  assert.equal(await notes.show("missing"), null);
});

test("one corrupt line is counted and skipped, never thrown", async (context) => {
  const file = await corpus(context);
  const notes = createStyleNotes({ file });
  await notes.add(input({ note: "Good." }));
  await writeFile(file, `${await readFile(file, "utf8")}{not json\n[]\n`, "utf8");
  await notes.add(input({ note: "Later." }));
  const { entries, skipped } = await notes.read();
  assert.deepEqual(entries.map((entry) => entry.note), ["Later.", "Good."]);
  assert.equal(skipped, 2);
});

const CORPUS = [
  { at: "2026-09-01T00:00:00Z", tags: ["buried-lede"], document: { file: "otto/tangent/a.md", area: "otto/tangent" }, author: { known: true, model: "opus-5", harness: "claude-otto" } },
  { at: "2026-09-02T00:00:00Z", tags: ["buried-lede", "hedging"], document: { file: "otto/tangent/deep/b.md", area: "otto/tangent/deep" }, author: { known: true, model: "opus-5", harness: "codex" } },
  { at: "2026-09-03T00:00:00Z", tags: [], document: { file: "otto/dnd/c.md", area: "otto/dnd" }, author: { known: false, model: null, harness: null } },
];

test("listing filters by Area subtree, exact file, model, tag, and time", () => {
  assert.equal(filterStyleNotes(CORPUS, { area: "otto/tangent" }).length, 2, "an Area filter includes its child Areas");
  assert.equal(filterStyleNotes(CORPUS, { area: "otto/dnd" }).length, 1);
  assert.equal(filterStyleNotes(CORPUS, { file: "otto/tangent/a.md" }).length, 1);
  assert.equal(filterStyleNotes(CORPUS, { model: "opus-5" }).length, 2);
  assert.equal(filterStyleNotes(CORPUS, { harness: "codex" }).length, 1);
  assert.equal(filterStyleNotes(CORPUS, { tag: "Buried Lede" }).length, 2, "a typed tag matches the stored token");
  assert.equal(filterStyleNotes(CORPUS, { since: "2026-09-02T00:00:00Z" }).length, 2);
  assert.equal(filterStyleNotes(CORPUS, {}).length, 3);
});

test("the counts say which model wrote badly, which problems repeat, and how much is unattributed", () => {
  const counts = summarizeStyleNotes(CORPUS);
  assert.equal(counts.total, 3);
  assert.deepEqual(counts.byModel, [{ value: "opus-5", count: 2 }]);
  assert.deepEqual(counts.byTag, [{ value: "buried-lede", count: 2 }, { value: "hedging", count: 1 }]);
  assert.equal(counts.unknownAuthors, 1);
});
