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
  normalizeBrainRecord,
  readAllBrains,
  readBrain,
  validateInstruction,
  writeBrain
} from "./brain-record.mjs";

const claude = { harness: "claude", model: "fable-5", effort: null };

/** A valid brain record for otto/tangent, with overrides. */
function sampleBrain(overrides = {}) {
  return newBrain({
    area: "otto/tangent",
    instruction: "Ship the Area map.",
    planFile: "otto/tangent/plan-tangent.md",
    ...overrides
  });
}

test("newBrain builds an active logical record with founding instruction", () => {
  const record = sampleBrain();
  assert.equal(record.schema, BRAIN_SCHEMA);
  assert.equal(record.status, "active");
  assert.equal(record.foundingInstruction.text, "Ship the Area map.");
  assert.equal(record.checkpoint, null);
  assert.equal(record.generation, 0);
  assert.equal(record.session, null);
  assert.deepEqual(record.generations, []);
  assert.equal("resolvedLaunch" in record, false, "policy never appears at the record top level");
  assert.equal(record.planFile, "otto/tangent/plan-tangent.md");
});

test("validateInstruction rejects empty and overlong text", () => {
  assert.equal(validateInstruction("  "), "instruction is empty");
  assert.match(validateInstruction("x".repeat(4001)), /longer than 4000/);
  assert.equal(validateInstruction("Do the thing."), null);
  assert.throws(() => sampleBrain({ instruction: "" }), /instruction is empty/);
});

test("legacy records normalize into active or inactive logical lifecycle", () => {
  const legacy = normalizeBrainRecord({
    schema: "area-brain.v1", area: "otto/tangent", instruction: "Found it.", status: "running", session: "brain",
    launch: { harness: "codex", model: "luna", effort: "low" }, command: "codex --model luna --effort low", label: "Codex · Luna · Low",
    generations: [{ generation: 1, session: "brain", startedAt: "2026-08-01T00:00:00.000Z" }],
  });
  assert.equal(legacy.schema, BRAIN_SCHEMA);
  assert.equal(legacy.status, "active");
  assert.equal(legacy.foundingInstruction.text, "Found it.");
  assert.equal("launch" in legacy, false);
  assert.equal("command" in legacy, false);
  assert.equal("resolvedLaunch" in legacy, false);
  assert.deepEqual(legacy.generations[0].resolvedLaunch.ref, { harness: "codex", model: "luna", effort: "low" });
  assert.equal(legacy.generations[0].resolvedLaunch.mode, "legacy");
  assert.equal(normalizeBrainRecord({ ...legacy, schema: "area-brain.v1", status: "stopped" }).status, "inactive");
});

test("write and read round trip; readAllBrains walks the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brains-"));
  const record = sampleBrain();
  await writeBrain(root, record);
  const text = await readFile(brainPath(root, "otto/tangent"), "utf8");
  assert.equal(JSON.parse(text).area, "otto/tangent");
  const back = await readBrain(root, "otto/tangent");
  assert.equal(back.foundingInstruction.text, "Ship the Area map.");
  assert.ok(back.updatedAt);
  await writeBrain(root, sampleBrain({ area: "otto/dnd" }));
  const all = await readAllBrains(root);
  assert.deepEqual(all.map((item) => item.area), ["otto/dnd", "otto/tangent"]);
  await deleteBrain(root, "otto/dnd");
  assert.equal(await readBrain(root, "otto/dnd"), null);
  assert.deepEqual(await readAllBrains(path.join(root, "missing")), []);
});

const resolved = { ref: claude, label: "Claude · Fable 5", command: "claude --model claude-fable-5", sourceArea: "otto", mode: "brain" };

