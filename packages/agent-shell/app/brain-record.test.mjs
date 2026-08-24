import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BRAIN_SCHEMA,
  beginGeneration,
  brainForArea,
  brainOwnsArea,
  brainPath,
  brainSessionName,
  currentGeneration,
  deleteBrain,
  endBrain,
  latestHandover,
  newBrain,
  readAllBrains,
  readBrain,
  reclaimStoppedBrain,
  recordHandover,
  validateInstruction,
  writeBrain
} from "./brain-record.mjs";

const claude = { harness: "claude", model: "fable-5", effort: null };

/** A valid brain record for otto/tangent, with overrides. */
function sampleBrain(overrides = {}) {
  return newBrain({
    area: "otto/tangent",
    instruction: "Ship the Area map.",
    launch: claude,
    command: "claude --model claude-fable-5",
    label: "Claude · Fable 5",
    planFile: "otto/tangent/plan-tangent.md",
    ...overrides
  });
}

test("newBrain builds a running record with no generation", () => {
  const record = sampleBrain();
  assert.equal(record.schema, BRAIN_SCHEMA);
  assert.equal(record.status, "running");
  assert.equal(record.generation, 0);
  assert.equal(record.session, null);
  assert.deepEqual(record.generations, []);
  assert.deepEqual(record.launch, claude);
  assert.equal(record.planFile, "otto/tangent/plan-tangent.md");
});

test("validateInstruction rejects empty and overlong text", () => {
  assert.equal(validateInstruction("  "), "instruction is empty");
  assert.match(validateInstruction("x".repeat(4001)), /longer than 4000/);
  assert.equal(validateInstruction("Do the thing."), null);
  assert.throws(() => sampleBrain({ instruction: "" }), /instruction is empty/);
});

test("write and read round trip; readAllBrains walks the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brains-"));
  const record = sampleBrain();
  await writeBrain(root, record);
  const text = await readFile(brainPath(root, "otto/tangent"), "utf8");
  assert.equal(JSON.parse(text).area, "otto/tangent");
  const back = await readBrain(root, "otto/tangent");
  assert.equal(back.instruction, "Ship the Area map.");
  assert.ok(back.updatedAt);
  await writeBrain(root, sampleBrain({ area: "otto/dnd" }));
  const all = await readAllBrains(root);
  assert.deepEqual(all.map((item) => item.area), ["otto/dnd", "otto/tangent"]);
  await deleteBrain(root, "otto/dnd");
  assert.equal(await readBrain(root, "otto/dnd"), null);
  assert.deepEqual(await readAllBrains(path.join(root, "missing")), []);
});

test("beginGeneration numbers generations and points the record at the session", () => {
  const record = sampleBrain();
  const first = beginGeneration(record, "tangent--brain", "2026-08-17T10:00:00.000Z");
  assert.equal(first.generation, 1);
  assert.equal(record.generation, 1);
  assert.equal(record.session, "tangent--brain");
  assert.equal(currentGeneration(record), first);
  const second = beginGeneration(record, "tangent--brain--g2");
  assert.equal(second.generation, 2);
  assert.equal(record.session, "tangent--brain--g2");
  assert.equal(record.generations.length, 2);
  assert.equal(record.status, "running");
});

test("recordHandover keeps earlier text and stamps endedAt", () => {
  const record = sampleBrain();
  assert.throws(() => recordHandover(record, "x"), /no generation/);
  beginGeneration(record, "tangent--brain");
  recordHandover(record, "Wave 1 started.", "2026-08-17T11:00:00.000Z");
  recordHandover(record, "Wave 1 done.");
  const entry = currentGeneration(record);
  assert.equal(entry.handover, "Wave 1 started.\n\nWave 1 done.");
  assert.ok(entry.endedAt);
  assert.equal(latestHandover(record), "Wave 1 started.\n\nWave 1 done.");
});

test("latestHandover skips generations without a handover", () => {
  const record = sampleBrain();
  beginGeneration(record, "a");
  recordHandover(record, "first facts");
  beginGeneration(record, "b");
  assert.equal(latestHandover(record), "first facts");
  assert.equal(latestHandover(sampleBrain()), null);
});

test("endBrain sets ended or stopped and closes the generation", () => {
  const record = sampleBrain();
  beginGeneration(record, "a");
  endBrain(record, "stopped");
  assert.equal(record.status, "stopped");
  assert.ok(currentGeneration(record).endedAt);
  endBrain(record, "ended");
  assert.equal(record.status, "ended");
  assert.throws(() => endBrain(record, "paused"), /unknown brain end status/);
});

test("only a stopped brain can reclaim its exact live generation", () => {
  const stopped = sampleBrain();
  beginGeneration(stopped, "tangent-brain-g32");
  endBrain(stopped, "stopped");
  assert.equal(reclaimStoppedBrain(stopped), true);
  assert.equal(stopped.status, "running");
  assert.equal(currentGeneration(stopped).endedAt, null);

  const ended = sampleBrain();
  beginGeneration(ended, "tangent-brain-g33");
  endBrain(ended, "ended");
  assert.equal(reclaimStoppedBrain(ended), false);
  assert.equal(ended.status, "ended");
});

test("brainSessionName follows the leaf and generation rule", () => {
  assert.equal(brainSessionName("otto/tangent", 1), "tangent-brain");
  assert.equal(brainSessionName("otto/tangent", 3), "tangent-brain-g3");
  assert.equal(brainSessionName("neara/Hackathon Storm", 2), "hackathon-storm-brain-g2");
});

test("brainForArea finds the nearest running ancestor and ignores ended brains", () => {
  const parent = sampleBrain({ area: "otto" });
  const child = sampleBrain({ area: "otto/tangent" });
  const ended = endBrain(sampleBrain({ area: "otto/dnd" }), "ended");
  const records = [parent, child, ended];
  assert.equal(brainForArea(records, "otto/tangent/sub"), child);
  assert.equal(brainForArea(records, "otto/tangent"), child);
  assert.equal(brainForArea(records, "otto/other"), parent);
  assert.equal(brainForArea(records, "otto/dnd"), parent);
  assert.equal(brainForArea([ended], "otto/dnd"), null);
  assert.equal(brainForArea(records, "neara"), null);
  assert.equal(brainOwnsArea(records, "otto/tangent", "otto/tangent/sub"), true);
  assert.equal(brainOwnsArea(records, "otto", "otto/tangent/sub"), false, "the child cuts its territory out of the parent");
  endBrain(child, "stopped");
  assert.equal(brainOwnsArea(records, "otto", "otto/tangent/sub"), true, "ownership returns to the nearest running ancestor");
});
