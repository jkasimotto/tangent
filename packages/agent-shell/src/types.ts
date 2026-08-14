import type { AgentCliProvider, AgentCliResult, RunAgentCliArgs } from "@tangent/agent-runtime/agent";

export type ReviewedRunStatus = "queued" | "running" | "needs_attention" | "stopped" | "complete";
export type ReviewedStepStatus = "pending" | "running" | "needs_attention" | "stopped" | "failed" | "complete";
export type ReviewedAttemptStatus = "running" | "stopped" | "failed" | "complete" | "needs_attention" | "interrupted";
export type ReviewedAttentionKind = "judgment" | "error" | "interrupted";

export type ReviewedAgentBinding = {
  id: string;
  label: string;
  provider: AgentCliProvider;
  command: string;
  loginShell?: boolean;
  exactCommand?: string;
  model?: string;
  profile?: string;
  effort?: string;
  permissionMode?: string;
  maxTurns?: number;
  timeoutMs?: number;
  extraArgs?: string[];
  env?: Record<string, string>;
};

export type ReviewedSessionChoice =
  | { mode: "fresh" }
  | { mode: "continue"; fromStepId: string };

export type ReviewedArtifactPurpose =
  | "design"
  | "design-review"
  | "implementation-plan"
  | "implementation-plan-review"
  | "implementation-review"
  | "review-response"
  | "supporting";

export type ReviewedStepDefinition = {
  id: string;
  order: number;
  label: string;
  instruction: string;
  defaultBinding: "claude" | "codex";
  requiredArtifacts: ReviewedArtifactPurpose[];
  requiresRepositoryChange: boolean;
  requiresProof: boolean;
  restrictChangesToArtifacts: boolean;
  review: boolean;
};

export type ReviewedEnvelopeArtifact = {
  path: string;
  purpose: ReviewedArtifactPurpose;
};

export type ReviewedProof = {
  command: string;
  result: string;
};

export type ReviewedCompletionEnvelope = {
  status: "complete" | "needs_judgment";
  summary: string;
  artifacts: ReviewedEnvelopeArtifact[];
  proof: ReviewedProof[];
  question: string | null;
};

export type ReviewedArtifactIdentity = ReviewedEnvelopeArtifact & {
  repository: string;
  stepId: string;
  attempt: number;
  hash: string;
  absolutePath: string;
};

export type RepositorySnapshot = Record<string, string>;

export type ReviewedAttempt = {
  id: string;
  number: number;
  status: ReviewedAttemptStatus;
  startedAt: string;
  endedAt?: string;
  sessionId?: string;
  logFile: string;
  output?: string;
  error?: string;
  envelope?: ReviewedCompletionEnvelope;
  artifacts: ReviewedArtifactIdentity[];
  proof: ReviewedProof[];
  preSnapshot: RepositorySnapshot;
  postSnapshot?: RepositorySnapshot;
  changedPaths: string[];
};

export type ReviewedStepState = ReviewedStepDefinition & {
  status: ReviewedStepStatus;
  binding: ReviewedAgentBinding;
  session: ReviewedSessionChoice;
  attempts: ReviewedAttempt[];
};

export type ReviewedAttention = {
  kind: ReviewedAttentionKind;
  stepId: string;
  message: string;
  question?: string;
  artifactPaths: string[];
  at: string;
};

export type ReviewedDecision = {
  stepId: string;
  question: string;
  answer: string;
  at: string;
};

export type ReviewedSourceDocument = {
  path: string;
  hash: string;
};

export type ReviewedRun = {
  schema: "reviewed-build.run.v1";
  id: string;
  program: {
    id: "reviewed-build";
    name: "Reviewed build";
    version: 1;
  };
  status: ReviewedRunStatus;
  createdAt: string;
  updatedAt: string;
  areaPath: string;
  goalPath: string;
  goalTitle: string;
  goalDoneWhen?: string;
  repository: {
    root: string;
    head: string;
    branch?: string;
    baseline: RepositorySnapshot;
  };
  originalRequest: string;
  context: string;
  sources: ReviewedSourceDocument[];
  steps: ReviewedStepState[];
  currentStepId?: string;
  attention?: ReviewedAttention;
  decisions: ReviewedDecision[];
  final?: {
    changedPaths: string[];
    diffIdentity: string;
    proof: ReviewedProof[];
  };
};

export type ReviewedGoalSummary = {
  path: string;
  areaPath: string;
  title: string;
  status: string;
  doneWhen?: string;
  repository?: string;
};

export type ReviewedAreaDefaults = {
  schema: "reviewed-build.defaults.v1";
  areaPath: string;
  bindings: Record<string, ReviewedAgentBinding>;
  sessions: Record<string, ReviewedSessionChoice>;
  updatedAt: string;
};

export type ReviewedProgramView = {
  id: "reviewed-build";
  name: "Reviewed build";
  version: 1;
  description: string;
  steps: ReviewedStepDefinition[];
  defaults?: ReviewedAreaDefaults;
  bindings: Record<string, ReviewedAgentBinding>;
  sessions: Record<string, ReviewedSessionChoice>;
};

export type ReviewedRunner = (args: RunAgentCliArgs) => Promise<AgentCliResult>;

export type StartReviewedRunInput = {
  goalPath: string;
  bindings?: Record<string, ReviewedAgentBinding>;
  sessions?: Record<string, ReviewedSessionChoice>;
};

export type ReviewedRunControl =
  | { action: "stop" }
  | { action: "resume"; decision?: string }
  | { action: "retry"; decision?: string };

export type ReviewedEngineOptions = {
  treesRoot?: string;
  loopsRoot?: string;
  fallbackRepository?: string;
  runner?: ReviewedRunner;
  notifier?: false | ((input: { kind: "complete" | "needs_attention"; run: ReviewedRun }) => void | Promise<void>);
  now?: () => Date;
};
