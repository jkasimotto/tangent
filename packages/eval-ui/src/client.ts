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

export type EvalCompareArtifactKind = "prompt" | "context" | "code";
export type EvalCompareArtifactStatus = "same" | "changed" | "left-only" | "right-only";

export type EvalSparklineKind = "assistant" | "tool" | "command" | "file" | "unknown";

export type EvalSparklineBucket = {
  kind: EvalSparklineKind;
  tokenShare: number;
  durationShare: number;
};

export type EvalSparkline = {
  durationMs: number;
  tokensTotal?: number;
  buckets: EvalSparklineBucket[];
};

export type EvalVariantMetricsView = {
  durationMs?: number;
  activeAgentDurationMs?: number;
  tokensTotal?: number;
  /** Cache-read tokens (the cheap, dominant share of tokensTotal); shown so the big token count reads honestly. */
  cachedTokens?: number;
  /** Estimated USD spend, weighting each token bucket by its real price. Undefined when a model has no known rate. */
  costUsd?: number;
  peakContextTokens?: number;
  filesChanged: number;
  filesRead: number;
  diffStat?: string;
  conversationIds: string[];
  sparkline?: EvalSparkline;
};

export type EvalSpecSummaryView = {
  path: string;
  name: string;
  caseCount: number;
  variantCount: number;
};

export type EvalCompareArtifactView = {
  id: string;
  kind: EvalCompareArtifactKind;
  path: string;
  label: string;
  status?: EvalCompareArtifactStatus;
  /** For code artifacts: whether the left/right variant's agent changed this file (context -> implementation). */
  changedLeft?: boolean;
  changedRight?: boolean;
  /** For code artifacts: added/removed line counts from the agent's own change (context -> implementation). Undefined when not a changed code file or when binary. */
  addedLeft?: number;
  removedLeft?: number;
  addedRight?: number;
  removedRight?: number;
};

export type EvalVariantPhaseView = {
  id: "plan" | "implement";
  status?: EvalRunStatus;
  agentDurationMs?: number;
};

export type EvalEvaluationView = {
  model: string;
  totalPoints: number;
  maxPoints: number;
  criteria: Array<{
    id: string;
    statement: string;
    points: number;
    passed: boolean;
    reasoning: string;
  }>;
  warnings: string[];
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
  startedAt?: string;
  endedAt?: string;
  phases: EvalVariantPhaseView[];
  error?: string;
  promptArtifacts: EvalCompareArtifactView[];
  metrics?: EvalVariantMetricsView | null;
  evaluation?: EvalEvaluationView | null;
  warnings: string[];
};

export type EvalSpecPromptView = {
  id: string;
  label: string;
  path: string;
  content: string;
};

