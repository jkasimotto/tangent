export type EvalMetrics = {
  schema: "eval.metrics.v1";
  runId: string;
  caseId: string;
  variantId: string;
  status: "prepared" | "running" | "done" | "failed" | "manual";
  time: {
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    planDurationMs?: number;
    implementationDurationMs?: number;
  };
  tokens: {
    total?: number;
    byModel: Array<{
      model: string;
      input?: number;
      output?: number;
      cacheRead?: number;
      total?: number;
      confidence: "exact" | "derived" | "partial" | "unknown";
    }>;
  };
  tools: {
    total: number;
    byModel: Record<string, number>;
    byName: Record<string, number>;
    byCategory: Record<string, number>;
  };
  files: {
    read: string[];
    searched: string[];
    written: string[];
    changed: string[];
    confidence: "exact" | "derived" | "partial";
  };
  commands: {
    total: number;
    tests: number;
    builds: number;
    lints: number;
    typechecks: number;
    failures: number;
  };
  git: {
    baseCommit: string;
    contextCommit: string;
    planCommit?: string;
    implementationCommit?: string;
    branch: string;
    worktree: string;
    diffStat?: string;
  };
  conversations: Array<{
    provider: "claude" | "codex";
    id: string;
  }>;
  warnings: string[];
};
