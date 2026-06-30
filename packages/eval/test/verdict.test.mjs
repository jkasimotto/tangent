// packages/eval/test/verdict.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseJudgeVerdict } from "../dist/core/verdict.js";

const ctx = {
  caseId: "c", variantId: "v", model: "m", now: "2026-06-30T00:00:00.000Z",
  criteria: [{ id: "a", statement: "loaded skill", points: 2 }, { id: "b", statement: "ran tests" }]
};

test("parses a fenced JSON verdict and scores it", () => {
  const raw = "Here is my assessment:\n```json\n" +
    JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "loaded it" }, { id: "b", passed: false, reasoning: "no tests" }] }) +
    "\n```";
  const e = parseJudgeVerdict(raw, ctx);
  assert.equal(e.schema, "eval.evaluation.v1");
  assert.equal(e.maxPoints, 3);
  assert.equal(e.totalPoints, 2);
  assert.equal(e.criteria.find((c) => c.id === "a").passed, true);
  assert.equal(e.criteria.find((c) => c.id === "b").points, 1);
  assert.equal(e.warnings.length, 0);
});

test("an omitted criterion fails closed with a warning", () => {
  const raw = JSON.stringify({ criteria: [{ id: "a", passed: true, reasoning: "ok" }] });
  const e = parseJudgeVerdict(raw, ctx);
  assert.equal(e.criteria.find((c) => c.id === "b").passed, false);
  assert.equal(e.totalPoints, 2);
  assert.ok(e.warnings.some((w) => /b/.test(w)));
});

test("unparseable output yields zero scores and a warning, never throws", () => {
  const e = parseJudgeVerdict("the model rambled with no json", ctx);
  assert.equal(e.totalPoints, 0);
  assert.equal(e.maxPoints, 3);
  assert.equal(e.criteria.length, 2);
  assert.ok(e.warnings.length >= 1);
});

test("reasoning containing a } character does not truncate JSON and still scores correctly", () => {
  const raw = JSON.stringify({
    criteria: [
      { id: "a", passed: true, reasoning: "the function returns {value} correctly" },
      { id: "b", passed: true, reasoning: "no issues found" }
    ]
  });
  const e = parseJudgeVerdict(raw, ctx);
  assert.equal(e.totalPoints, 3);
  assert.equal(e.criteria.find((c) => c.id === "a").passed, true);
  assert.equal(e.criteria.find((c) => c.id === "b").passed, true);
  assert.equal(e.warnings.length, 0);
});
