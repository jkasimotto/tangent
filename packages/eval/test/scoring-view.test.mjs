import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scoringView } from "../dist/server/scoring-view.js";
import { variantDir } from "../dist/core/run-store.js";

/** Creates a temp run directory for a scoringView test, and returns it plus a cleanup function. */
async function tempRunDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-eval-scoring-"));
  /** Removes the temp run directory created for this test. */
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

/** Builds a minimal manifest variant entry, the fields scoringView and its helpers actually read. */
function variant(caseId, variantId) {
  return {
    caseId,
    variantId,
    status: "done",
    branch: `eval/fixture/${caseId}/${variantId}`,
    repoRoot: "/tmp/does-not-exist",
    baseCommit: "base",
    workParent: "/tmp/does-not-exist/work",
    worktree: `/tmp/does-not-exist/${variantId}`,
    executionCwd: `/tmp/does-not-exist/${variantId}`,
    promptPath: "prompts/task.md",
    metricsPath: "metrics.json",
    context: { mode: "repo" },
    agent: { kind: "manual" },
    phases: [],
    warnings: []
  };
}

/** Writes a variant's evaluation.json fixture into its run-dir slot. */
async function writeEvaluation(manifest, caseId, variantId, evaluation) {
  const dir = variantDir(manifest, caseId, variantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "evaluation.json"), JSON.stringify(evaluation), "utf8");
}

/** Builds a passing/failing evaluation.json fixture from a per-criterion verdict map. */
function evaluationFixture(verdicts) {
  const criteria = Object.entries(verdicts).map(([id, passed]) => ({ id, statement: `statement-${id}`, points: 1, passed, reasoning: `reasoning-${id}` }));
  return {
    schema: "eval.evaluation.v1",
    caseId: "case-a",
    variantId: "x",
    model: "haiku",
    evaluatedAt: "2026-07-06T00:00:00.000Z",
    criteria,
    totalPoints: criteria.filter((c) => c.passed).length,
    maxPoints: criteria.length,
    warnings: []
  };
}

test("scoringView builds an N-way matrix for every variant in the case, with the named baseline flagged", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const manifest = {
      schema: "eval.run.v1",
      id: "fixture-run",
      name: "fixture-run",
      createdAt: "2026-07-06T00:00:00.000Z",
      runDir: dir,
      variants: [
        variant("case-a", "baseline"),
        variant("case-a", "v2"),
        variant("case-a", "v3"),
        variant("case-a", "v4")
      ]
    };
    await writeEvaluation(manifest, "case-a", "baseline", evaluationFixture({ x: true, y: true }));
    await writeEvaluation(manifest, "case-a", "v2", evaluationFixture({ x: true, y: false }));
    await writeEvaluation(manifest, "case-a", "v3", evaluationFixture({ x: true, y: true }));
    // v4 gets no evaluation.json, exercising the "missing sidecar" warning path.

    const view = await scoringView(manifest, "case-a");
    assert.equal(view.baselineKey, "case-a::baseline");
    assert.deepEqual(view.variants.map((column) => [column.variantId, column.isBaseline]), [
      ["baseline", true],
      ["v2", false],
      ["v3", false],
      ["v4", false]
    ]);
    assert.deepEqual(view.criteria.map((criterion) => criterion.id), ["y", "x"], "y disagrees across columns, so it sorts first");
    assert.ok(view.warnings.some((warning) => /v4.*no evaluation\.json/.test(warning)));
  } finally {
    await cleanup();
  }
});

test("scoringView falls back to the first variant as baseline when none is named 'baseline'", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const manifest = {
      schema: "eval.run.v1",
      id: "fixture-run",
      name: "fixture-run",
      createdAt: "2026-07-06T00:00:00.000Z",
      runDir: dir,
      variants: [variant("case-a", "first"), variant("case-a", "second")]
    };
    await writeEvaluation(manifest, "case-a", "first", evaluationFixture({ x: true }));
    await writeEvaluation(manifest, "case-a", "second", evaluationFixture({ x: false }));

    const view = await scoringView(manifest, "case-a");
    assert.equal(view.baselineKey, "case-a::first");
  } finally {
    await cleanup();
  }
});

test("scoringView scopes columns to the requested case, ignoring other cases in the same run", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const manifest = {
      schema: "eval.run.v1",
      id: "fixture-run",
      name: "fixture-run",
      createdAt: "2026-07-06T00:00:00.000Z",
      runDir: dir,
      variants: [variant("case-a", "baseline"), variant("case-b", "baseline")]
    };
    await writeEvaluation(manifest, "case-a", "baseline", evaluationFixture({ x: true }));
    await writeEvaluation(manifest, "case-b", "baseline", evaluationFixture({ x: false }));

    const view = await scoringView(manifest, "case-a");
    assert.equal(view.variants.length, 1);
    assert.equal(view.variants[0].variantId, "baseline");
  } finally {
    await cleanup();
  }
});

test("scoringView throws a 404-tagged error for a case with no variants", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const manifest = { schema: "eval.run.v1", id: "fixture-run", name: "fixture-run", createdAt: "2026-07-06T00:00:00.000Z", runDir: dir, variants: [] };
    await assert.rejects(scoringView(manifest, "missing-case"), (error) => error.status === 404);
  } finally {
    await cleanup();
  }
});
