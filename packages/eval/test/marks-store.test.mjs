import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMarkId, createMarkRecord, listMarks, readMark, updateMark, writeMark } from "../dist/marks/store.js";

const anchor = {
  provider: "claude",
  sessionId: "session-1",
  conversationId: "claude:session-1",
  transcriptPath: "/home/user/.claude/projects/repo/session-1.jsonl"
};
const repo = { root: "/Users/me/Projects/example", branch: "main" };

/** Creates a temp marks directory for a test, and returns it plus a cleanup function. */
async function tempMarksDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-marks-"));
  /** Removes the temp marks directory created for this test. */
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

test("createMarkId formats a compact timestamp plus a short slug from the source text", () => {
  const at = new Date("2026-07-05T14:30:12.000Z");
  const id = createMarkId("you should have read the docs index first, always", at);
  assert.equal(id, "20260705T143012-you-should-have-read-the-docs");
});

test("createMarkId falls back to a generic slug for text with no alphanumeric words", () => {
  const id = createMarkId("!!! ???", new Date("2026-07-05T14:30:12.000Z"));
  assert.equal(id, "20260705T143012-mark");
});

test("createMarkRecord fills id, at, kind, status, and links when the draft omits them", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "greped for six minutes" }, new Date("2026-07-05T14:30:12.000Z"));
  assert.equal(mark.schema, "tangent.mark.v1");
  assert.equal(mark.id, "20260705T143012-greped-for-six-minutes");
  assert.equal(mark.at, "2026-07-05T14:30:12.000Z");
  assert.equal(mark.kind, "failure");
  assert.equal(mark.status, "new");
  assert.deepEqual(mark.links, { eval: null, fix: null });
});

test("createMarkRecord respects an explicit id, kind, status, and links when the draft supplies them", () => {
  const mark = createMarkRecord({
    id: "custom-id",
    kind: "candidate",
    status: "triaged",
    anchor,
    repo,
    observed: "spent 11 min in read/search",
    links: { eval: "search-eval" }
  });
  assert.equal(mark.id, "custom-id");
  assert.equal(mark.kind, "candidate");
  assert.equal(mark.status, "triaged");
  assert.deepEqual(mark.links, { eval: "search-eval", fix: null });
});

test("writeMark and readMark round-trip a mark to its own JSON file", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note", expected: "better", hypothesis: "missing docs" });
    await writeMark(mark, dir);
    const read = await readMark(mark.id, dir);
    // JSON.stringify drops keys whose value is undefined (e.g. the unset `quote` field), so compare
    // against the mark's own JSON round trip rather than the in-memory object with those keys present.
    assert.deepEqual(read, JSON.parse(JSON.stringify(mark)));
  } finally {
    await cleanup();
  }
});

test("updateMark applies a partial patch, merges links, and persists the result", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note" });
    await writeMark(mark, dir);

    const updated = await updateMark(mark.id, { status: "triaged", links: { eval: "my-eval" } }, dir);
    assert.equal(updated.status, "triaged");
    assert.deepEqual(updated.links, { eval: "my-eval", fix: null });

    const reread = await readMark(mark.id, dir);
    assert.deepEqual(reread, updated);

    const fixed = await updateMark(mark.id, { links: { fix: "PR-42" } }, dir);
    assert.deepEqual(fixed.links, { eval: "my-eval", fix: "PR-42" }, "a later patch must not clobber an unrelated link field");
  } finally {
    await cleanup();
  }
});

test("updateMark rejects a patch that would produce an invalid record", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note" });
    await writeMark(mark, dir);
    await assert.rejects(updateMark(mark.id, { status: "not-a-status" }, dir), /status/i);
  } finally {
    await cleanup();
  }
});

test("listMarks filters by status, kind, and repo, and sorts newest first", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const older = createMarkRecord({ anchor, repo, observed: "older mark", kind: "failure" }, new Date("2026-07-01T00:00:00.000Z"));
    const newer = createMarkRecord({ anchor, repo, observed: "newer mark", kind: "candidate", status: "triaged" }, new Date("2026-07-05T00:00:00.000Z"));
    const otherRepo = createMarkRecord({ anchor, repo: { root: "/Users/me/Projects/other" }, observed: "other repo mark" }, new Date("2026-07-03T00:00:00.000Z"));
    await writeMark(older, dir);
    await writeMark(newer, dir);
    await writeMark(otherRepo, dir);

    const all = await listMarks({}, dir);
    assert.deepEqual(all.map((mark) => mark.id), [newer.id, otherRepo.id, older.id], "newest first by at");

    const newStatus = await listMarks({ status: "new" }, dir);
    assert.deepEqual(newStatus.map((mark) => mark.id).sort(), [older.id, otherRepo.id].sort());

    const candidates = await listMarks({ kind: "candidate" }, dir);
    assert.deepEqual(candidates.map((mark) => mark.id), [newer.id]);

    const scoped = await listMarks({ repo: repo.root }, dir);
    assert.deepEqual(scoped.map((mark) => mark.id).sort(), [older.id, newer.id].sort());
  } finally {
    await cleanup();
  }
});

test("listMarks returns an empty array for a marks directory that does not exist yet", async () => {
  const missingDir = path.join(tmpdir(), "tangent-marks-does-not-exist", String(Date.now()));
  assert.deepEqual(await listMarks({}, missingDir), []);
});
