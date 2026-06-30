import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateAndWrite } from "../dist/core/metrics.js";
import { variantDir } from "../dist/core/run-store.js";

test("evaluateAndWrite writes evaluation.json when the spec has an evaluator", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "eval-run-"));
  const manifest = { runDir, spec: { evaluator: { model: "m", criteria: [{ id: "a", statement: "x", points: 2 }] } } };
  const variant = { caseId: "c", variantId: "v", worktree: runDir, baseCommit: "B" };
  await mkdir(variantDir(manifest, "c", "v"), { recursive: true });
  const deps = {
    /** Stub that returns an empty conversation set. */
    reconstruct: async () => ({ conversations: [], notes: [] }),
    /** Stub that returns a fixed diff string. */
    diff: async () => "d",
    /** Stub judge that returns a passing verdict for criterion a. */
    runJudge: async () => JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] })
  };
  await evaluateAndWrite(manifest, variant, "2026-06-30T00:00:00.000Z", deps);
  const written = JSON.parse(await readFile(path.join(variantDir(manifest, "c", "v"), "evaluation.json"), "utf8"));
  assert.equal(written.schema, "eval.evaluation.v1");
  assert.equal(written.totalPoints, 2);
});

test("evaluateAndWrite is a no-op without an evaluator block", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "eval-run-"));
  const manifest = { runDir, spec: {} };
  const variant = { caseId: "c", variantId: "v", worktree: runDir, baseCommit: "B" };
  await mkdir(variantDir(manifest, "c", "v"), { recursive: true });
  await evaluateAndWrite(manifest, variant, "2026-06-30T00:00:00.000Z");
  await assert.rejects(readFile(path.join(variantDir(manifest, "c", "v"), "evaluation.json"), "utf8"));
});
