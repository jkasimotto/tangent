import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { appendJournalEntry, appendMilestone, emergencyStartProblem, exportLegacyAudit, JOURNAL_LIMIT_BYTES, MILESTONE_SUMMARY_LIMIT, newGoalQueue, operationFromProgram, querySubtreeMilestones, startNextAssignment, submitWorkerReport } from "./area-brain-domain.mjs";
import { ROOT_AREA } from "./area-identity.mjs";

test("a stored milestone summary is clipped where it is written", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-milestone-clip-"));
  const stored = await appendMilestone({
    root,
    area: "otto/tangent",
    kind: "journal",
    summary: `${"n".repeat(4_000)}`,
    idempotencyKey: "journal:long",
  });
  assert.equal(stored.summary.length, MILESTONE_SUMMARY_LIMIT);
  assert.match(stored.summary, /…$/);
  // Twelve of these used to exceed the whole prompt budget on their own.
  const query = await querySubtreeMilestones({ root, area: "otto/tangent", areas: ["otto/tangent"], limit: 12 });
  assert.ok(query.milestones[0].summary.length <= MILESTONE_SUMMARY_LIMIT);
});

test("Journal intake saves exact text once before delivery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-journal-"));
  const first = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  const again = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal((await readFile(first.file, "utf8")).match(/Exact words\./g).length, 1);
});

test("Root Journal capture writes at the vault root without creating a root folder", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-root-journal-"));
  const text = "Remember this.\nI am not sure yet.";
  const entry = await appendJournalEntry({ treesRoot: root, area: ROOT_AREA, text, idempotencyKey: "native-message-1" });
  assert.equal(entry.file, path.join(root, "journal.md"));
  assert.equal((await readFile(entry.file, "utf8")).includes(text), true);
  await assert.rejects(readFile(path.join(root, "root", "journal.md"), "utf8"));
});

test("Journal intake stays exactly once after a rollover archives the entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-journal-rollover-"));
  const first = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1", now: "2026-01-01T00:00:00.000Z" });
  await appendFile(first.file, `## 2026-02-01T00:00:00.000Z\n\n${"Filler line.\n".repeat(25_000)}\n`, "utf8");
  assert.ok(Buffer.byteLength(await readFile(first.file, "utf8")) >= JOURNAL_LIMIT_BYTES, "the fixture Journal is over the rollover limit");

  // A later entry rolls the first one into an archive, so the active Journal
  // no longer carries its marker.
  const rolled = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Later words.", idempotencyKey: "capture-2", now: "2026-03-01T00:00:00.000Z" });
  assert.ok(rolled.archive, "the second entry rolled the Journal over");
  assert.match(await readFile(rolled.archive, "utf8"), /Exact words\./);
  assert.doesNotMatch(await readFile(first.file, "utf8"), /Exact words\./);

  const retry = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1", now: "2026-03-02T00:00:00.000Z" });
  assert.equal(retry.duplicate, true, "the archived key is still used");
  assert.equal(retry.existingFile, rolled.archive, "the retry names the archive that holds the original entry");
  assert.equal(retry.createdAt, "2026-01-01T00:00:00.000Z", "the retry keeps the original entry time");
  assert.match(retry.text, /^Exact words\./, "the retry returns the original entry body");
  const everywhere = [await readFile(first.file, "utf8"), await readFile(rolled.archive, "utf8")].join("");
  assert.equal(everywhere.match(/Exact words\./g).length, 1);
});

test("recent context is durable, idempotent, and scoped to the Area subtree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-milestones-"));
  await appendMilestone({ root, area: "otto/portland", kind: "journal", summary: "Neil owns Friday.", idempotencyKey: "one", now: "2026-08-25T01:00:00.000Z" });
  await appendMilestone({ root, area: "otto/portland/rules", kind: "goal-done", summary: "Rule 250 passed.", idempotencyKey: "two", now: "2026-08-25T02:00:00.000Z" });
  await appendMilestone({ root, area: "otto/other", kind: "journal", summary: "Noise.", idempotencyKey: "three", now: "2026-08-25T03:00:00.000Z" });
  await appendMilestone({ root, area: "otto/portland", kind: "journal", summary: "Duplicate.", idempotencyKey: "one" });
  const areas = ["otto/portland", "otto/portland/rules", "otto/other"];
  const result = await querySubtreeMilestones({ root, area: "otto/portland", areas });
  assert.deepEqual(result.milestones.map((item) => item.summary), ["Rule 250 passed.", "Neil owns Friday."]);

  // The recent-work question is "what happened about 250 lately", so the
  // query takes a window and free text as well as an absolute time.
  const now = Date.parse("2026-08-25T04:00:00.000Z");
  const recent = await querySubtreeMilestones({ root, area: "otto/portland", areas, since: "3h", now });
  assert.deepEqual(recent.milestones.map((item) => item.summary), ["Rule 250 passed."]);
  const absolute = await querySubtreeMilestones({ root, area: "otto/portland", areas, since: "2026-08-25T01:30:00.000Z" });
  assert.deepEqual(absolute.milestones.map((item) => item.summary), ["Rule 250 passed."]);
  const matched = await querySubtreeMilestones({ root, area: "otto/portland", areas, query: "250 friday" });
  assert.deepEqual(matched.milestones.map((item) => item.summary), ["Rule 250 passed.", "Neil owns Friday."]);
  const narrow = await querySubtreeMilestones({ root, area: "otto/portland", areas, query: "250" });
  assert.deepEqual(narrow.milestones.map((item) => item.summary), ["Rule 250 passed."]);
});

