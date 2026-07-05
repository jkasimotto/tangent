import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReportModel, loadReportModel, variantKey } from "../dist/report/model.js";
import { variantDir } from "../dist/core/run-store.js";
import { reportFixture } from "./report-fixtures.mjs";

/** Creates a temp run directory for a loadReportModel test, and returns it plus a cleanup function. */
async function tempRunDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-eval-report-"));
  /** Removes the temp run directory created for this test. */
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

test("buildReportModel picks the variant named baseline, sorts discriminating criteria first, and computes deltas", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });

  assert.equal(model.baselineKey, "case-a::baseline");
  assert.deepEqual(model.criteria.map((criterion) => criterion.id), ["read-docs", "no-regressions", "concise-diff"]);
  assert.equal(model.criteria[0].discriminating, true);
  assert.equal(model.criteria[1].discriminating, false);
  assert.equal(model.criteria[2].discriminating, false);

  const withSearch = model.variants.find((variant) => variant.variantId === "with-search");
  assert.deepEqual(withSearch.delta, { durationMs: -180000, tokensTotal: -14500, toolCallsTotal: -10, passCount: 1 });
  assert.equal(model.warnings.length, 0);
});

test("buildReportModel falls back to the first variant as baseline when none is named 'baseline'", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const renamed = sidecars.map((row) => ({ ...row, variant: { ...row.variant, variantId: row.variant.variantId === "baseline" ? "context-a" : "context-b" } }));
  const model = buildReportModel({ manifest, sidecars: renamed, taskSummary });
  assert.equal(model.baselineKey, variantKey(renamed[0].variant));
  assert.equal(model.variants[0].isBaseline, true);
  assert.equal(model.variants[1].isBaseline, false);
});

test("buildReportModel handles a variant with no evaluation.json: criteria are absent (not fabricated false), and a warning is recorded", () => {
  const { manifest, sidecars, taskSummary } = reportFixture({ withSearchEvaluation: false });
  const model = buildReportModel({ manifest, sidecars, taskSummary });

  const withSearch = model.variants.find((variant) => variant.variantId === "with-search");
  assert.equal(withSearch.evaluation, undefined);
  assert.equal(withSearch.delta.passCount, undefined);
  for (const criterion of model.criteria) {
    const cell = criterion.cells.find((candidate) => candidate.variantKey === withSearch.key);
    assert.equal(cell.passed, undefined);
  }
  // With only one variant carrying a verdict, nothing can disagree, so every row is non-discriminating.
  assert.ok(model.criteria.every((criterion) => criterion.discriminating === false));
  assert.ok(model.warnings.some((warning) => /with-search.*no evaluation\.json/.test(warning)));
});

test("loadReportModel reads metrics.json and evaluation.json off disk and matches the in-memory model", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const { manifest: fixtureManifest, sidecars, taskSummary } = reportFixture();
    const manifest = { ...fixtureManifest, runDir: dir, variants: sidecars.map((row) => row.variant) };

    for (const row of sidecars) {
      const variantPath = variantDir(manifest, row.variant.caseId, row.variant.variantId);
      await mkdir(variantPath, { recursive: true });
      await writeFile(path.join(variantPath, "metrics.json"), JSON.stringify(row.metrics), "utf8");
      await writeFile(path.join(variantPath, "evaluation.json"), JSON.stringify(row.evaluation), "utf8");
    }

    const loaded = await loadReportModel(manifest);
    const expected = buildReportModel({ manifest, sidecars, taskSummary });
    assert.deepEqual(loaded, expected);
  } finally {
    await cleanup();
  }
});

test("loadReportModel tolerates a variant with no evaluation.json on disk and reports it as a warning", async () => {
  const { dir, cleanup } = await tempRunDir();
  try {
    const { manifest: fixtureManifest, sidecars } = reportFixture();
    const manifest = { ...fixtureManifest, runDir: dir, variants: sidecars.map((row) => row.variant) };

    for (const row of sidecars) {
      const variantPath = variantDir(manifest, row.variant.caseId, row.variant.variantId);
      await mkdir(variantPath, { recursive: true });
      await writeFile(path.join(variantPath, "metrics.json"), JSON.stringify(row.metrics), "utf8");
      // Only the baseline gets an evaluation.json; with-search is left uncollected.
      if (row.variant.variantId === "baseline") {
        await writeFile(path.join(variantPath, "evaluation.json"), JSON.stringify(row.evaluation), "utf8");
      }
    }

    const loaded = await loadReportModel(manifest);
    const withSearch = loaded.variants.find((variant) => variant.variantId === "with-search");
    assert.equal(withSearch.evaluation, undefined);
    assert.ok(loaded.warnings.some((warning) => /with-search.*no evaluation\.json/.test(warning)));
  } finally {
    await cleanup();
  }
});
