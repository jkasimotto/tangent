import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PIPELINE_SCHEMA,
  appendSteps,
  currentStep,
  deletePipeline,
  newPipeline,
  nextPendingStep,
  pipelineFinished,
  pipelinePath,
  pipelineStatus,
  readAllPipelines,
  readPipeline,
  validateSteps,
  writePipeline
} from "./pipeline-record.mjs";

const claude = { harness: "claude", model: "fable-5", effort: null };

/** Two valid input steps used across tests. */
function sampleSteps() {
  return [
    { instruction: "/design this Goal.", launch: claude },
    { instruction: "Review the design.", command: "codex --model gpt-5.6-sol", continueFrom: 1 }
  ];
}

/** A hand-built record whose steps carry the given statuses and sessions. */
function recordWith(statuses, sessions = []) {
  return {
    schema: PIPELINE_SCHEMA,
    area: "otto/tangent",
    slug: "x",
    steps: statuses.map((status, i) => ({ index: i + 1, status, session: sessions[i] ?? null }))
  };
}

test("read and write round trip through the area path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  const record = newPipeline({
    goal: "otto/tangent/goal-agent-pipelines.md",
    area: "otto/tangent",
    slug: "agent-pipelines",
    steps: sampleSteps(),
    now: "2026-08-15T10:00:00.000Z"
  });
  const written = await writePipeline(root, record);
  assert.equal(written, record);
  assert.notEqual(record.updatedAt, "2026-08-15T10:00:00.000Z");
  assert.equal(record.createdAt, "2026-08-15T10:00:00.000Z");

  const file = pipelinePath(root, "otto/tangent", "agent-pipelines");
  assert.equal(file, path.join(root, "otto/tangent/agent-pipelines.json"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), record);
  assert.deepEqual(await readPipeline(root, "otto/tangent", "agent-pipelines"), record);

  const leftovers = (await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "atomic write leaves no tmp file");

  await deletePipeline(root, "otto/tangent", "agent-pipelines");
  assert.equal(await readPipeline(root, "otto/tangent", "agent-pipelines"), null);
  await deletePipeline(root, "otto/tangent", "agent-pipelines");
});

test("readAllPipelines walks every area and skips junk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  await writePipeline(root, newPipeline({ goal: "a.md", area: "otto/tangent", slug: "one", steps: sampleSteps() }));
  await writePipeline(root, newPipeline({ goal: "b.md", area: "neara/pgande", slug: "two", steps: sampleSteps() }));
  await writeFile(path.join(root, "otto/tangent/notes.txt"), "not json");
  await writeFile(path.join(root, "otto/tangent/broken.json"), "{ nope");
  const all = await readAllPipelines(root);
  assert.deepEqual(all.map((r) => `${r.area}/${r.slug}`).sort(), ["neara/pgande/two", "otto/tangent/one"]);
});

test("readAllPipelines is empty when the root is missing", async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), "pipelines-")), "missing");
  assert.deepEqual(await readAllPipelines(root), []);
});

test("readPipeline returns null for a missing or unparsable file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  assert.equal(await readPipeline(root, "otto/tangent", "nope"), null);
  await mkdir(path.join(root, "otto/tangent"), { recursive: true });
  await writeFile(pipelinePath(root, "otto/tangent", "bad"), "{");
  assert.equal(await readPipeline(root, "otto/tangent", "bad"), null);
});

test("validateSteps enforces the step count", () => {
  assert.equal(validateSteps([]), "a pipeline needs 1 to 20 steps");
  assert.equal(validateSteps(null), "a pipeline needs 1 to 20 steps");
  const many = Array.from({ length: 21 }, () => ({ instruction: "x", launch: claude }));
  assert.equal(validateSteps(many), "a pipeline needs 1 to 20 steps");
  assert.equal(validateSteps(many.slice(0, 20)), null);
});

test("validateSteps rejects empty and oversized instructions", () => {
  assert.equal(validateSteps([{ instruction: "ok", launch: claude }, { instruction: "  ", launch: claude }, { instruction: "", launch: claude }]), "step 2: instruction is empty");
  assert.equal(validateSteps([{ launch: claude }]), "step 1: instruction is empty");
  assert.equal(validateSteps([{ instruction: "x".repeat(2001), launch: claude }]), "step 1: instruction is longer than 2000 characters");
  assert.equal(validateSteps([{ instruction: "x".repeat(2000), launch: claude }]), null);
});

test("validateSteps requires a launch or a command", () => {
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b" }]), "step 2: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", launch: { harness: "" } }]), "step 1: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", launch: null, command: "  " }]), "step 1: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", command: "claude" }]), null);
  assert.equal(validateSteps([{ instruction: "a", launch: { harness: "codex" } }]), null);
});

