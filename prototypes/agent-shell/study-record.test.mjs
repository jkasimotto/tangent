import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyAnswer,
  applyTutorFailure,
  applyTutorReply,
  closeStudy,
  latestStudy,
  newStudyRecord,
  readAllStudies,
  readStudy,
  writeStudy
} from "./study-record.mjs";

/** A record started at a fixed instant, so ids and order are predictable. */
function record(fields = {}) {
  return newStudyRecord({ area: "otto/tangent", repo: "/repo", subsystem: "the search indexer", now: "2026-08-20T09:00:00.000Z", ...fields });
}

test("a new record opens pending, in calibration mode, with a readable id", () => {
  const study = record();
  assert.match(study.id, /^\d{4}-\d{2}-\d{2}-\d{6}-the-search-indexer$/);
  assert.equal(study.status, "open");
  assert.equal(study.mode, "calibration");
  assert.equal(study.pending, true);
  assert.deepEqual(study.turns, []);
});

test("the id slug folds punctuation, caps length, and never ends in a hyphen", () => {
  assert.match(record({ subsystem: "@tangent/usage — the SQLite index!" }).id, /-tangent-usage-the-sqlite-index$/);
  assert.match(record({ subsystem: "x".repeat(80) }).id, /-x{40}$/);
  assert.match(record({ subsystem: "!!!" }).id, /-session$/);
});

test("a record needs a subsystem and a repo", () => {
  assert.throws(() => record({ subsystem: "   " }), /subsystem is empty/);
  assert.throws(() => record({ repo: "" }), /repo is empty/);
});

test("an answer then a reply is one round trip, and the mode follows the tutor", () => {
  const answered = applyAnswer(record(), "It caches by HEAD.", "2026-08-20T09:01:00.000Z");
  assert.equal(answered.pending, true);
  assert.deepEqual(answered.turns.at(-1), { role: "julian", at: "2026-08-20T09:01:00.000Z", text: "It caches by HEAD." });

  const graded = applyTutorReply(answered, {
    say: "",
    verdict: { result: "pass", evidence: "area-map.mjs createVaultGitReader", note: "" },
    reveal: { file: "area-map.mjs", start: 1, end: 4, text: "// one\n// two" },
    question: { index: 2, total: 5, type: "trace", text: "Where next?", snippet: null },
    mode: "predict-first",
    done: false,
    record: null
  }, "2026-08-20T09:02:00.000Z");
  assert.equal(graded.pending, false);
  assert.equal(graded.mode, "predict-first");
  assert.equal(graded.turns.at(-1).verdict.result, "pass");
  assert.equal(graded.turns.at(-1).reveal.text, "// one\n// two");
  assert.equal(graded.status, "open");
});

test("done closes the study with the record line, and falls back to say", () => {
  const base = record();
  const closed = applyTutorReply(base, { say: "", mode: "predict-first", done: true, record: "predict-first, 4 of 5 first try" }, "2026-08-20T09:30:00.000Z");
  assert.equal(closed.status, "closed");
  assert.equal(closed.closedAt, "2026-08-20T09:30:00.000Z");
  assert.equal(closed.record, "predict-first, 4 of 5 first try");

  const noLine = applyTutorReply(base, { say: "You stopped after two.", mode: "calibration", done: true, record: null });
  assert.equal(noLine.record, "You stopped after two.");
  const silent = applyTutorReply(base, { say: "", mode: "calibration", done: true, record: null });
  assert.equal(silent.record, "session ended");
});

test("a failed turn clears pending and keeps the reason; the next answer clears it", () => {
  const failed = applyTutorFailure(record(), "the tutor timed out", "2026-08-20T09:05:00.000Z");
  assert.equal(failed.pending, false);
  assert.equal(failed.error, "the tutor timed out");
  assert.equal(applyAnswer(failed, "again").error, null);
});

test("closeStudy ends a study the tutor could not close", () => {
  const ended = closeStudy(record(), "ended early, tutor unreachable", "2026-08-20T09:06:00.000Z");
  assert.equal(ended.status, "closed");
  assert.equal(ended.pending, false);
  assert.equal(ended.record, "ended early, tutor unreachable");
});

test("apply functions never mutate the record they are given", () => {
  const study = record();
  applyAnswer(study, "x");
  applyTutorReply(study, { say: "", mode: "predict-first", done: true, record: "x" });
  applyTutorFailure(study, "x");
  assert.deepEqual(study.turns, []);
  assert.equal(study.status, "open");
});

test("write then read round trips, and readAllStudies is newest first", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "study-record-"));
  try {
    const older = record({ subsystem: "the vault reader", now: "2026-08-19T09:00:00.000Z" });
    const newer = record({ subsystem: "the search indexer", now: "2026-08-20T09:00:00.000Z" });
    const other = record({ area: "otto/notes", subsystem: "the notes reader", now: "2026-08-18T09:00:00.000Z" });
    for (const study of [older, newer, other]) await writeStudy(root, study);

    assert.deepEqual(await readStudy(root, newer.id), newer);
    assert.equal(await readStudy(root, "no-such-id"), null);
    assert.equal(await readStudy(root, "../escape"), null);

    const all = await readAllStudies(root);
    assert.deepEqual(all.map((study) => study.subsystem), ["the search indexer", "the vault reader", "the notes reader"]);
    assert.equal(latestStudy(all, "otto/tangent").subsystem, "the search indexer");
    assert.equal(latestStudy(all, "otto/notes").subsystem, "the notes reader");
    assert.equal(latestStudy(all, "otto/nothing"), null);
    assert.equal(latestStudy(all, "").subsystem, "the search indexer");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readAllStudies is empty for a root that does not exist", async () => {
  assert.deepEqual(await readAllStudies(path.join(tmpdir(), "study-root-that-is-not-there")), []);
});
