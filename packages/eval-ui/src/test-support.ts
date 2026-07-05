import { vi } from "vitest";

import type {
  EvalCompareView,
  EvalDiffView,
  EvalEvaluationView,
  EvalRunDetailView,
  EvalScoringCriterion,
  EvalScoringView,
  EvalUiClient,
  EvalVariantMetricsView,
  EvalVariantSummaryView
} from "./client.js";

/** Creates a deterministic client for app rendering tests. */
export function fakeEvalClient(overrides?: { artifacts?: EvalCompareView["artifacts"]; codeDiff?: EvalDiffView; missingRunId?: string; secondRunId?: string }): EvalUiClient {
  /** Builds a deterministic evaluator score for a variant. */
  const evaluation = (totalPoints: number): EvalEvaluationView => ({
    model: "judge",
    totalPoints,
    maxPoints: 3,
    criteria: [
      { id: "a", statement: "loaded skill", points: 2, passed: totalPoints >= 2, reasoning: totalPoints >= 2 ? "did load it" : "skipped" },
      { id: "b", statement: "ran tests", points: 1, passed: totalPoints === 3, reasoning: totalPoints === 3 ? "ran" : "skipped" }
    ],
    warnings: []
  });
  /** Builds a deterministic output-metrics summary for a variant. */
  const metrics = (durationMs: number, peak: number): EvalVariantMetricsView => ({
    durationMs,
    activeAgentDurationMs: durationMs,
    tokensTotal: peak * 2,
    peakContextTokens: peak,
    filesChanged: 1,
    filesRead: 3,
    diffStat: "1 file changed",
    conversationIds: ["conv-1"],
    sparkline: { durationMs, tokensTotal: peak, buckets: [{ kind: "assistant", tokenShare: 1, durationShare: 1 }] }
  });
  const run: EvalRunDetailView = {
    id: "run1",
    name: "ui-compare",
    createdAt: "2026-06-16T10:00:00.000Z",
    runDir: "/tmp/run1",
    variantCount: 2,
    caseCount: 1,
    statuses: { prepared: 0, running: 0, done: 2, failed: 0, manual: 0, cancelled: 0 },
    cases: [{
      id: "task",
      variants: [{
        caseId: "task",
        variantId: "empty",
        label: "task/empty",
        status: "done",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "empty" },
        branch: "eval/run1/task/empty",
        worktree: "/tmp/empty",
        executionCwd: "/tmp/empty",
        baseCommit: "base",
        contextCommit: "empty-context",
        phases: [{ id: "implement", status: "done" }],
        promptArtifacts: [],
        metrics: metrics(12000, 42000),
        evaluation: evaluation(2),
        warnings: []
      }, {
        caseId: "task",
        variantId: "repo",
        label: "task/repo",
        status: "done",
        agent: { kind: "codex-cli", model: "fake", sandbox: "workspace-write" },
        model: "fake",
        context: { mode: "repo" },
        branch: "eval/run1/task/repo",
        worktree: "/tmp/repo",
        executionCwd: "/tmp/repo",
        baseCommit: "base",
        contextCommit: "repo-context",
        phases: [{ id: "implement", status: "done" }],
        promptArtifacts: [],
        metrics: metrics(9000, 51000),
        evaluation: evaluation(3),
        warnings: []
      }]
    }]
  };
  // A second loadable run that shares the case id "task" but has different variant ids. Switching to it is the
  // condition that used to fire context fetches against the new run with the previous run's variant ids: the
  // shared case id let the stale selection survive the switch, producing guaranteed 404s.
  const secondRun: EvalRunDetailView | undefined = overrides?.secondRunId
    ? {
        ...run,
        id: overrides.secondRunId,
        name: overrides.secondRunId,
        cases: [{
          id: "task",
          variants: run.cases[0].variants.map((variant) => ({
            ...variant,
            variantId: `alt-${variant.variantId}`,
            label: `task/alt-${variant.variantId}`
          }))
        }]
      }
    : undefined;
  /** Resolves a run id to its seeded detail (the second run when configured, else the primary run). */
  const runById = (runId: string): EvalRunDetailView => (secondRun && runId === secondRun.id ? secondRun : run);
  /** Asserts a requested variant exists in the run's case, mirroring the server's 404 for a stale pair. */
  const requireVariant = (runId: string, variant: string): void => {
    const detail = runById(runId);
    const exists = detail.cases.some((testCase) => testCase.variants.some((entry) => entry.variantId === variant));
    if (!exists) throw new Error(`Variant ${variant} not found in run ${runId}.`);
  };
  const compare: EvalCompareView = {
    run,
    caseId: "task",
    left: run.cases[0].variants[0],
    right: run.cases[0].variants[1],
    artifacts: overrides?.artifacts ?? [
      { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "changed" },
      { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" },
      { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: true }
    ]
  };
  const promptDiff: EvalDiffView = {
    artifact: compare.artifacts[0],
    left: { variantId: "empty", label: "task/empty" },
    right: { variantId: "repo", label: "task/repo" },
    lines: [{ kind: "changed", leftNumber: 1, rightNumber: 1, left: "Use no context.", right: "Use repo context." }]
  };
  const contextDiff: EvalDiffView = {
    artifact: compare.artifacts[1],
    left: { variantId: "empty", label: "task/empty" },
    right: { variantId: "repo", label: "task/repo" },
    lines: [{ kind: "add", rightNumber: 1, right: "repo context" }]
  };
  return {
    /** Returns the seeded selected run. */
    getSelection: async () => ({ runId: "run1" }),
    /** Returns the seeded run list, plus an unloadable run or a second loadable run when configured. */
    listRuns: async () => ({
      runs: [
        run,
        ...(overrides?.missingRunId ? [{ ...run, id: overrides.missingRunId, name: overrides.missingRunId }] : []),
        ...(secondRun ? [secondRun] : [])
      ]
    }),
    /** Returns the seeded launchable specs. */
    listSpecs: async () => ({ specs: [{ path: "/evals/compare.json", name: "compare", caseCount: 1, variantCount: 2 }] }),
    /** Builds the N-way scoring view for a case from its variants' seeded evaluations, mirroring the server's discriminating-first sort so App tests exercise the real rendering path. */
    getScoring: vi.fn(async (args: { runId: string; caseId: string }): Promise<EvalScoringView> => {
      const detail = runById(args.runId);
      const testCase = detail.cases.find((candidate) => candidate.id === args.caseId) ?? detail.cases[0];
      const variants = testCase.variants;
      const baseline = variants.find((candidate) => candidate.variantId === "baseline") ?? variants[0];
      return { caseId: testCase.id, baselineKey: baseline.variantId, variants: scoringColumns(variants, baseline), criteria: scoringCriteria(variants), warnings: [] };
    }),
    /** Returns no marks; MarksInbox tests seed their own lightweight fake client instead of this one. */
    listMarks: async () => ({ marks: [] }),
    /** Unused by current App tests; throws so a future caller notices it needs a real fixture. */
    getMark: async (id: string) => {
      throw new Error(`fakeEvalClient.getMark not seeded for ${id}`);
    },
    /** Unused by current App tests; throws so a future caller notices it needs a real fixture. */
    updateMark: async (id: string) => {
      throw new Error(`fakeEvalClient.updateMark not seeded for ${id}`);
    },
    /** Returns the seeded editable prompts. */
    getSpecPrompts: async (specPath) => ({ specPath, name: "compare", prompts: [{ id: "prompts/task.md", label: "Task prompt", path: "prompts/task.md", content: "Do the task." }] }),
    /** Echoes the saved prompt. */
    saveSpecPrompt: vi.fn(async ({ specPath, promptPath, content }) => ({ specPath, name: "compare", prompts: [{ id: promptPath, label: "Task prompt", path: promptPath, content }] })),
    /** Records launch requests. */
    launchRun: vi.fn(async () => ({ runId: "run1" })),
    /** Returns the seeded run detail, or rejects for the unloadable run (a deleted or corrupt run). */
    getRun: async (runId) => {
      if (overrides?.missingRunId && runId === overrides.missingRunId) throw new Error("Run not found.");
      return runById(runId);
    },
    /** Returns the seeded comparison view for the requested run's variant pair. */
    compareRun: async (args) => {
      const detail = runById(args.runId);
      return { ...compare, run: detail, left: detail.cases[0].variants[0], right: detail.cases[0].variants[1] };
    },
    /** Returns the seeded diff for the requested artifact kind, with an artifact descriptor matching the request. */
    getDiff: vi.fn(async (args) => {
      const seed = args.kind === "context" ? contextDiff : args.kind === "code" && overrides?.codeDiff ? overrides.codeDiff : promptDiff;
      return { ...seed, artifact: { ...seed.artifact, id: `${args.kind}:${args.path}`, kind: args.kind, path: args.path } };
    }),
    /** Returns a deterministic context manifest, rejecting a variant that is not part of the requested run. */
    getContextManifest: vi.fn(async (args: { runId: string; variant: string }) => {
      requireVariant(args.runId, args.variant);
      return { skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: false }], subagents: [] };
    }),
    /** Returns a deterministic assembled context: the repo side has blocks, the empty side has none. */
    assembleContext: vi.fn(async (args: { runId: string; variant: string; skills: string[] }) => {
      requireVariant(args.runId, args.variant);
      return args.variant === "repo"
        ? { blocks: [
            { kind: "claude-md" as const, source: "CLAUDE.md", text: "root rules" },
            { kind: "skills-index" as const, source: "skills", text: "testing: Use when testing" },
            ...(args.skills.includes("testing") ? [{ kind: "skill-body" as const, source: ".claude/skills/testing/SKILL.md", text: "FULL TESTING BODY" }] : [])
          ], skills: [{ name: "testing", description: "Use when testing", path: ".claude/skills/testing/SKILL.md", loaded: args.skills.includes("testing") }], subagents: [], lazyClaudeMd: [] }
        : { blocks: [], skills: [], subagents: [], lazyClaudeMd: [] };
    }),
    /** Returns empty conversations for either side, rejecting a variant outside the requested run. */
    getConversations: vi.fn(async (args: { runId: string; variant: string }) => {
      requireVariant(args.runId, args.variant);
      return { schema: "eval.conversations.v1" as const, caseId: "task", variantId: args.variant, conversations: [], notes: [] };
    }),
    /** Returns empty reviews. */
    getReviews: async () => ({ schema: "eval.reviews.v1" as const, variants: {} }),
    /** Echoes persisted reviews. */
    putReviews: vi.fn(async (_runId, reviews) => reviews)
  };
}

