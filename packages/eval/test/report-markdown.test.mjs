import assert from "node:assert/strict";
import test from "node:test";

import { buildReportModel } from "../dist/report/model.js";
import { renderMarkdownReport } from "../dist/report/markdown.js";
import { reportFixture } from "./report-fixtures.mjs";

const EXPECTED_MARKDOWN = `# Read docs/index.md before grepping for the entry point.

Run \`20260706t000000-fixture\` (fixture-eval), created 2026-07-06T00:00:00.000Z.
Repo: \`/Users/example/project\` (dev/fixture)
Mark: \`20260705t143012-read-docs-first\`

## Verdict matrix

| Criterion | baseline (baseline) | with-search |
| --- | --- | --- |
| Read docs/index.md before searching. | ❌ | ✅ |
| Did not break existing tests. | ✅ | ✅ |
| Kept the diff minimal. | ✅ | ✅ |

## Variants

| Variant | Pass rate | Wall time | Tokens | Tool calls |
| --- | --- | --- | --- | --- |
| baseline (baseline) | 2/3 | 6m 10s | 42.0k | 24 |
| with-search | 3/3 | 3m 10s | 27.5k | 14 |

## Deltas vs baseline

| Variant | Wall time | Tokens | Tool calls | Pass count |
| --- | --- | --- | --- | --- |
| with-search | -3m 00s | -14.5k | -10 | +1 |
`;

const EXPECTED_MARKDOWN_MISSING_EVALUATION = `# Read docs/index.md before grepping for the entry point.

Run \`20260706t000000-fixture\` (fixture-eval), created 2026-07-06T00:00:00.000Z.
Repo: \`/Users/example/project\` (dev/fixture)
Mark: \`20260705t143012-read-docs-first\`

## Verdict matrix

| Criterion | baseline (baseline) | with-search |
| --- | --- | --- |
| Did not break existing tests. | ✅ | n/a |
| Read docs/index.md before searching. | ❌ | n/a |
| Kept the diff minimal. | ✅ | n/a |

## Variants

| Variant | Pass rate | Wall time | Tokens | Tool calls |
| --- | --- | --- | --- | --- |
| baseline (baseline) | 2/3 | 6m 10s | 42.0k | 24 |
| with-search | - | 3m 10s | 27.5k | 14 |

## Deltas vs baseline

| Variant | Wall time | Tokens | Tool calls | Pass count |
| --- | --- | --- | --- | --- |
| with-search | -3m 00s | -14.5k | -10 | - |

## Warnings

- with-search: no evaluation.json (no rubric scoring for this variant).
`;

test("renderMarkdownReport matches the golden output for two variants with one discriminating criterion", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  assert.equal(renderMarkdownReport(model), EXPECTED_MARKDOWN);
});

test("renderMarkdownReport matches the golden output when a variant has no evaluation.json", () => {
  const { manifest, sidecars, taskSummary } = reportFixture({ withSearchEvaluation: false });
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  assert.equal(renderMarkdownReport(model), EXPECTED_MARKDOWN_MISSING_EVALUATION);
});

test("renderMarkdownReport never emits HTML tags", () => {
  const { manifest, sidecars, taskSummary } = reportFixture();
  const model = buildReportModel({ manifest, sidecars, taskSummary });
  assert.doesNotMatch(renderMarkdownReport(model), /<[a-z][a-z0-9]*[ >]/i);
});
