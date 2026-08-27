import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { appendJournalEntry, appendMilestone, areaLineage, boundedBrainPrompt, brainActivationEnvelope, BRAIN_CHECKPOINT_LIMIT, BRAIN_PROMPT_LIMIT, BRAIN_STRUCTURAL_LIMIT, composeBrainPrompt, emergencyStartProblem, exportLegacyAudit, inheritedInstructionFiles, JOURNAL_LIMIT_BYTES, MILESTONE_SUMMARY_LIMIT, newGoalQueue, operationFromProgram, projectAreaMemory, querySubtreeMilestones, selectCurrentDocuments, startNextAssignment, submitWorkerReport } from "./area-brain-domain.mjs";

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

test("the reported 7648-character structure keeps controls and marks omitted records", () => {
  const reported = boundedBrainPrompt({ Reported: "x".repeat(7_635) });
  assert.equal(reported.length, 7_648, "the fixture pins the reported structural size");
  const structural = boundedBrainPrompt({
    Identity: "Exact Area identity.",
    Boundary: "Exact authority boundary.",
    "Execution contract": "Exact execution contract.",
    Wake: "Julian's current message stays exact.",
    "Work frontier": "Current Goal.",
    Questions: "Current question.",
    "Area memory": reported,
  }, BRAIN_STRUCTURAL_LIMIT, { required: ["Identity", "Boundary", "Execution contract", "Wake", "Work frontier", "Questions"] });
  assert.match(structural, /## Identity\n\nExact Area identity\./);
  assert.match(structural, /## Wake\n\nJulian's current message stays exact\./);
  assert.match(structural, /## Work frontier\n\nCurrent Goal\./);
  assert.match(structural, /## Questions\n\nCurrent question\./);
  assert.match(structural, /Structural sections omitted to fit the 6900-character budget: Area memory\./);
  const composed = composeBrainPrompt({ record: {}, generation: 1, structural });
  assert.ok(composed.generatedCharacters <= BRAIN_PROMPT_LIMIT);
});

test("activation keeps founding instruction and current checkpoint separate", () => {
  const envelope = brainActivationEnvelope({ foundingInstruction: { text: "Run the Area." }, checkpoint: { text: "Review Goal B." } }, 2);
  assert.match(envelope.text, /Standing authority\n\nRun the Area\./);
  assert.match(envelope.text, /Current checkpoint\n\nReview Goal B\./);
  assert.notEqual(envelope.instruction.hash, envelope.checkpoint.hash);
});

test("one budget covers the checkpoint and leaves only Julian's own message outside", () => {
  const record = {
    foundingInstruction: { text: "J".repeat(3_000) },
    checkpoint: { text: "C".repeat(20_000) },
  };
  const structural = boundedBrainPrompt({ Identity: "Portland brain", Work: "x".repeat(5_000) });
  const composed = composeBrainPrompt({ record, generation: 2, structural });
  assert.ok(composed.generatedCharacters <= BRAIN_PROMPT_LIMIT, `generated part is ${composed.generatedCharacters}`);
  assert.ok(composed.text.includes("J".repeat(3_000)), "Julian's founding instruction stays exact and outside the budget");
  assert.match(composed.text, /Checkpoint clipped by \d+ characters; run tangent brain status/);
  // A short structural part leaves the checkpoint its full allowance.
  const roomy = composeBrainPrompt({ record, generation: 2, structural: boundedBrainPrompt({ Identity: "Portland brain" }) });
  assert.equal(roomy.activation.checkpoint.characters, BRAIN_CHECKPOINT_LIMIT);
  assert.ok(roomy.activation.checkpoint.characters > composed.activation.checkpoint.characters, "a fuller frontier takes room from the checkpoint");
});

test("unbounded structural sections that cannot fit refuse to build a prompt", () => {
  assert.throws(
    () => composeBrainPrompt({ record: {}, generation: 1, structural: "x".repeat(7_900) }),
    /leave no room inside the 8000-character budget/,
  );
});

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

test("Area memory includes exact Purpose Current Knowledge and no ancestor Current", () => {
  const memory = projectAreaMemory([
    { area: "otto", file: "otto/otto.md", text: "## Purpose\nParent purpose.\n\n## Current\nPrivate current.\n\n## Knowledge\nParent knowledge." },
    { area: "otto/tangent", file: "otto/tangent/tangent.md", text: "## Purpose\nExact purpose.\nKeep its workflow coherent.\n\n## Current\nExact current.\n\n## Knowledge\nExact knowledge." },
  ]);
  assert.match(memory.text, /otto · Purpose/);
  assert.match(memory.text, /otto · Knowledge/);
  assert.doesNotMatch(memory.text, /Private current/);
  assert.match(memory.text, /Exact current/);
  assert.match(memory.text, /Keep its workflow coherent/);
  assert.ok(memory.text.indexOf("otto/tangent · Purpose") < memory.text.indexOf("otto · Purpose"), "exact Area memory precedes its nearest ancestor");
});

test("current Documents come from explicit open relationships, not recency", () => {
  const documents = new Map(Array.from({ length: 10 }, (_, index) => [`${index}.md`, { file: `${index}.md`, title: String(index), hash: `h${index}` }]));
  const selected = selectCurrentDocuments({
    goals: [{ file: "goal.md", status: "open", documents: ["2.md", "3.md", "4.md", "5.md", "6.md", "7.md", "8.md"] }, { file: "done.md", status: "done", documents: ["9.md"] }],
    requests: [{ id: "r1", status: "open", documents: ["0.md"] }],
    sourceInstruction: ["1.md"],
    /** Resolves one test reference. */
    resolve: (file) => documents.get(file),
  });
  assert.deepEqual(selected.map((item) => item.file), ["1.md", "2.md", "3.md", "4.md", "5.md", "6.md", "7.md", "8.md"]);
  assert.match(selected[0].reasons[0], /source instruction/);
});

test("current Documents exclude Parked and legacy Deferred Goal relationships", () => {
  const documents = new Map([
    ["open.md", { file: "open.md", title: "Open" }],
    ["parked.md", { file: "parked.md", title: "Parked" }],
    ["deferred.md", { file: "deferred.md", title: "Deferred" }],
  ]);
  const selected = selectCurrentDocuments({
    goals: [
      { file: "goal-open.md", status: "open", documents: ["open.md"] },
      { file: "goal-parked.md", status: "parked", documents: ["parked.md"] },
      { file: "goal-deferred.md", status: "deferred", documents: ["deferred.md"] },
    ],
    /** Resolves one test reference. */
    resolve: (file) => documents.get(file),
  });
  assert.deepEqual(selected.map((item) => item.file), ["open.md"]);
});

test("Journal intake saves exact text once before delivery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-brain-journal-"));
  const first = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  const again = await appendJournalEntry({ treesRoot: root, area: "otto/test", text: "Exact words.", idempotencyKey: "capture-1" });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal((await readFile(first.file, "utf8")).match(/Exact words\./g).length, 1);
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

test("only a designated passing review at the Goal revision can close", () => {
  const queue = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [
    { instruction: "Implement." },
    { kind: "review", instruction: "Review." },
  ]);
  const first = startNextAssignment(queue, "start-1").assignment;
  const implementation = submitWorkerReport(queue, first.id, { type: "implementation-result", status: "complete", summary: "Built.", evidenceRefs: ["abc"] }, { expectedRevision: queue.revision, idempotencyKey: "report-1" });
  assert.equal(implementation.closeGoal, false);
  const review = startNextAssignment(queue, "start-2").assignment;
  const stale = submitWorkerReport(queue, review.id, { type: "review-result", verdict: "passed", goalRevision: "old", summary: "The checks passed on an old revision.", criteria: [{ id: "done", passed: true, evidenceRefs: ["test"] }] }, { expectedRevision: queue.revision, idempotencyKey: "report-2" });
  assert.equal(stale.closeGoal, false);

  const validQueue = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [{ kind: "review", instruction: "Review." }]);
  const validReview = startNextAssignment(validQueue, "start-valid").assignment;
  assert.throws(() => submitWorkerReport(validQueue, validReview.id, { type: "review-result", verdict: "passed", goalRevision: "rev-1", summary: "Claimed pass without evidence.", criteria: [{ id: "done", passed: true, evidenceRefs: [] }] }, { expectedRevision: validQueue.revision, idempotencyKey: "report-empty" }), /invalid-review-criterion/);

  const provedQueue = newGoalQueue({ file: "goal-probe.md", revision: "rev-1", area: "otto/test" }, [{ kind: "review", instruction: "Review." }]);
  const provedReview = startNextAssignment(provedQueue, "start-proved").assignment;
  const proved = submitWorkerReport(provedQueue, provedReview.id, { type: "review-result", verdict: "passed", goalRevision: "rev-1", summary: "Proved current behavior.", criteria: [{ id: "done", passed: true, evidenceRefs: ["test:focused"] }] }, { expectedRevision: provedQueue.revision, idempotencyKey: "report-proved" });
  assert.equal(proved.closeGoal, true);
  assert.equal(provedQueue.status, "complete");
  const repeated = submitWorkerReport(provedQueue, provedReview.id, { type: "review-result", verdict: "passed", goalRevision: "rev-1", summary: "Proved current behavior.", criteria: [{ id: "done", passed: true, evidenceRefs: ["test:focused"] }] }, { expectedRevision: 1, idempotencyKey: "report-proved" });
  assert.equal(repeated.duplicate, true, "an exact retry wins over a now-stale expected revision");
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