export type EvalSpecPromptsView = {
  specPath: string;
  name: string;
  prompts: EvalSpecPromptView[];
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

export type EvalAssembledBlockKind = "claude-md" | "import" | "skills-index" | "skill-body" | "subagents-index";
export type EvalAssembledBlock = { kind: EvalAssembledBlockKind; source: string; text: string };
export type EvalContextSkill = { name: string; description: string; path: string; loaded: boolean };
export type EvalContextSubagent = { name: string; description: string; path: string };
export type EvalAssembledContext = { blocks: EvalAssembledBlock[]; skills: EvalContextSkill[]; subagents: EvalContextSubagent[]; lazyClaudeMd: string[] };
export type EvalContextManifest = { skills: EvalContextSkill[]; subagents: EvalContextSubagent[] };

export type EvalConversationToolCall = {
  id: string;
  name: string;
  category: string;
  targetPaths: string[];
  status?: "success" | "error" | "unknown";
  durationMs?: number;
  inputPreview?: string;
};
export type EvalConversationMessage = {
  id: string;
  role: "user" | "assistant";
  at?: string;
  model?: string;
  text: string;
  thinking?: string;
  toolCalls: EvalConversationToolCall[];
};
export type EvalConversation = {
  id: string;
  provider: "claude" | "codex" | "gemini";
  startedAt?: string;
  endedAt?: string;
  messages: EvalConversationMessage[];
  totals: { userMessages: number; assistantMessages: number; toolCalls: number };
};
export type EvalConversationsView = {
  schema: "eval.conversations.v1";
  caseId: string;
  variantId: string;
  conversations: EvalConversation[];
  notes: string[];
};

export type EvalReviewSentiment = "good" | "bad";
export type EvalVerdictSentiment = "like" | "dislike" | "mixed";

export type EvalReviewNote = {
  id: string;
  artifactId: string;
  artifactLabel: string;
  line: number;
  endLine?: number;
  snippet: string;
  sentiment: EvalReviewSentiment;
  text: string;
  ts: number;
};

export type EvalVariantReview = {
  verdict?: { sentiment: EvalVerdictSentiment; text?: string; score?: number };
  notes: EvalReviewNote[];
};

export type EvalReviews = {
  schema: "eval.reviews.v1";
  variants: Record<string, EvalVariantReview>;
};

// Scoring-matrix and marks-inbox view types live in mark-types.ts (kept out of this already-large
// grab-bag of view types); re-exported here so every existing `import type {...} from "./client.js"` in
// this package keeps working unchanged.
export type {
  EvalScoringCell,
  EvalScoringCriterion,
  EvalScoringVariantColumn,
  EvalScoringView,
  MarkAnchor,
  MarkKind,
  MarkLinks,
  MarkListFilter,
  MarkProvider,
  MarkRecord,
  MarkRepo,
  MarkStatus,
  MarkUpdatePatch
} from "./mark-types.js";
import type {
  EvalScoringView,
  MarkListFilter,
  MarkRecord,
  MarkUpdatePatch
} from "./mark-types.js";

export type EvalUiClient = {
  getSelection(): Promise<{ runId?: string }>;
  listRuns(): Promise<{ runs: EvalRunSummaryView[] }>;
  listSpecs(): Promise<{ specs: EvalSpecSummaryView[] }>;
  getSpecPrompts(specPath: string): Promise<EvalSpecPromptsView>;
  saveSpecPrompt(args: { specPath: string; promptPath: string; content: string }): Promise<EvalSpecPromptsView>;
  launchRun(args: { specPath: string }): Promise<{ runId: string }>;
  getRun(runId: string): Promise<EvalRunDetailView>;
  compareRun(args: { runId: string; caseId: string; left: string; right: string }): Promise<EvalCompareView>;
  getDiff(args: { runId: string; caseId: string; left: string; right: string; kind: EvalCompareArtifactKind; path: string }): Promise<EvalDiffView>;
  getContextManifest(args: { runId: string; caseId: string; variant: string }): Promise<EvalContextManifest>;
  assembleContext(args: { runId: string; caseId: string; variant: string; cwd: string; skills: string[] }): Promise<EvalAssembledContext>;
  getConversations(args: { runId: string; caseId: string; variant: string }): Promise<EvalConversationsView>;
  getReviews(runId: string): Promise<EvalReviews>;
  putReviews(runId: string, reviews: EvalReviews): Promise<EvalReviews>;
  getScoring(args: { runId: string; caseId: string }): Promise<EvalScoringView>;
  listMarks(filter?: MarkListFilter): Promise<{ marks: MarkRecord[] }>;
  getMark(id: string): Promise<MarkRecord>;
  updateMark(id: string, patch: MarkUpdatePatch): Promise<MarkRecord>;
};

/** Creates an HTTP-backed Eval UI client. */
export function createEvalApiClient(baseUrl = ""): EvalUiClient {
  return {
    /** Fetches the selected eval run id. */
    getSelection: () => getJson(`${baseUrl}/api/eval/selection`),
    /** Lists discovered eval runs. */
    listRuns: () => getJson(`${baseUrl}/api/eval/runs`),
    /** Lists eval specs the UI can launch. */
    listSpecs: () => getJson(`${baseUrl}/api/eval/specs`),
    /** Fetches a spec's editable prompt files. */
    getSpecPrompts: (specPath) => getJson(`${baseUrl}/api/eval/specs/prompts?${query({ path: specPath })}`),
    /** Saves one edited prompt file and returns the refreshed prompt set. */
    saveSpecPrompt: (args) => putJson(`${baseUrl}/api/eval/specs/prompts`, args),
    /** Launches a run from a spec and returns its new run id. */
    launchRun: (args) => postJson(`${baseUrl}/api/eval/runs`, args),
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
    })}`),
    /** Lists a variant's discoverable skills and subagents for the context skill picker. */
    getContextManifest: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/context/manifest?${query({ caseId: args.caseId, variant: args.variant })}`),
    /** Assembles a variant's repo-contributed context at a cwd with a loaded-skill set. */
    assembleContext: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/context/assemble?${query({ caseId: args.caseId, variant: args.variant, cwd: args.cwd, skills: args.skills.join(",") })}`),
    /** Reconstructs a variant's agent conversations (turns and tool calls) for the compare view. */
    getConversations: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/conversations?${query({ caseId: args.caseId, variant: args.variant })}`),
    /** Fetches the human review notes for a run. */
    getReviews: (runId) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(runId)}/reviews`),
    /** Persists the human review notes for a run. */
    putReviews: (runId, reviews) => putJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(runId)}/reviews`, reviews),
    /** Fetches the N-way scoring matrix for every variant in a case. */
    getScoring: (args) => getJson(`${baseUrl}/api/eval/runs/${encodeURIComponent(args.runId)}/scoring?${query({ caseId: args.caseId })}`),
    /** Lists marks, optionally filtered by status/kind, newest first. */
    listMarks: (filter) => getJson(`${baseUrl}/api/eval/marks${filter && (filter.status || filter.kind) ? `?${query({ ...(filter.status ? { status: filter.status } : {}), ...(filter.kind ? { kind: filter.kind } : {}) })}` : ""}`),
    /** Fetches one mark by id. */
    getMark: (id) => getJson(`${baseUrl}/api/eval/marks/${encodeURIComponent(id)}`),
    /** Applies a status/links patch to one mark. */
    updateMark: (id, patch) => postJson(`${baseUrl}/api/eval/marks/${encodeURIComponent(id)}`, patch)
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

/** Posts a JSON body and parses the JSON response. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/** Puts a JSON body and parses the JSON response. */
async function putJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
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
