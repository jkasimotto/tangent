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