/** Builds the N-way scoring columns for a case's variants, flagging the designated baseline. */
function scoringColumns(variants: EvalVariantSummaryView[], baseline: EvalVariantSummaryView): EvalScoringView["variants"] {
  return variants.map((variant) => ({
    key: variant.variantId,
    variantId: variant.variantId,
    label: variant.variantId,
    isBaseline: variant.variantId === baseline.variantId,
    totalPoints: variant.evaluation?.totalPoints,
    maxPoints: variant.evaluation?.maxPoints
  }));
}

/** Builds the N-way criteria matrix for a case's variants, sorted discriminating-first like the real server logic (report/model.ts's buildScoringMatrix), so App tests exercise the real rendering path against a realistic shape. */
function scoringCriteria(variants: EvalVariantSummaryView[]): EvalScoringCriterion[] {
  const ids = [...new Set(variants.flatMap((variant) => variant.evaluation?.criteria.map((criterion) => criterion.id) ?? []))];
  const rows = ids.map((id) => {
    const cells = variants.map((variant) => {
      const verdict = variant.evaluation?.criteria.find((criterion) => criterion.id === id);
      return { variantKey: variant.variantId, passed: verdict?.passed, reasoning: verdict?.reasoning };
    });
    const known = cells.map((cell) => cell.passed).filter((passed): passed is boolean => passed !== undefined);
    const discriminating = known.length >= 2 && known.some((passed) => passed !== known[0]);
    const statement = variants.flatMap((variant) => variant.evaluation?.criteria ?? []).find((criterion) => criterion.id === id)?.statement ?? id;
    return { id, statement, discriminating, cells };
  });
  return rows.sort((a, b) => Number(b.discriminating) - Number(a.discriminating));
}
