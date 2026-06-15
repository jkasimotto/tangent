export type EvalPhase = "context" | "plan" | "impl" | "all";

export type EvalVariantSummary = {
  caseId: string;
  variantId: string;
  status: string;
  branch: string;
  agent: unknown;
  summary: {
    tokensTotal?: number;
    wallTimeMs?: number;
    activeAgentTimeMs?: number;
    toolCalls: number;
    filesChanged: number;
    commandFailures: number;
  };
  artifacts: {
    promptPath: string;
    planPath?: string;
    implementationOutputPath?: string;
    metricsPath: string;
    worktree: string;
  };
  warnings: string[];
};

export type EvalRunListItem = {
  id: string;
  name: string;
  createdAt: string;
  runDir: string;
  variants: number;
  statuses: Record<string, number>;
};

export type EvalRunListView = EvalRunListItem[];

export type EvalRunDetailView = {
  run: { id: string; name: string; createdAt: string; variants: unknown[]; [key: string]: unknown };
  metrics: unknown[];
  cases: Array<{
    caseId: string;
    variants: EvalVariantSummary[];
  }>;
};

export type EvalSpecListItem = {
  id: string;
  name?: string;
  path: string;
  relativePath: string;
  caseCount?: number;
  variantCount?: number;
  error?: string;
};

export type EvalSpecListView = EvalSpecListItem[];
export type EvalSpecDetailView = {
  id: string;
  name?: string;
  path: string;
  relativePath: string;
  error?: string;
  spec?: unknown;
  defaults?: unknown;
  cases: Array<{ caseId: string; promptPath: string; prompt: string; variants: unknown[] }>;
};

export type CompareSelection = {
  baselineId?: string;
  candidateIds: string[];
  caseId?: string;
  phase?: EvalPhase;
};

export type EvalCompareQuery = {
  runId: string;
  caseId: string;
  left: string;
  right: string;
  phase?: EvalPhase;
};

export type EvalCompareView = {
  runId: string;
  caseId: string;
  phase: EvalPhase;
  left: EvalVariantSummary;
  right: EvalVariantSummary;
  outputs: {
    leftImplementation?: string;
    rightImplementation?: string;
    leftPlan?: string;
    rightPlan?: string;
  };
  git: {
    leftCommit?: string;
    rightCommit?: string;
    comparisonDiff?: string;
    leftPatch?: string;
    rightPatch?: string;
    diffStat?: string;
    changedFiles: {
      left: string[];
      right: string[];
      shared: string[];
      onlyLeft: string[];
      onlyRight: string[];
    };
  };
  metricsDelta: {
    tokensTotal?: number;
    wallTimeMs?: number;
    activeAgentTimeMs?: number;
    toolCalls?: number;
    commandFailures?: number;
    filesChanged?: number;
  };
  warnings: string[];
};

export type EvalJobView = {
  id: string;
  specId: string;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: string;
  endedAt?: string;
  runId?: string;
  error?: string;
  eventCount: number;
};

export type EvalJobEventsView = {
  events?: EvalJobEvent[];
} | EvalJobEvent[];

export type EvalJobEvent = {
  seq: number;
  at: string;
  type: string;
  message?: string;
  runId?: string;
  caseId?: string;
  variantId?: string;
  phase?: "plan" | "implement";
  stream?: "stdout" | "stderr";
  chunk?: string;
};

export interface EvalUiClient {
  listRuns(): Promise<EvalRunListView>;
  getRun(runId: string): Promise<EvalRunDetailView>;
  getCompare(query: EvalCompareQuery): Promise<EvalCompareView>;
  listSpecs(): Promise<EvalSpecListView>;
  getSpec(specId: string): Promise<EvalSpecDetailView>;
  startRun(specId: string): Promise<EvalJobView>;
  getJob(jobId: string): Promise<EvalJobView>;
  getJobEvents(jobId: string, after?: number): Promise<EvalJobEventsView>;
}

/** Creates create eval server client. */
export function createEvalServerClient(baseUrl = ""): EvalUiClient {
  /** Requests JSON from the local Tangent API. */
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, init);
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  };
  return {
    /** Lists runs. */
    listRuns: () => api("/api/eval/runs"),
    /** Gets run. */
    getRun: (runId) => api(`/api/eval/runs/${encodeURIComponent(runId)}`),
    /** Gets compare. */
    getCompare: (query) => {
      const params = new URLSearchParams({ caseId: query.caseId, a: query.left, b: query.right, phase: query.phase || "impl" });
      return api(`/api/eval/runs/${encodeURIComponent(query.runId)}/compare?${params}`);
    },
    /** Lists specs. */
    listSpecs: () => api("/api/eval/specs"),
    /** Gets spec. */
    getSpec: (specId) => api(`/api/eval/specs/${encodeURIComponent(specId)}`),
    /** Supports the start run helper. */
    startRun: (specId) => api(`/api/eval/specs/${encodeURIComponent(specId)}/runs`, { method: "POST" }),
    /** Gets job. */
    getJob: (jobId) => api(`/api/eval/jobs/${encodeURIComponent(jobId)}`),
    /** Gets job events. */
    getJobEvents: (jobId, after) => api(`/api/eval/jobs/${encodeURIComponent(jobId)}/events${after === undefined ? "" : `?after=${after}`}`)
  };
}
