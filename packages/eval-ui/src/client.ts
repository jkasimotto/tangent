export type EvalRunStatus = "prepared" | "running" | "done" | "failed" | "manual" | "cancelled";

export type EvalContextMode =
  | { mode: "repo" }
  | { mode: "empty" }
  | { mode: "snapshot"; ref: string }
  | { mode: "git-ref"; ref: string };

export type EvalAgentConfig =
  | { kind: "manual" }
  | {
      kind: "codex-cli";
      command?: string;
      model: string;
      profile?: string;
      sandbox: "read-only" | "workspace-write" | "danger-full-access";
      timeoutMs?: number;
    }
  | {
      kind: "claude-cli";
      command?: string;
      model: string;
      permissionMode?: string;
      maxTurns?: number;
      timeoutMs?: number;
    };

export type EvalRunSummaryView = {
  id: string;
  name: string;
  createdAt: string;
  runDir: string;
  specPath?: string;
  variantCount: number;
  caseCount: number;
  statuses: Record<EvalRunStatus, number>;
};

export type EvalCompareArtifactKind = "prompt" | "context";
export type EvalCompareArtifactStatus = "same" | "changed" | "left-only" | "right-only";

export type EvalCompareArtifactView = {
  id: string;
  kind: EvalCompareArtifactKind;
  path: string;
  label: string;
  status?: EvalCompareArtifactStatus;
};

export type EvalVariantSummaryView = {
  caseId: string;
  variantId: string;
  label: string;
  status: EvalRunStatus;
  agent: EvalAgentConfig;
  model?: string;
  context: EvalContextMode;
  branch: string;
  worktree: string;
  executionCwd: string;
  baseCommit: string;
  contextCommit?: string;
  promptArtifacts: EvalCompareArtifactView[];
  warnings: string[];
};

export type EvalCaseView = {
  id: string;
  variants: EvalVariantSummaryView[];
};

export type EvalRunDetailView = EvalRunSummaryView & {
  cases: EvalCaseView[];
};

export type EvalCompareView = {
  run: EvalRunSummaryView;
  caseId: string;
  left: EvalVariantSummaryView;
  right: EvalVariantSummaryView;
  artifacts: EvalCompareArtifactView[];
};

export type EvalDiffLineView = {
  kind: "equal" | "changed" | "add" | "delete";
  leftNumber?: number;
  rightNumber?: number;
  left?: string;
  right?: string;
};

export type EvalDiffView = {
  artifact: EvalCompareArtifactView;
  left: { variantId: string; label: string };
  right: { variantId: string; label: string };
  lines: EvalDiffLineView[];
};

export type EvalUiClient = {
  getSelection(): Promise<{ runId?: string }>;
  listRuns(): Promise<{ runs: EvalRunSummaryView[] }>;
  getRun(runId: string): Promise<EvalRunDetailView>;
  compareRun(args: { runId: string; caseId: string; left: string; right: string }): Promise<EvalCompareView>;
  getDiff(args: { runId: string; caseId: string; left: string; right: string; kind: EvalCompareArtifactKind; path: string }): Promise<EvalDiffView>;
};

/** Creates an HTTP-backed Eval UI client. */
export function createEvalApiClient(baseUrl = ""): EvalUiClient {
  return {
    /** Fetches the selected eval run id. */
    getSelection: () => getJson(`${baseUrl}/api/eval/selection`),
    /** Lists discovered eval runs. */
    listRuns: () => getJson(`${baseUrl}/api/eval/runs`),
    /** Fetches one eval run by id. */
    getRun: (runId) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(runId)}`),
    /** Fetches the comparison view for a variant pair. */
    compareRun: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/compare?${query({
      caseId: args.caseId,
      left: args.left,
      right: args.right
    })}`),
    /** Fetches a diff for one comparable artifact. */
    getDiff: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/diff?${query({
      caseId: args.caseId,
      left: args.left,
      right: args.right,
      kind: args.kind,
      path: args.path
    })}`)
  };
}

/** Fetches and parses a JSON response. */
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/** Encodes query parameters for API calls. */
function query(values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, value);
  return params.toString();
}
