export type AgentProvider = "claude" | "codex" | "gemini";

export type AgentBinding = {
  id: string;
  label: string;
  provider: AgentProvider;
  command: string;
  loginShell?: boolean;
  exactCommand?: string;
  model?: string;
  profile?: string;
  effort?: string;
  permissionMode?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
};

export type SessionChoice = { mode: "fresh" } | { mode: "continue"; fromStepId: string };

export type GoalSummary = {
  path: string;
  areaPath: string;
  title: string;
  status: string;
  doneWhen?: string;
  repository?: string;
};

export type StepDefinition = {
  id: string;
  order: number;
  label: string;
  instruction: string;
  defaultBinding: "claude" | "codex";
  requiredArtifacts: string[];
  review: boolean;
};

export type ArtifactIdentity = {
  path: string;
  purpose: string;
  hash: string;
  stepId: string;
  attempt: number;
};

export type ProofItem = { command: string; result: string };

export type Attempt = {
  id: string;
  number: number;
  status: string;
  startedAt: string;
  endedAt?: string;
  sessionId?: string;
  output?: string;
  error?: string;
  artifacts: ArtifactIdentity[];
  proof: ProofItem[];
  changedPaths: string[];
  envelope?: { status: string; summary: string; question?: string | null };
};

export type StepState = StepDefinition & {
  status: string;
  binding: AgentBinding;
  session: SessionChoice;
  attempts: Attempt[];
};

export type ReviewedRun = {
  id: string;
  status: "queued" | "running" | "needs_attention" | "stopped" | "complete";
  createdAt: string;
  updatedAt: string;
  areaPath: string;
  goalPath: string;
  goalTitle: string;
  goalDoneWhen?: string;
  repository: { root: string; head: string; branch?: string; baseline: Record<string, string> };
  steps: StepState[];
  currentStepId?: string;
  attention?: {
    kind: "judgment" | "error" | "interrupted";
    stepId: string;
    message: string;
    question?: string;
    artifactPaths: string[];
    at: string;
  };
  final?: { changedPaths: string[]; diffIdentity: string; proof: ProofItem[] };
};

export type ProgramView = {
  id: "reviewed-build";
  name: string;
  version: number;
  description: string;
  steps: StepDefinition[];
  bindings: Record<string, AgentBinding>;
  sessions: Record<string, SessionChoice>;
  defaults?: { updatedAt: string };
};

export type WorkApiClient = {
  listGoals(): Promise<{ goals: GoalSummary[] }>;
  getProgram(areaPath?: string): Promise<ProgramView>;
  listRuns(): Promise<{ runs: ReviewedRun[] }>;
  getRun(runId: string): Promise<{ run: ReviewedRun; latestOutput: string }>;
  startRun(input: { goalPath: string; bindings: Record<string, AgentBinding>; sessions: Record<string, SessionChoice> }): Promise<{ run: ReviewedRun }>;
  updateStep(runId: string, stepId: string, input: { binding: AgentBinding; session: SessionChoice }): Promise<{ run: ReviewedRun }>;
  controlRun(runId: string, input: { action: "stop" | "resume" | "retry"; decision?: string }): Promise<{ run: ReviewedRun }>;
  saveDefaults(areaPath: string, input: { bindings: Record<string, AgentBinding>; sessions: Record<string, SessionChoice> }): Promise<unknown>;
};

/** Creates the browser client for the Agent Shell API. */
export function createWorkApiClient(fetcher: typeof fetch = fetch): WorkApiClient {
  /** Sends one JSON request and reports the server's message on failure. */
  const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetcher(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers || {}) }
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body as T;
  };
  return {
    /** Lists Goals that can start a Reviewed build. */
    listGoals: () => request("/api/work/goals"),
    /** Gets the resolved Program for an Area. */
    getProgram: (areaPath) => request(`/api/work/program${areaPath ? `?area=${encodeURIComponent(areaPath)}` : ""}`),
    /** Lists durable Reviewed build Runs. */
    listRuns: () => request("/api/work/runs"),
    /** Gets one durable Run and its latest output. */
    getRun: (runId) => request(`/api/work/runs/${encodeURIComponent(runId)}`),
    /** Starts a Reviewed build Run. */
    startRun: (input) => request("/api/work/runs", { method: "POST", body: JSON.stringify(input) }),
    /** Updates one pending Program step. */
    updateStep: (runId, stepId, input) => request(`/api/work/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}`, { method: "PATCH", body: JSON.stringify(input) }),
    /** Applies a control action to one Run. */
    controlRun: (runId, input) => request(`/api/work/runs/${encodeURIComponent(runId)}/control`, { method: "POST", body: JSON.stringify(input) }),
    /** Saves Program defaults for one Area. */
    saveDefaults: (areaPath, input) => request(`/api/work/defaults/${encodeURIComponent(areaPath)}`, { method: "PUT", body: JSON.stringify(input) })
  };
}

/** Returns the direct browser URL for one validated Run artifact. */
export function artifactUrl(runId: string, stepId: string, attempt: number, index: number): string {
  return `/api/work/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(stepId)}/${attempt}/${index}`;
}

/** Returns the direct browser URL for the Run's current repository diff. */
export function diffUrl(runId: string): string {
  return `/api/work/runs/${encodeURIComponent(runId)}/diff`;
}
