import assert from "node:assert/strict";
import test from "node:test";

import { loadReportContextDiffs } from "../dist/report/context-diff.js";

test("loadReportContextDiffs skips cleanly when the variants' worktrees do not exist (nothing derivable)", async () => {
  const baseline = { caseId: "case-a", variantId: "baseline", worktree: "/tmp/tangent-report-fixture-does-not-exist/baseline", baseCommit: "HEAD" };
  const other = { caseId: "case-a", variantId: "with-search", worktree: "/tmp/tangent-report-fixture-does-not-exist/with-search", baseCommit: "HEAD" };
  const diffs = await loadReportContextDiffs(
    [
      { variant: baseline, metrics: undefined, evaluation: undefined },
      { variant: other, metrics: undefined, evaluation: undefined }
    ],
    "case-a::baseline"
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].variantKey, "case-a::with-search");
  assert.deepEqual(diffs[0].files, []);
});

test("loadReportContextDiffs returns an empty list when the baseline key does not match any sidecar", async () => {
  const other = { caseId: "case-a", variantId: "with-search", worktree: "/tmp/tangent-report-fixture-does-not-exist", baseCommit: "HEAD" };
  const diffs = await loadReportContextDiffs([{ variant: other, metrics: undefined, evaluation: undefined }], "case-a::missing");
  assert.deepEqual(diffs, []);
});
