import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMarkRecord, writeMark } from "../dist/marks/store.js";
import { getMarkRoute, listMarksRoute, updateMarkRoute } from "../dist/server/marks-routes.js";

const anchor = {
  provider: "claude",
  sessionId: "session-1",
  conversationId: "claude:session-1",
  transcriptPath: "/home/user/.claude/projects/repo/session-1.jsonl"
};
const repo = { root: "/Users/me/Projects/example", branch: "main" };

/** Creates a temp marks directory for a route test, and returns it plus a cleanup function. */
async function tempMarksDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-marks-routes-"));
  /** Removes the temp marks directory created for this test. */
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

/** Builds a fake `http.IncomingMessage`-shaped async-iterable body for a route handler under test. */
function fakeRequest(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))]);
}

test("listMarksRoute lists newest first and applies status/kind filters via query params", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const older = createMarkRecord({ anchor, repo, observed: "older" }, new Date("2026-07-01T00:00:00.000Z"));
    const newer = createMarkRecord({ anchor, repo, observed: "newer", kind: "candidate" }, new Date("2026-07-05T00:00:00.000Z"));
    await writeMark(older, dir);
    await writeMark(newer, dir);

    const all = await listMarksRoute(new URL("http://x/api/eval/marks"), dir);
    assert.deepEqual(all.marks.map((mark) => mark.id), [newer.id, older.id]);

    const candidates = await listMarksRoute(new URL("http://x/api/eval/marks?kind=candidate"), dir);
    assert.deepEqual(candidates.marks.map((mark) => mark.id), [newer.id]);
  } finally {
    await cleanup();
  }
});

test("listMarksRoute rejects an unrecognized status or kind filter", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    await assert.rejects(listMarksRoute(new URL("http://x/api/eval/marks?status=bogus"), dir), /Invalid status filter/);
    await assert.rejects(listMarksRoute(new URL("http://x/api/eval/marks?kind=bogus"), dir), /Invalid kind filter/);
  } finally {
    await cleanup();
  }
});

test("getMarkRoute returns the mark, and 404-tags a missing id", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note" });
    await writeMark(mark, dir);

    const found = await getMarkRoute(mark.id, dir);
    assert.equal(found.id, mark.id);

    await assert.rejects(getMarkRoute("does-not-exist", dir), (error) => error.status === 404);
  } finally {
    await cleanup();
  }
});

test("updateMarkRoute applies a status/links patch from the request body and persists it", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note" });
    await writeMark(mark, dir);

    const updated = await updateMarkRoute(mark.id, fakeRequest({ status: "dismissed" }), dir);
    assert.equal(updated.status, "dismissed");

    const reread = await getMarkRoute(mark.id, dir);
    assert.equal(reread.status, "dismissed");
  } finally {
    await cleanup();
  }
});

test("updateMarkRoute 404-tags a missing mark before attempting the patch", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    await assert.rejects(updateMarkRoute("does-not-exist", fakeRequest({ status: "fixed" }), dir), (error) => error.status === 404);
  } finally {
    await cleanup();
  }
});

test("updateMarkRoute rejects an unrecognized status value in the request body", async () => {
  const { dir, cleanup } = await tempMarksDir();
  try {
    const mark = createMarkRecord({ anchor, repo, observed: "note" });
    await writeMark(mark, dir);
    await assert.rejects(updateMarkRoute(mark.id, fakeRequest({ status: "bogus" }), dir), /Invalid status/);
  } finally {
    await cleanup();
  }
});
