import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { appendJournalEntry, appendMilestone, areaLineage, boundedBrainPrompt, exportLegacyAudit, inheritedInstructionFiles, JOURNAL_LIMIT_BYTES, newGoalQueue, operationFromProgram, querySubtreeMilestones, startNextAssignment } from "./area-brain-domain.mjs";

test("Area and repository knowledge inherit by path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-context-"));
  const leaf = path.join(root, "packages", "app");
  await mkdir(leaf, { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "root rule\n");
  await writeFile(path.join(root, "packages", "CLAUDE.md"), "package rule\n");
  assert.deepEqual(areaLineage("otto/tangent/shell"), ["otto", "otto/tangent", "otto/tangent/shell"]);
  assert.deepEqual((await inheritedInstructionFiles(root, leaf)).map((item) => path.relative(root, item.file)), ["AGENTS.md", "packages/CLAUDE.md"]);
});

test("the prompt limit fails visibly instead of clipping", () => {
  assert.equal(boundedBrainPrompt({ Identity: "Portland brain", Work: "One Goal" }).includes("Portland brain"), true);
  assert.throws(() => boundedBrainPrompt({ Identity: "x".repeat(8_001) }), /limit is 8000/);
});

test("Journal intake saves exact text once before delivery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-journal-"));
  const first = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  const again = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal((await readFile(first.file, "utf8")).match(/Exact words\./g).length, 1);
});

test("recent context is durable, idempotent, and scoped to the Area subtree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-milestones-"));
  await appendMilestone({ root, area: "otto/portland", kind: "journal", summary: "Neil owns Friday.", idempotencyKey: "one", now: "2026-08-25T01:00:00.000Z" });
  await appendMilestone({ root, area: "otto/portland/rules", kind: "goal-done", summary: "Rule 250 passed.", idempotencyKey: "two", now: "2026-08-25T02:00:00.000Z" });
  await appendMilestone({ root, area: "otto/other", kind: "journal", summary: "Noise.", idempotencyKey: "three", now: "2026-08-25T03:00:00.000Z" });
  await appendMilestone({ root, area: "otto/portland", kind: "journal", summary: "Duplicate.", idempotencyKey: "one" });
  const result = await querySubtreeMilestones({ root, area: "otto/portland", areas: ["otto/portland", "otto/portland/rules", "otto/other"] });
  assert.deepEqual(result.milestones.map((item) => item.summary), ["Rule 250 passed.", "Neil owns Friday."]);
});

test("one queue starts one assignment once", () => {
  const queue = newGoalQueue("goal-probe.md", [{ instruction: "Implement." }, { kind: "review", instruction: "Review." }]);
  const first = startNextAssignment(queue, "op-1");
  const duplicate = startNextAssignment(queue, "op-2");
  assert.equal(first.assignment.order, 1);
  assert.equal(duplicate.assignment.id, first.assignment.id);
  assert.equal(duplicate.duplicate, true);
});

test("Programs become quiet Operations and failures become problems", () => {
  assert.equal(operationFromProgram({ type: "process" }).mode, "service");
  assert.equal(operationFromProgram({ type: "command" }).state, "quiet");
  assert.equal(operationFromProgram({ type: "trigger", runtime: { error: "probe failed" } }).state, "problem");
});

test("legacy data remains recoverable from a detached compressed export", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-audit-"));
  const output = path.join(root, "audit.json.gz");
  await exportLegacyAudit({ output, area: "otto/test", records: { generations: [{ id: 1 }], requests: [{ id: "r1" }] } });
  const payload = JSON.parse((await promisify(zlib.gunzip)(await readFile(output))).toString("utf8"));
  assert.equal(payload.area, "otto/test");
  assert.deepEqual(payload.records.generations, [{ id: 1 }]);
});
