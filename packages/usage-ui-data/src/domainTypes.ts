import type { PrecomputedSparkline } from "./types.js";

// Domain DTO shapes the Usage UI adapters read from the Usage client. Kept here so index.ts stays the
// adapter surface rather than the type catalogue. UsageDomainClient stays in index.ts because it also
// references the view types defined there.

export type UsageDomainResult<T> = {
  data: T;
  meta: {
    warnings: Array<{ message: string }>;
  };
};

export type UsageDomainSession = {
  id: string;
  provider: string;
  providerSessionId?: string;
  transcriptPath?: string;
  title?: string;
  firstPrompt?: string;
  summary?: string;
  project?: string;
  repo?: { id?: string; root?: string; cwd?: string; branch?: string };
  cwd?: string;
  gitBranch?: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  status?: string;
  models?: string[];
  metrics: {
    durationMs?: number;
    durationConfidence?: string;
    selfDurationMs?: number;
    tokens?: { total?: number; confidence?: string };
    cost?: { amount?: number; currency?: string; source?: string; priced?: boolean };
  };
  counts: {
    turns?: number;
    messages?: number;
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    subagents?: number;
    compactions?: number;
    filesTouched?: number;
  };
  availability: {
    confidence?: string;
    missing?: string[];
    notes: string[];
  };
  evidence?: Array<{ eventId?: string; sourceId?: string; confidence?: string }>;
  providerFields?: Record<string, unknown>;
  /** Index-precomputed activity series; present from the SQLite client so the list skips a per-card timeline. */
  sparkline?: PrecomputedSparkline;
};

export type UsageDomainMessage = {
  id: string;
  turnId?: string;
  stepId?: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  createdAt?: string;
  model?: string;
  text?: string;
  textPreview?: string;
  tokenUsage?: { total?: number; confidence?: string };
  metrics?: { tokens?: { total?: number } };
  confidence?: string;
  toolCalls?: Array<{
    id: string;
    stepId?: string;
    resultStepId?: string;
    toolName?: string;
    name?: string;
    status?: string;
    result?: { durationMs?: number; outputPreview?: string };
    targetPaths?: string[];
    input?: unknown;
  }>;
};

export type UsageDomainToolCall = {
  id: string;
  stepId?: string;
  resultStepId?: string;
  toolName?: string;
  name?: string;
  status?: string;
  input?: unknown;
  plan?: string;
  targetPaths?: string[];
  result?: {
    durationMs?: number;
    outputPreview?: string;
  };
};

export type UsageDomainTranscript = {
  schema: string;
  session?: unknown;
  messages: UsageDomainMessage[];
  totals?: unknown;
  caveats: string[];
  [key: string]: unknown;
};