test("beginGeneration numbers generations and points the record at the session", () => {
  const record = sampleBrain();
  const first = beginGeneration(record, "tangent--brain", resolved, "2026-08-17T10:00:00.000Z");
  assert.equal(first.generation, 1);
  assert.equal(record.generation, 1);
  assert.equal(record.session, "tangent--brain");
  assert.equal(currentGeneration(record), first);
  const override = { ref: { harness: "codex", model: "sol", effort: "high" }, label: "Codex · Sol · High", command: "codex --model sol --effort high", sourceArea: null, mode: "override" };
  const second = beginGeneration(record, "tangent--brain--g2", override);
  assert.equal(second.generation, 2);
  assert.equal(record.session, "tangent--brain--g2");
  assert.equal(record.generations.length, 2);
  assert.equal(record.status, "active");
  assert.equal("resolvedLaunch" in record, false);
  assert.deepEqual(first.resolvedLaunch, resolved, "an earlier attempt keeps its original launch snapshot");
  assert.deepEqual(currentGeneration(record).resolvedLaunch, override);
  override.command = "changed after the generation began";
  override.ref.model = "changed";
  assert.equal(currentGeneration(record).resolvedLaunch.command, "codex --model sol --effort high");
  assert.equal(currentGeneration(record).resolvedLaunch.ref.model, "sol");
});

test("latestHandover skips generations without a handover", () => {
  const record = sampleBrain();
  beginGeneration(record, "a", resolved);
  currentGeneration(record).handover = "first facts";
  beginGeneration(record, "b", resolved);
  assert.equal(latestHandover(record), "first facts");
  assert.equal(latestHandover(sampleBrain()), null);
});

test("endBrain makes the logical brain inactive and closes the attempt", () => {
  const record = sampleBrain();
  beginGeneration(record, "a", resolved);
  endBrain(record, "stopped");
  assert.equal(record.status, "inactive");
  assert.ok(currentGeneration(record).endedAt);
  endBrain(record, "ended");
  assert.equal(record.status, "inactive");
  assert.throws(() => endBrain(record, "paused"), /unknown brain end status/);
});

test("brainSessionName follows the leaf and generation rule", () => {
  assert.equal(brainSessionName("otto/tangent", 1), "tangent-brain");
  assert.equal(brainSessionName("otto/tangent", 3), "tangent-brain-g3");
  assert.equal(brainSessionName("neara/Hackathon Storm", 2), "hackathon-storm-brain-g2");
});

test("currentGeneration follows a rolled-back logical pointer before the diagnostic tail", () => {
  const record = newBrain({ area: "otto/tangent", instruction: "Own it.", planFile: "otto/tangent/plan.md" });
  const launch = { ref: { harness: "claude", model: null, effort: null }, label: "Claude", command: "claude", sourceArea: null, mode: "brain" };
  beginGeneration(record, "tangent-brain", launch);
  beginGeneration(record, "tangent-brain-g2", launch);
  record.generation = 1;
  record.session = "tangent-brain";
  record.currentAttemptId = "tangent-brain";
  assert.equal(currentGeneration(record)?.session, "tangent-brain");
});

test("brainSessionName preserves brain generation suffixes for long Area leaves", () => {
  const area = `otto/${"standards-architecture-names-shapes-and-ownership-".repeat(2)}`;
  const first = brainSessionName(area, 1);
  const second = brainSessionName(area, 2);
  const tenth = brainSessionName(area, 10);

  assert.equal(first.length, 60);
  assert.equal(second.length, 60);
  assert.equal(tenth.length, 60);
  assert.match(first, /-brain$/);
  assert.match(second, /-brain-g2$/);
  assert.match(tenth, /-brain-g10$/);
  assert.notEqual(first, second);
  assert.notEqual(second, tenth);
});

test("brainForArea grants authority only to the exact active brain", () => {
  const parent = sampleBrain({ area: "otto" });
  const child = sampleBrain({ area: "otto/tangent" });
  const ended = endBrain(sampleBrain({ area: "otto/dnd" }), "ended");
  const records = [parent, child, ended];
  assert.equal(brainForArea(records, "otto/tangent/sub"), null);
  assert.equal(brainForArea(records, "otto/tangent"), child);
  assert.equal(brainForArea(records, "otto/other"), null);
  assert.equal(brainForArea(records, "otto/dnd"), null);
  assert.equal(brainForArea([ended], "otto/dnd"), null);
  assert.equal(brainForArea(records, "neara"), null);
  assert.equal(brainOwnsArea(records, "otto/tangent", "otto/tangent/sub"), false);
  assert.equal(brainOwnsArea(records, "otto/tangent", "otto/tangent"), true);
  endBrain(child, "stopped");
  assert.equal(brainOwnsArea(records, "otto/tangent", "otto/tangent"), false);
});
