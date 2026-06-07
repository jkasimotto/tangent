import type { SessionDigest } from "../types/digest.js";

const evidenceArraySchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      eventId: { type: "string" },
      messageId: { type: "string" },
      toolCallId: { type: "string" },
      file: { type: "string" },
      quote: { type: "string" }
    }
  }
} as const;

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
    "quality"
  ],
  properties: {
    schema: { const: "daily.session-digest.v1" },
    conversation: {
      type: "object",
      additionalProperties: false,
      required: ["id", "provider", "title", "dateBucket"],
      properties: {
        id: { type: "string" },
        provider: { enum: ["claude", "codex"] },
        title: { type: "string" },
        startedAt: { type: "string" },
        endedAt: { type: "string" },
        dateBucket: { type: "string" },
        branch: { type: "string" }
      }
    },
    headline: { type: "string" },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["short"],
      properties: {
        short: { type: "string" },
        detailed: { type: "string" }
      }
    },
    workDone: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: {
          text: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          evidence: evidenceArraySchema
        }
      }
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "evidence"],
        properties: {
          decision: { type: "string" },
          rationale: { type: "string" },
          alternativesConsidered: { type: "array", items: { type: "string" } },
          evidence: evidenceArraySchema
        }
      }
    },
    experiments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionOrHypothesis", "whatWasTried", "outcome", "evidence"],
        properties: {
          questionOrHypothesis: { type: "string" },
          whatWasTried: { type: "string" },
          outcome: { enum: ["worked", "failed", "inconclusive", "unknown"] },
          details: { type: "string" },
          evidence: evidenceArraySchema
        }
      }
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["idea", "evidence"],
        properties: {
          idea: { type: "string" },
          whyItMatters: { type: "string" },
          evidence: evidenceArraySchema
        }
      }
    },
    designNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "context", "evidence"],
        properties: {
          title: { type: "string" },
          context: { type: "string" },
          proposal: { type: "string" },
          tradeoffs: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
          evidence: evidenceArraySchema
        }
      }
    },
    standup: {
      type: "object",
      additionalProperties: false,
      required: ["done", "next", "blockers"],
      properties: {
        done: { type: "array", items: { type: "string" } },
        next: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } }
      }
    },
    followUps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "evidence"],
        properties: {
          task: { type: "string" },
          priority: { enum: ["low", "medium", "high"] },
          owner: { type: "string" },
          evidence: evidenceArraySchema
        }
      }
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["risk", "evidence"],
        properties: {
          risk: { type: "string" },
          mitigation: { type: "string" },
          evidence: evidenceArraySchema
        }
      }
    },
    metrics: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokensTotal: { type: "number" },
        toolCalls: { type: "number" },
        filesRead: { type: "number" },
        filesWritten: { type: "number" },
        testsRun: { type: "number" },
        testFailures: { type: "number" }
      }
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["confidence"],
      properties: {
        confidence: { enum: ["high", "medium", "low"] },
        missingContext: { type: "array", items: { type: "string" } }
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
    workDone: arrayValue(record.workDone),
    decisions: arrayValue(record.decisions),
    experiments: arrayValue(record.experiments),
    ideas: arrayValue(record.ideas),
    designNotes: arrayValue(record.designNotes),
    standup: {
      done: stringArray(standup.done),
      next: stringArray(standup.next),
      blockers: stringArray(standup.blockers)
    },
    followUps: arrayValue(record.followUps),
    risks: arrayValue(record.risks),
    metrics: coerceMetrics(record.metrics),
    quality: {
      confidence: quality.confidence === "high" || quality.confidence === "medium" ? quality.confidence : "low",
      missingContext: stringArray(quality.missingContext)
    }
  };
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
