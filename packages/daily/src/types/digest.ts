export type EvidenceRef = {
  eventId?: string;
  messageId?: string;
  toolCallId?: string;
  file?: string;
  quote?: string;
};

export type SessionDigestInput = {
  schema: "daily.session-digest-input.v1";
  repo: {
    name: string;
    root?: string;
    branch?: string;
  };
  conversation: {
    id: string;
    provider: "claude" | "codex";
    title?: string;
    startedAt?: string;
    endedAt?: string;
    lastActivityAt?: string;
    durationMs?: number;
    dateBucket: string;
  };
  messages: Array<{
    role: "user" | "assistant";
    visible: boolean;
    text: string;
    at?: string;
    eventId?: string;
  }>;
  internal?: Array<{
    kind:
      | "plan"
      | "thinking"
      | "reasoning_summary"
      | "compaction_summary"
      | "subagent_summary"
      | "system";
    text?: string;
    structured?: unknown;
    eventId?: string;
  }>;
  tools: Array<{
    id: string;
    name: string;
    category: string;
    inputPreview?: string;
    resultPreview?: string;
    status?: "success" | "error" | "unknown";
    durationMs?: number;
    targetPaths?: string[];
    at?: string;
  }>;
  files: {
    read: string[];
    written: string[];
    searched: string[];
  };
  commands: Array<{
    command: string;
    classification: {
      isTest: boolean;
      isBuild: boolean;
      isLint: boolean;
      isTypecheck: boolean;
      isDestructive: boolean;
    };
    status?: "success" | "error" | "unknown";
    outputPreview?: string;
  }>;
  metrics?: {
    tokens?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      total?: number;
      confidence: string;
    };
    toolCalls?: number;
    filesTouched?: number;
  };
  evidenceIndex: Array<{
    eventId: string;
    type: string;
    shortRef: string;
  }>;
};

export type SessionDigest = {
  schema: "daily.session-digest.v1";
  conversation: {
    id: string;
    provider: "claude" | "codex";
    title: string;
    startedAt?: string;
    endedAt?: string;
    dateBucket: string;
    branch?: string;
  };
  headline: string;
  summary: {
    short: string;
    detailed?: string;
  };
  workDone: Array<{
    text: string;
    files?: string[];
    evidence: EvidenceRef[];
  }>;
  decisions: Array<{
    decision: string;
    rationale?: string;
    alternativesConsidered?: string[];
    evidence: EvidenceRef[];
  }>;
  experiments: Array<{
    questionOrHypothesis: string;
    whatWasTried: string;
    outcome: "worked" | "failed" | "inconclusive" | "unknown";
    details?: string;
    evidence: EvidenceRef[];
  }>;
  ideas: Array<{
    idea: string;
    whyItMatters?: string;
    evidence: EvidenceRef[];
  }>;
  designNotes: Array<{
    title: string;
    context: string;
    proposal?: string;
    tradeoffs?: string[];
    openQuestions?: string[];
    evidence: EvidenceRef[];
  }>;
  standup: {
    done: string[];
    next: string[];
    blockers: string[];
  };
  followUps: Array<{
    task: string;
    priority?: "low" | "medium" | "high";
    owner?: string;
    evidence: EvidenceRef[];
  }>;
  risks: Array<{
    risk: string;
    mitigation?: string;
    evidence: EvidenceRef[];
  }>;
  metrics?: {
    tokensTotal?: number;
    toolCalls?: number;
    filesRead?: number;
    filesWritten?: number;
    testsRun?: number;
    testFailures?: number;
  };
  quality: {
    confidence: "high" | "medium" | "low";
    missingContext?: string[];
  };
};
