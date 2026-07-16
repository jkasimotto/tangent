import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderStateOfPlaySection, updateSharedStateOfPlay } from "../dist/core/state-of-play.js";

const threads = [
  { slug: "guy-wires", node: "proj", owner: "Will", state: "needs-you", templateWhy: "deadline 2026-07-17.", outcome: "guys on staging" },
  { slug: "clearances", node: "proj", owner: "sonnet", state: "working", templateWhy: "session active.", outcome: "clearances in panel" }
];

test("renders one line per thread with owner, state, outcome", () => {
  const section = renderStateOfPlaySection(threads, {}, new Date("2026-07-16T08:00:00Z"));
  assert.match(section, /guy-wires.*Will.*needs-you.*guys on staging/s);
  assert.match(section, /clearances.*sonnet.*working/s);
});

test("splices between markers preserving human content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sop-"));
  await mkdir(path.join(dir, "shared"), { recursive: true });
  const file = path.join(dir, "shared", "state-of-play.md");
  await writeFile(file, "# State of play\n\nHuman intro.\n\n<!-- tangent-threads:begin -->\nold\n<!-- tangent-threads:end -->\n\nHuman outro.\n");
  const wrote = await updateSharedStateOfPlay(dir, "NEW SECTION\n");
  assert.equal(wrote, "written");
  const content = await readFile(file, "utf8");
  assert.match(content, /Human intro\./);
  assert.match(content, /NEW SECTION/);
  assert.match(content, /Human outro\./);
  assert.doesNotMatch(content, /\nold\n/);
  assert.equal(await updateSharedStateOfPlay(dir, "NEW SECTION\n"), "unchanged");
});

test("creates the file with markers when absent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sop-new-"));
  await mkdir(path.join(dir, "shared"), { recursive: true });
  assert.equal(await updateSharedStateOfPlay(dir, "SECTION\n"), "written");
  const content = await readFile(path.join(dir, "shared", "state-of-play.md"), "utf8");
  assert.match(content, /tangent-threads:begin/);
  assert.match(content, /SECTION/);
});

/** Creates `<dir>/shared/state-of-play.md` with the given raw content, returning the dir and file path for a malformed-marker regression test. */
async function buildSharedFile(content) {
  const dir = await mkdtemp(path.join(tmpdir(), "sop-malformed-"));
  await mkdir(path.join(dir, "shared"), { recursive: true });
  const file = path.join(dir, "shared", "state-of-play.md");
  await writeFile(file, content);
  return { dir, file };
}

test("orphan begin marker only: file untouched, result malformed", async () => {
  const content = "# Notes\n\nIntro.\n\n<!-- tangent-threads:begin -->\nsome text that must survive\n\nOutro.\n";
  const { dir, file } = await buildSharedFile(content);

  const result = await updateSharedStateOfPlay(dir, "NEW SECTION\n");

  assert.deepEqual(result, { status: "malformed", beginCount: 1, endCount: 0 });
  assert.equal(await readFile(file, "utf8"), content);
});

test("orphan end marker only: file untouched, result malformed", async () => {
  const content = "# Notes\n\nIntro.\n\nsome text that must survive\n<!-- tangent-threads:end -->\n\nOutro.\n";
  const { dir, file } = await buildSharedFile(content);

  const result = await updateSharedStateOfPlay(dir, "NEW SECTION\n");

  assert.deepEqual(result, { status: "malformed", beginCount: 0, endCount: 1 });
  assert.equal(await readFile(file, "utf8"), content);
});

test("two begin/end pairs: file untouched, result malformed", async () => {
  const content = [
    "# Notes",
    "",
    "<!-- tangent-threads:begin -->",
    "first",
    "<!-- tangent-threads:end -->",
    "",
    "<!-- tangent-threads:begin -->",
    "second",
    "<!-- tangent-threads:end -->",
    ""
  ].join("\n");
  const { dir, file } = await buildSharedFile(content);

  const result = await updateSharedStateOfPlay(dir, "NEW SECTION\n");

  assert.deepEqual(result, { status: "malformed", beginCount: 2, endCount: 2 });
  assert.equal(await readFile(file, "utf8"), content);
});

test("end marker before begin marker: file untouched, result malformed", async () => {
  const content = "# Notes\n\n<!-- tangent-threads:end -->\nbetween\n<!-- tangent-threads:begin -->\n";
  const { dir, file } = await buildSharedFile(content);

  const result = await updateSharedStateOfPlay(dir, "NEW SECTION\n");

  assert.deepEqual(result, { status: "malformed", beginCount: 1, endCount: 1 });
  assert.equal(await readFile(file, "utf8"), content);
});

test("reviewer repro: an orphan marker from a human edit is never spliced across on a later sweep", async () => {
  // Pre-fix failure mode: a human deletes one marker of an already-generated pair, leaving human
  // content after the surviving begin marker. The old code appended a fresh pair on "sweep 1", then
  // spliced from the orphaned begin to the new pair's end on "sweep 2", deleting everything between.
  // The fix must refuse both sweeps outright and never touch the file.
  const content = "# State of play\n\nHuman intro.\n\n<!-- tangent-threads:begin -->\nHuman note that must never be deleted.\n\nHuman outro.\n";
  const { dir, file } = await buildSharedFile(content);

  const sweep1 = await updateSharedStateOfPlay(dir, "SECTION\n");
  assert.deepEqual(sweep1, { status: "malformed", beginCount: 1, endCount: 0 });
  assert.equal(await readFile(file, "utf8"), content);

  const sweep2 = await updateSharedStateOfPlay(dir, "SECTION\n");
  assert.deepEqual(sweep2, { status: "malformed", beginCount: 1, endCount: 0 });
  const finalContent = await readFile(file, "utf8");
  assert.equal(finalContent, content);
  assert.match(finalContent, /Human note that must never be deleted\./);
});
