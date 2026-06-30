import assert from "node:assert/strict";
import test from "node:test";
import { composeJudgePrompt, evaluateVariant } from "../dist/core/evaluator.js";

test("composeJudgePrompt includes the rubric, contract, diff and transcript", () => {
  const p = composeJudgePrompt({ criteria: [{ id: "a", statement: "loaded skill", points: 1 }], diff: "DIFFTEXT", transcript: "TRANSCRIPTTEXT" });
  assert.match(p, /loaded skill/);
  assert.match(p, /"criteria"/);
  assert.match(p, /DIFFTEXT/);
  assert.match(p, /TRANSCRIPTTEXT/);
});

test("evaluateVariant scores via an injected judge stub", async () => {
  const evaluator = { model: "judge-model", criteria: [{ id: "a", statement: "x", points: 2 }] };
  const variant = { caseId: "c", variantId: "v", worktree: "/tmp/x", baseCommit: "BASE", metricsPath: "/nope.json" };
  const deps = {
    /** Stub that returns an empty conversation set. */
    reconstruct: async () => ({ conversations: [], notes: [] }),
    /** Stub that returns a fixed diff string. */
    diff: async () => "diff body",
    /** Stub judge that returns a passing verdict for criterion a. */
    runJudge: async () => JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] })
  };
  const e = await evaluateVariant({ runDir: "/tmp" }, variant, evaluator, "2026-06-30T00:00:00.000Z", deps);
  assert.equal(e.totalPoints, 2);
  assert.equal(e.model, "judge-model");
});

test("evaluateVariant never throws: a judge error becomes a warning", async () => {
  const evaluator = { model: "m", criteria: [{ id: "a", statement: "x" }] };
  const variant = { caseId: "c", variantId: "v", worktree: "/tmp/x", baseCommit: "BASE", metricsPath: "/nope.json" };
  const deps = {
    /** Stub that returns an empty conversation set. */
    reconstruct: async () => ({ conversations: [], notes: [] }),
    /** Stub that returns a minimal diff. */
    diff: async () => "d",
    /** Stub judge that always throws to simulate failure. */
    runJudge: async () => { throw new Error("boom"); }
  };
  const e = await evaluateVariant({ runDir: "/tmp" }, variant, evaluator, "2026-06-30T00:00:00.000Z", deps);
  assert.equal(e.totalPoints, 0);
  assert.equal(e.maxPoints, 1);
  assert.ok(e.warnings.some((w) => /boom/.test(w)));
});
