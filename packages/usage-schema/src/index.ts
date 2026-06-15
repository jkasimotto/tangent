export type UsageConfidence = "exact" | "derived" | "partial" | "estimated" | "unknown" | string;

export type UsageResult<T> = {
  data: T;
  meta: {
    schema: string;
    query?: unknown;
    warnings: Array<{ code?: string; message: string; path?: string }>;
  };
};

export type UsageMetricTokens = {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheCreation?: number;
  reasoning?: number;
  confidence?: UsageConfidence;
};

export type UsageSessionSummary = {
  id: string;
  provider: string;
  providerSessionId?: string;
  title?: string;
  firstPrompt?: string;
  startedAt?: string;
  endedAt?: string;
  models?: string[];
  metrics: {
    durationMs?: number;
    durationConfidence?: UsageConfidence;
    tokens?: UsageMetricTokens;
  };
  counts: {
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    filesTouched?: number;
  };
  availability: {
    notes: string[];
  };
};

export const usageSchemaPackage = "@tangent/usage-schema";
