export type EvalMetrics = {
  schema: "eval.metrics.v1";
  runId: string;
  caseId: string;
  variantId: string;
  status: "prepared" | "running" | "done" | "failed" | "manual" | "cancelled";
  time: {
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    planDurationMs?: number;
    implementationDurationMs?: number;
    activeAgentDurationMs?: number;
    planActiveAgentDurationMs?: number;
    implementationActiveAgentDurationMs?: number;
  };
  tokens: {
    total?: number;
    byModel: Array<{
      model: string;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheCreation?: number;
      total?: number;
      confidence: "exact" | "derived" | "partial" | "unknown";
    }>;
    messages: Array<{
      provider: "claude" | "codex" | "gemini";
      conversationId: string;
      turnId?: string;
      eventId: string;
      at: string;
      model: string;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheCreation?: number;
      total?: number;
      confidence: "provider-reported" | "derived" | "estimated" | "unknown";
      source: "native" | "hook" | "sdk" | "merged";
    }>;
  };
  tools: {
    total: number;
    byModel: Record<string, number>;
    byName: Record<string, number>;
    byCategory: Record<string, number>;
    calls: Array<{
      provider: "claude" | "codex" | "gemini";
      conversationId: string;
      turnId?: string;
      eventId: string;
      at: string;
      model?: string;
      toolCallId?: string;
      name: string;
      category: string;
      targetPaths: string[];
      command?: string;
    }>;
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
    provider: "claude" | "codex" | "gemini";
    id: string;
  }>;
  warnings: string[];
};