test("one queue starts one assignment once", () => {
  const queue = newGoalQueue("goal-probe.md", [{ instruction: "Implement." }, { kind: "review", instruction: "Review." }]);
  const first = startNextAssignment(queue, "op-1");
  const duplicate = startNextAssignment(queue, "op-2");
  assert.equal(first.assignment.order, 1);
  assert.equal(duplicate.assignment.id, first.assignment.id);
  assert.equal(duplicate.duplicate, true);
});

test("emergency starts require one pending queue and exhausted exact-brain recovery", () => {
  const queue = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [{ instruction: "Implement." }]);
  const exhausted = { status: "active", health: { status: "failed" }, recovery: { exhausted: true } };
  assert.equal(emergencyStartProblem(queue, exhausted), null);
  assert.match(emergencyStartProblem(queue, { ...exhausted, recovery: { exhausted: false } }), /exhausts automatic recovery/);
  startNextAssignment(queue, "managed-start");
  assert.match(emergencyStartProblem(queue, exhausted), /no current attempt/);
});

test("no worker report closes a Goal; a passing review only completes the queue", () => {
  const queue = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [
    { instruction: "Implement." },
    { kind: "review", instruction: "Review." },
  ]);
  assert.equal("completionPolicy" in queue, false, "the queue carries no completion policy");
  assert.equal("designatedReview" in queue.assignments[1], false, "a review is a step like any other");
  const first = startNextAssignment(queue, "start-1").assignment;
  const implementation = submitWorkerReport(queue, first.id, { type: "implementation-result", status: "complete", summary: "Built.", evidenceRefs: ["abc"] }, { expectedRevision: queue.revision, idempotencyKey: "report-1" });
  assert.equal("closeGoal" in implementation, false);
  const review = startNextAssignment(queue, "start-2").assignment;
  const proved = submitWorkerReport(queue, review.id, { type: "review-result", verdict: "passed", goalRevision: "rev-1", summary: "Proved current behavior.", criteria: [{ id: "done", passed: true, evidenceRefs: ["test:focused"] }] }, { expectedRevision: queue.revision, idempotencyKey: "report-proved" });
  assert.equal("closeGoal" in proved, false, "the brain reads the note and runs tangent goal done itself");
  assert.equal(queue.status, "complete");
  const repeated = submitWorkerReport(queue, review.id, { type: "review-result", verdict: "passed", goalRevision: "rev-1", summary: "Proved current behavior.", criteria: [{ id: "done", passed: true, evidenceRefs: ["test:focused"] }] }, { expectedRevision: 1, idempotencyKey: "report-proved" });
  assert.equal(repeated.duplicate, true, "an exact retry wins over a now-stale expected revision");
  const implementationOnReview = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [{ kind: "review", instruction: "Review." }]);
  const only = startNextAssignment(implementationOnReview, "start-only").assignment;
  const accepted = submitWorkerReport(implementationOnReview, only.id, { type: "implementation-result", status: "done", summary: "Reviewed and fixed." }, { expectedRevision: implementationOnReview.revision, idempotencyKey: "report-any" });
  assert.equal(accepted.duplicate, false, "a review step takes any typed report");
});

test("Programs become quiet Operations and failures become problems", () => {
  assert.equal(operationFromProgram({ type: "process" }).mode, "service");
  assert.equal(operationFromProgram({ type: "command" }).state, "quiet");
  assert.equal(operationFromProgram({ type: "command", error: "manifest broken" }).state, "problem");
});

test("legacy data remains recoverable from a detached compressed export", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-audit-"));
  const output = path.join(root, "audit.json.gz");
  await exportLegacyAudit({ output, area: "otto/test", records: { generations: [{ id: 1 }], requests: [{ id: "r1" }] } });
  const payload = JSON.parse((await promisify(zlib.gunzip)(await readFile(output))).toString("utf8"));
  assert.equal(payload.area, "otto/test");
  assert.deepEqual(payload.records.generations, [{ id: 1 }]);
});
