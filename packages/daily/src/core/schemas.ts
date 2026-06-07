import type { EvidenceRef, SessionDigest } from "../types/digest.js";

const nullableStringSchema = { type: ["string", "null"] } as const;
const nullableNumberSchema = { type: ["number", "null"] } as const;
const stringArraySchema = { type: "array", items: { type: "string" } } as const;
const nullableStringArraySchema = { type: ["array", "null"], items: { type: "string" } } as const;

const evidenceArraySchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "messageId", "toolCallId", "file", "quote"],
    properties: {
      eventId: nullableStringSchema,
      messageId: nullableStringSchema,
      toolCallId: nullableStringSchema,
      file: nullableStringSchema,
      quote: nullableStringSchema
    }
  }
} as const;

// Codex structured output validates against a stricter subset than generic JSON Schema:
// every object property must be listed in `required`, so optional fields are nullable.
export const sessionDigestJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "conversation",
    "headline",
    "summary",
    "workDone",
    "decisions",
    "experiments",
    "ideas",
    "designNotes",
    "standup",
    "followUps",
    "risks",
    "metrics",
    "quality"
  ],
  properties: {
    schema: { type: "string", const: "daily.session-digest.v1" },
    conversation: {
      type: "object",
      additionalProperties: false,
      required: ["id", "provider", "title", "startedAt", "endedAt", "dateBucket", "branch"],
      properties: {
        id: { type: "string" },
        provider: { type: "string", enum: ["claude", "codex"] },
        title: { type: "string" },
        startedAt: nullableStringSchema,
        endedAt: nullableStringSchema,
        dateBucket: { type: "string" },
        branch: nullableStringSchema
      }
    },
    headline: { type: "string" },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["short", "detailed"],
      properties: {
        short: { type: "string" },
        detailed: nullableStringSchema
      }
    },
    workDone: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "files", "evidence"],
        properties: {
          text: { type: "string" },
          files: nullableStringArraySchema,
          evidence: evidenceArraySchema
        }
      }
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "rationale", "alternativesConsidered", "evidence"],
        properties: {
          decision: { type: "string" },
          rationale: nullableStringSchema,
          alternativesConsidered: nullableStringArraySchema,
          evidence: evidenceArraySchema
        }
      }
    },
    experiments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionOrHypothesis", "whatWasTried", "outcome", "details", "evidence"],
        properties: {
          questionOrHypothesis: { type: "string" },
          whatWasTried: { type: "string" },
          outcome: { type: "string", enum: ["worked", "failed", "inconclusive", "unknown"] },
          details: nullableStringSchema,
          evidence: evidenceArraySchema
        }
      }
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["idea", "whyItMatters", "evidence"],
        properties: {
          idea: { type: "string" },
          whyItMatters: nullableStringSchema,
          evidence: evidenceArraySchema
        }
      }
    },
    designNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "context", "proposal", "tradeoffs", "openQuestions", "evidence"],
        properties: {
          title: { type: "string" },
          context: { type: "string" },
          proposal: nullableStringSchema,
          tradeoffs: nullableStringArraySchema,
          openQuestions: nullableStringArraySchema,
          evidence: evidenceArraySchema
        }
      }
    },
    standup: {
      type: "object",
      additionalProperties: false,
      required: ["done", "next", "blockers"],
      properties: {
        done: stringArraySchema,
        next: stringArraySchema,
        blockers: stringArraySchema
      }
    },
    followUps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "priority", "owner", "evidence"],
        properties: {
          task: { type: "string" },
          priority: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
          owner: nullableStringSchema,
          evidence: evidenceArraySchema
        }
      }
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["risk", "mitigation", "evidence"],
        properties: {
          risk: { type: "string" },
          mitigation: nullableStringSchema,
          evidence: evidenceArraySchema
        }
      }
    },
    metrics: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["tokensTotal", "toolCalls", "filesRead", "filesWritten", "testsRun", "testFailures"],
      properties: {
        tokensTotal: nullableNumberSchema,
        toolCalls: nullableNumberSchema,
        filesRead: nullableNumberSchema,
        filesWritten: nullableNumberSchema,
        testsRun: nullableNumberSchema,
        testFailures: nullableNumberSchema
      }
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["confidence", "missingContext"],
      properties: {
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        missingContext: stringArraySchema
      }
    }
  }
} as const;

