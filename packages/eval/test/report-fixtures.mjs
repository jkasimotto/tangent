// Shared fixture builders for the report renderer tests (report-model, report-markdown,
// report-html). Not itself a *.test.mjs file, so `node --test test/*.test.mjs` does not try to run it
// as a suite; it exists purely to keep the three test files from each hand-rolling the same run.

/**
 * Builds the fabricated manifest, two variants, and their metrics/evaluation sidecars used across the
 * report renderer tests: two variants (`baseline`, `with-search`) and three criteria where exactly one
 * (`read-docs`) has variants disagree. `withSearchEvaluation: false` drops the second variant's
 * evaluation.json to exercise the "missing sidecar" path.
 */
export function reportFixture(options = {}) {
  const includeSearchEvaluation = options.withSearchEvaluation !== false;

  const manifest = {
    id: "20260706t000000-fixture",
    name: "fixture-eval",
    createdAt: "2026-07-06T00:00:00.000Z",
    spec: {
      schema: "eval.spec.v1",
      name: "fixture-eval",
      cases: [{ id: "case-a", prompt: "Read docs/index.md before grepping for the entry point.", variants: [] }],
      evaluator: {
        model: "haiku",
        criteria: [
          { id: "no-regressions", statement: "Did not break existing tests." },
          { id: "read-docs", statement: "Read docs/index.md before searching." },
          { id: "concise-diff", statement: "Kept the diff minimal." }
        ]
      },
      markId: "20260705t143012-read-docs-first"
    }
  };

  const baselineVariant = {
    caseId: "case-a",
    variantId: "baseline",
    repoRoot: "/Users/example/project",
    branch: "dev/fixture",
    worktree: "/tmp/does-not-exist/baseline"
  };
  const searchVariant = {
    caseId: "case-a",
    variantId: "with-search",
    repoRoot: "/Users/example/project",
    branch: "dev/fixture",
    worktree: "/tmp/does-not-exist/with-search"
  };

  const baselineMetrics = {
    schema: "eval.metrics.v1",
    status: "done",
    time: { durationMs: 370000 },
    tokens: { total: 42000 },
    tools: { total: 24, byCategory: { file_read: 10, file_search: 8, command: 6 } },
    conversations: []
  };
  const searchMetrics = {
    schema: "eval.metrics.v1",
    status: "done",
    time: { durationMs: 190000 },
    tokens: { total: 27500 },
    tools: { total: 14, byCategory: { file_read: 6, file_search: 2, command: 6 } },
    conversations: []
  };

  const baselineEvaluation = {
    schema: "eval.evaluation.v1",
    model: "haiku",
    criteria: [
      { id: "no-regressions", statement: "Did not break existing tests.", points: 1, passed: true, reasoning: "Test suite passed." },
      { id: "read-docs", statement: "Read docs/index.md before searching.", points: 1, passed: false, reasoning: "Grepped for six minutes before opening docs/index.md." },
      { id: "concise-diff", statement: "Kept the diff minimal.", points: 1, passed: true, reasoning: "Diff touched only the two relevant files." }
    ],
    totalPoints: 2,
    maxPoints: 3
  };
  const searchEvaluation = {
    schema: "eval.evaluation.v1",
    model: "haiku",
    criteria: [
      { id: "no-regressions", statement: "Did not break existing tests.", points: 1, passed: true, reasoning: "Test suite passed." },
      { id: "read-docs", statement: "Read docs/index.md before searching.", points: 1, passed: true, reasoning: "Opened docs/index.md first via the search tool." },
      { id: "concise-diff", statement: "Kept the diff minimal.", points: 1, passed: true, reasoning: "Diff touched only the two relevant files." }
    ],
    totalPoints: 3,
    maxPoints: 3
  };

  const sidecars = [
    { variant: baselineVariant, metrics: baselineMetrics, evaluation: baselineEvaluation },
    { variant: searchVariant, metrics: searchMetrics, evaluation: includeSearchEvaluation ? searchEvaluation : undefined }
  ];

  return { manifest, sidecars, taskSummary: "Read docs/index.md before grepping for the entry point." };
}