test("validateSteps requires continueFrom to name an earlier step", () => {
  assert.equal(validateSteps([{ instruction: "a", launch: claude, continueFrom: 1 }]), "step 1: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 2 }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 0 }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: "1" }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 1 }]), null);
  assert.equal(validateSteps([{ instruction: "a", launch: claude, continueFrom: null }, { instruction: "b", launch: claude }]), null);
});

test("newPipeline normalizes steps into the pending shape", () => {
  const record = newPipeline({
    goal: "otto/tangent/goal-x.md",
    area: "otto/tangent",
    slug: "x",
    steps: [
      { instruction: "  /design this Goal.  ", launch: { harness: " claude ", model: "fable-5" }, command: "ignored" },
      { instruction: "Review.", command: "  codex --model sol ", continueFrom: 1 }
    ],
    now: "2026-08-15T10:00:00.000Z"
  });
  assert.equal(record.schema, "agent-pipeline.v1");
  assert.equal(record.goal, "otto/tangent/goal-x.md");
  assert.equal(record.createdAt, "2026-08-15T10:00:00.000Z");
  assert.equal(record.updatedAt, "2026-08-15T10:00:00.000Z");
  assert.deepEqual(record.extraFiles, []);
  assert.deepEqual(record.steps[0], {
    index: 1,
    instruction: "/design this Goal.",
    launch: { harness: "claude", model: "fable-5", effort: null },
    command: "",
    label: "",
    continueFrom: null,
    status: "pending",
    session: null,
    startedAt: null,
    endedAt: null,
    handover: null,
    handoverSource: null
  });
  assert.equal(record.steps[1].index, 2);
  assert.equal(record.steps[1].launch, null);
  assert.equal(record.steps[1].command, "codex --model sol");
  assert.equal(record.steps[1].continueFrom, 1);
});

test("newPipeline throws the validation message", () => {
  assert.throws(() => newPipeline({ goal: "g", area: "a", slug: "s", steps: [{ instruction: "" , launch: claude }] }), /step 1: instruction is empty/);
});

test("currentStep prefers running or stopped, then the first pending", () => {
  assert.equal(currentStep(recordWith(["complete", "running", "pending"])).index, 2);
  assert.equal(currentStep(recordWith(["complete", "stopped", "pending"])).index, 2);
  assert.equal(currentStep(recordWith(["complete", "skipped", "pending", "pending"])).index, 3);
  assert.equal(currentStep(recordWith(["complete", "skipped"])), null);
  assert.equal(currentStep({ steps: [] }), null);
});

test("nextPendingStep finds the first pending step after an index", () => {
  const record = recordWith(["complete", "skipped", "pending", "pending"]);
  assert.equal(nextPendingStep(record, 1).index, 3);
  assert.equal(nextPendingStep(record, 3).index, 4);
  assert.equal(nextPendingStep(record, 4), null);
  assert.equal(nextPendingStep(recordWith(["complete"]), 0), null);
});

test("pipelineStatus derives from step statuses and session liveness", () => {
  /** Every session is live. */
  const live = () => true;
  /** Every session is gone. */
  const dead = () => false;
  assert.equal(pipelineStatus(recordWith(["complete", "complete"]), live), "complete");
  assert.equal(pipelineStatus(recordWith(["complete", "skipped"]), live), "complete");
  assert.equal(pipelineStatus(recordWith(["complete", "running", "pending"], [null, "s2"]), live), "running");
  assert.equal(pipelineStatus(recordWith(["complete", "running", "pending"], [null, "s2"]), dead), "stopped");
  assert.equal(pipelineStatus(recordWith(["complete", "stopped", "pending"]), live), "stopped");
  assert.equal(pipelineStatus(recordWith(["pending", "pending"]), live), "pending");
  const asked = [];
  pipelineStatus(recordWith(["complete", "running"], [null, "s2"]), (name) => { asked.push(name); return true; });
  assert.deepEqual(asked, ["s2"]);
});

test("appendSteps adds pending steps after the ones that already ran", () => {
  const record = newPipeline({ goal: "g", area: "otto/tangent", slug: "x", steps: sampleSteps(), now: "2026-08-16T10:00:00.000Z" });
  record.steps[0].status = "complete";
  record.steps[0].handover = "Design written.";
  record.steps[1].status = "running";
  record.steps[1].session = "tangent--x--s2";
  const added = appendSteps(record, [
    { instruction: "  Prove it.  ", launch: claude, continueFrom: 2 },
    { instruction: "Ship it.", command: "codex" }
  ]);
  assert.equal(record.steps.length, 4);
  assert.deepEqual(added.map((step) => [step.index, step.status, step.instruction, step.continueFrom]), [[3, "pending", "Prove it.", 2], [4, "pending", "Ship it.", null]]);
  assert.equal(record.steps[2], added[0]);
  // What already ran is untouched.
  assert.equal(record.steps[0].status, "complete");
  assert.equal(record.steps[0].handover, "Design written.");
  assert.equal(record.steps[1].session, "tangent--x--s2");
});

test("appendSteps validates the new steps in their final numbering", () => {
  const record = newPipeline({ goal: "g", area: "a", slug: "s", steps: sampleSteps() });
  assert.throws(() => appendSteps(record, []), /at least one step/);
  assert.throws(() => appendSteps(record, [{ instruction: "", launch: claude }]), /step 3: instruction is empty/);
  assert.throws(() => appendSteps(record, [{ instruction: "x", launch: claude, continueFrom: 3 }]), /step 3: continueFrom must name an earlier step/);
  assert.throws(() => appendSteps(record, [{ instruction: "x" }]), /step 3: needs a launch or a command/);
  const full = newPipeline({ goal: "g", area: "a", slug: "s", steps: Array.from({ length: 20 }, () => ({ instruction: "x", launch: claude })) });
  assert.throws(() => appendSteps(full, [{ instruction: "one more", launch: claude }]), /1 to 20 steps/);
  assert.equal(record.steps.length, 2, "a rejected append leaves the record as it was");
});

test("pipelineFinished is true only when every step is complete or skipped", () => {
  assert.equal(pipelineFinished(recordWith(["complete", "skipped"])), true);
  assert.equal(pipelineFinished(recordWith(["complete", "running"])), false);
  assert.equal(pipelineFinished(recordWith(["complete", "pending"])), false);
  assert.equal(pipelineFinished(recordWith(["complete", "stopped"])), false);
  assert.equal(pipelineFinished({ steps: [] }), false);
});
