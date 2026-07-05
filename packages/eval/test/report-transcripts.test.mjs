import assert from "node:assert/strict";
import test from "node:test";

import { loadReportTranscripts } from "../dist/report/transcripts.js";

test("loadReportTranscripts yields an empty, notes-only row for a variant with no recorded conversation ids", async () => {
  const variant = { caseId: "case-a", variantId: "baseline", worktree: "/tmp/does-not-exist" };
  const rows = await loadReportTranscripts([{ variant, metrics: { conversations: [] }, evaluation: undefined }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].variantKey, "case-a::baseline");
  assert.deepEqual(rows[0].conversations, []);
  assert.deepEqual(rows[0].notes, []);
});

test("loadReportTranscripts notes when a variant has no metrics.json at all", async () => {
  const variant = { caseId: "case-a", variantId: "baseline", worktree: "/tmp/does-not-exist" };
  const rows = await loadReportTranscripts([{ variant, metrics: undefined, evaluation: undefined }]);
  assert.equal(rows[0].conversations.length, 0);
  assert.ok(rows[0].notes.some((note) => /No metrics\.json/.test(note)));
});
