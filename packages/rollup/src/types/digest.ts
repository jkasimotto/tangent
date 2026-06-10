import type { NormalizedConversation } from "@tangent/usage";
import type { RollupPeriod } from "./period.js";

export type EvidenceRef = {
  id?: string;
  eventId?: string;
  toolCallId?: string;
  file?: string;
  quote?: string;
  kind?: string;
};

export type RollupCandidate = {
  schema: "rollup.candidate.v1";
  sourceKey: string;
  provider: "claude" | "codex";
  conversationId: string;
  turnId: string;
  dateBucket: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  titlePreview?: string;
  sourceFingerprint: string;
  priorStatus?: "processed" | "failed" | "skipped-empty" | "skipped-active";
  reason: "new" | "changed" | "previously-failed" | "forced";
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    commandCalls: number;
    filesTouched: number;
  };
};

export type TurnDigestInput = {
  schema: "rollup.turn-digest-input.v1";
  repo: {
    name: string;
    rootHash: string;
    branch?: string;
  };
  source: {
    provider: "claude" | "codex";
    conversationId: string;
    turnId: string;
    sourceKey: string;
    dateBucket: string;
    startedAt?: string;
    endedAt?: string;
    wallTimeMs?: number;
    sourceFingerprint: string;
    captureConfidence: "exact" | "partial" | "best-effort";
  };
  transcript: Array<{
    role: "user" | "assistant";
    text: string;
    eventId: string;
    confidence: "exact" | "partial";
  }>;
  activity: {
    commands: Array<{
      command: string;
      purpose?: string;
      status: "success" | "error" | "unknown";
      durationMs?: number;
      isTest: boolean;
      isBuild: boolean;
      isLint: boolean;
      outputPreview?: string;
      evidenceEventId: string;
    }>;
    fileChanges: Array<{
      path: string;
      action: "read" | "searched" | "wrote" | "edited" | "unknown";
      toolCallId?: string;
    }>;
    toolHighlights: Array<{
      toolName: string;
      category: string;
      inputSummary?: string;
      resultSummary?: string;
      status?: "success" | "error" | "unknown";
      evidenceEventId: string;
    }>;
    compactions: Array<{
      trigger: "manual" | "auto" | "unknown";
      summary?: string;
      eventId: string;
    }>;
    subagents: Array<{
      agentType?: string;
      finalMessage?: string;
      eventId: string;
    }>;
  };
  evidence: EvidenceRef[];
  omissions: {
    rawToolResultsOmitted: number;
    longMessagesTruncated: number;
    filesContentOmitted: number;
    reason: string[];
  };
};

export type RollupInput = {
  schema: "rollup.input.v1";
  period: RollupPeriod;
  timezone: string;
  repo: {
    name: string;
    rootHash: string;
    branch?: string;
  };
  source: {
    generatedAt: string;
    providers: Array<"claude" | "codex">;
    conversationIds: string[];
    sourceFiles: string[];
    caveats: string[];
  };
  examples: Array<{
    path: string;
    markdown: string;
  }>;
  conversations: NormalizedConversation[];
};

export type RollupOutput = {
  schema: "rollup.output.v1";
  markdown: string;
  sourceCaveats: string[];
};

export type TurnDigest = {
  schema: "rollup.turn-digest.v1";
  source: {
    sourceKey: string;
    provider: "claude" | "codex";
    conversationId: string;
    turnId: string;
    dateBucket: string;
    startedAt?: string;
    endedAt?: string;
    wallTimeMs?: number;
    inputHash: string;
  };
  topicHints: Array<{
    key: string;
    title: string;
    confidence: "high" | "medium" | "low";
  }>;
  headline: string;
  summary: string;
  workDone: string[];
  designNotes: Array<{
    title: string;
    context: string;
    options?: Array<{
      name: string;
      details: string;
      pros?: string[];
      cons?: string[];
    }>;
    openQuestions?: string[];
  }>;
  decisions: Array<{
    decision: string;
    rationale?: string;
    alternatives?: string[];
  }>;
  experiments: Array<{
    question: string;
    method: string;
    outcome: "worked" | "failed" | "inconclusive" | "unknown";
    details?: string;
  }>;
  debuggingFindings: Array<{
    symptom: string;
    investigation: string;
    finding: string;
    fixOrNextStep?: string;
  }>;
  followUps: string[];
  entities: {
    files: string[];
    functions: string[];
    tickets: string[];
    commands: string[];
  };
  evidence: EvidenceRef[];
  quality: {
    confidence: "high" | "medium" | "low";
    caveats: string[];
  };
};

export type TopicRollup = {
  schema: "rollup.topic-rollup.v1";
  date: string;
  key: string;
  title: string;
  sourceTurnKeys: string[];
  providers: Array<"claude" | "codex">;
  timeSpentMs?: number;
  summary: string;
  narrativeMarkdown: string;
  sections: Array<{
    heading: string;
    markdown: string;
  }>;
  decisions: string[];
  experiments: string[];
  openQuestions: string[];
  followUps: string[];
  evidence: Array<EvidenceRef & { sourceKey?: string }>;
  caveats: string[];
};
