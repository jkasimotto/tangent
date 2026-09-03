import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { newPipeline, pipelinePath, readAllJobEvidence, writePipeline } from "./job-record.mjs";

test("reads valid complete Job evidence and reports malformed records instead of a false empty result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "job-evidence-"));
  const record = newPipeline({
    goal: "otto/tangent/goal-map.md",
    area: "otto/tangent",
    slug: "map",
    steps: [{ instruction: "Implement.", launch: { harness: "codex", model: "gpt-5.6-sol", effort: "high" } }],
    now: "2026-09-01T00:00:00.000Z",
  });
  await writePipeline(root, record);
  const malformed = pipelinePath(root, "otto/tangent", "broken");
  await mkdir(path.dirname(malformed), { recursive: true });
  await writeFile(malformed, "{not-json", "utf8");

  const result = await readAllJobEvidence(root);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].runs.length, 1);
  assert.deepEqual(result.problems, [{ file: malformed, code: "job-record-malformed", message: "The Job evidence file is malformed.", retryable: false }]);
});