export function normalizeSessionDigest(value: unknown): SessionDigest {
  const record = coerceObject(value);
  const conversation = coerceObject(record.conversation);
  const summary = coerceObject(record.summary);
  const standup = coerceObject(record.standup);
  const quality = coerceObject(record.quality);

  return {
    schema: "daily.session-digest.v1",
    conversation: {
      id: stringValue(conversation.id),
      provider: conversation.provider === "codex" ? "codex" : "claude",
      title: stringValue(conversation.title) || "Untitled conversation",
      startedAt: optionalString(conversation.startedAt),
      endedAt: optionalString(conversation.endedAt),
      dateBucket: stringValue(conversation.dateBucket),
      branch: optionalString(conversation.branch)
    },
    headline: stringValue(record.headline),
    summary: {
      short: stringValue(summary.short),
      detailed: optionalString(summary.detailed)
    },
    workDone: normalizeWorkDone(record.workDone),
    decisions: normalizeDecisions(record.decisions),
    experiments: normalizeExperiments(record.experiments),
    ideas: normalizeIdeas(record.ideas),
    designNotes: normalizeDesignNotes(record.designNotes),
    standup: {
      done: stringArray(standup.done),
      next: stringArray(standup.next),
      blockers: stringArray(standup.blockers)
    },
    followUps: normalizeFollowUps(record.followUps),
    risks: normalizeRisks(record.risks),
    metrics: coerceMetrics(record.metrics),
    quality: {
      confidence: quality.confidence === "high" || quality.confidence === "medium" ? quality.confidence : "low",
      missingContext: stringArray(quality.missingContext)
    }
  };
}

function normalizeWorkDone(value: unknown): SessionDigest["workDone"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      text: stringValue(record.text),
      files: optionalStringArray(record.files),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.text || item.files?.length || item.evidence.length);
}

function normalizeDecisions(value: unknown): SessionDigest["decisions"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      decision: stringValue(record.decision),
      rationale: optionalString(record.rationale),
      alternativesConsidered: optionalStringArray(record.alternativesConsidered),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.decision || item.evidence.length);
}

function normalizeExperiments(value: unknown): SessionDigest["experiments"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      questionOrHypothesis: stringValue(record.questionOrHypothesis),
      whatWasTried: stringValue(record.whatWasTried),
      outcome: experimentOutcome(record.outcome),
      details: optionalString(record.details),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.questionOrHypothesis || item.whatWasTried || item.evidence.length);
}

function normalizeIdeas(value: unknown): SessionDigest["ideas"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      idea: stringValue(record.idea),
      whyItMatters: optionalString(record.whyItMatters),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.idea || item.evidence.length);
}

function normalizeDesignNotes(value: unknown): SessionDigest["designNotes"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      title: stringValue(record.title),
      context: stringValue(record.context),
      proposal: optionalString(record.proposal),
      tradeoffs: optionalStringArray(record.tradeoffs),
      openQuestions: optionalStringArray(record.openQuestions),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.title || item.context || item.evidence.length);
}

function normalizeFollowUps(value: unknown): SessionDigest["followUps"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      task: stringValue(record.task),
      priority: priority(record.priority),
      owner: optionalString(record.owner),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.task || item.evidence.length);
}

function normalizeRisks(value: unknown): SessionDigest["risks"] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      risk: stringValue(record.risk),
      mitigation: optionalString(record.mitigation),
      evidence: normalizeEvidence(record.evidence)
    };
  }).filter((item) => item.risk || item.evidence.length);
}

function normalizeEvidence(value: unknown): EvidenceRef[] {
  return arrayValue(value).map((item) => {
    const record = coerceObject(item);
    return {
      eventId: optionalString(record.eventId),
      messageId: optionalString(record.messageId),
      toolCallId: optionalString(record.toolCallId),
      file: optionalString(record.file),
      quote: optionalString(record.quote)
    };
  }).filter((item) => item.eventId || item.messageId || item.toolCallId || item.file || item.quote);
}

function coerceMetrics(value: unknown): SessionDigest["metrics"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    tokensTotal: numberValue(record.tokensTotal),
    toolCalls: numberValue(record.toolCalls),
    filesRead: numberValue(record.filesRead),
    filesWritten: numberValue(record.filesWritten),
    testsRun: numberValue(record.testsRun),
    testFailures: numberValue(record.testFailures)
  };
}

function coerceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalStringArray(value: unknown): string[] | undefined {
  const values = stringArray(value);
  return values.length ? values : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function experimentOutcome(value: unknown): SessionDigest["experiments"][number]["outcome"] {
  return value === "worked" || value === "failed" || value === "inconclusive" ? value : "unknown";
}

function priority(value: unknown): NonNullable<SessionDigest["followUps"][number]["priority"]> | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
