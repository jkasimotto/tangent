import type { TopicRollup, TurnDigest } from "../types/digest.js";

const evidenceRefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "eventId", "toolCallId", "file", "quote", "kind"],
  properties: {
    id: { type: "string" },
    eventId: { type: "string" },
    toolCallId: { type: "string" },
    file: { type: "string" },
    quote: { type: "string" },
    kind: { type: "string" }
  }
};

export const turnDigestJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "topicHints",
    "headline",
    "summary",
    "workDone",
    "designNotes",
    "decisions",
    "experiments",
    "debuggingFindings",
    "followUps",
    "entities",
    "evidence",
    "quality"
  ],
  properties: {
    schema: { const: "daily.turn-digest.v1" },
    topicHints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "confidence"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          confidence: { enum: ["high", "medium", "low"] }
        }
      }
    },
    headline: { type: "string" },
    summary: { type: "string" },
    workDone: { type: "array", items: { type: "string" } },
    designNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "context", "options", "openQuestions"],
        properties: {
          title: { type: "string" },
          context: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "details", "pros", "cons"],
              properties: {
                name: { type: "string" },
                details: { type: "string" },
                pros: { type: "array", items: { type: "string" } },
                cons: { type: "array", items: { type: "string" } }
              }
            }
          },
          openQuestions: { type: "array", items: { type: "string" } }
        }
      }
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "rationale", "alternatives"],
        properties: {
          decision: { type: "string" },
          rationale: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } }
        }
      }
    },
    experiments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "method", "outcome", "details"],
        properties: {
          question: { type: "string" },
          method: { type: "string" },
          outcome: { enum: ["worked", "failed", "inconclusive", "unknown"] },
          details: { type: "string" }
        }
      }
    },
    debuggingFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symptom", "investigation", "finding", "fixOrNextStep"],
        properties: {
          symptom: { type: "string" },
          investigation: { type: "string" },
          finding: { type: "string" },
          fixOrNextStep: { type: "string" }
        }
      }
    },
    followUps: { type: "array", items: { type: "string" } },
    entities: {
      type: "object",
      additionalProperties: false,
      required: ["files", "functions", "tickets", "commands"],
      properties: {
        files: { type: "array", items: { type: "string" } },
        functions: { type: "array", items: { type: "string" } },
        tickets: { type: "array", items: { type: "string" } },
        commands: { type: "array", items: { type: "string" } }
      }
    },
    evidence: { type: "array", items: evidenceRefJsonSchema },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["confidence", "caveats"],
      properties: {
        confidence: { enum: ["high", "medium", "low"] },
        caveats: { type: "array", items: { type: "string" } }
      }
    }
  }
};

export const topicRollupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "date",
    "key",
    "title",
    "sourceTurnKeys",
    "providers",
    "timeSpentMs",
    "summary",
    "narrativeMarkdown",
    "sections",
    "decisions",
    "experiments",
    "openQuestions",
    "followUps",
    "evidence",
    "caveats"
  ],
  properties: {
    schema: { const: "daily.topic-rollup.v1" },
    date: { type: "string" },
    key: { type: "string" },
    title: { type: "string" },
    sourceTurnKeys: { type: "array", items: { type: "string" } },
    providers: { type: "array", items: { enum: ["claude", "codex"] } },
    timeSpentMs: { type: "number" },
    summary: { type: "string" },
    narrativeMarkdown: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "markdown"],
        properties: {
          heading: { type: "string" },
          markdown: { type: "string" }
        }
      }
    },
    decisions: { type: "array", items: { type: "string" } },
    experiments: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    followUps: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      items: {
        ...evidenceRefJsonSchema,
        required: [...evidenceRefJsonSchema.required, "sourceKey"],
        properties: { ...evidenceRefJsonSchema.properties, sourceKey: { type: "string" } }
      }
    },
    caveats: { type: "array", items: { type: "string" } }
  }
};

export const dayRollupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "markdown", "sourceCaveats"],
  properties: {
    schema: { const: "daily.rollup.v1" },
    markdown: { type: "string" },
    sourceCaveats: { type: "array", items: { type: "string" } }
  }
};

export function normalizeTurnDigest(value: unknown, defaults: Pick<TurnDigest, "source">): TurnDigest {
  const record = objectValue(value);
  return {
    schema: "daily.turn-digest.v1",
    source: {
      ...defaults.source,
      ...objectValue(record.source),
      sourceKey: stringValue(objectValue(record.source).sourceKey) || defaults.source.sourceKey,
      provider: providerValue(objectValue(record.source).provider) || defaults.source.provider,
      conversationId: stringValue(objectValue(record.source).conversationId) || defaults.source.conversationId,
      turnId: stringValue(objectValue(record.source).turnId) || defaults.source.turnId,
      dateBucket: stringValue(objectValue(record.source).dateBucket) || defaults.source.dateBucket,
      inputHash: stringValue(objectValue(record.source).inputHash) || defaults.source.inputHash
    },
    topicHints: arrayValue(record.topicHints).map(topicHint).filter((item): item is TurnDigest["topicHints"][number] => Boolean(item)),
    headline: stringValue(record.headline) || "Untitled turn",
    summary: stringValue(record.summary) || "",
    workDone: arrayValue(record.workDone).map(stringValue).filter(isString),
    designNotes: arrayValue(record.designNotes).map(designNote),
    decisions: arrayValue(record.decisions).map(decision),
    experiments: arrayValue(record.experiments).map(experiment),
    debuggingFindings: arrayValue(record.debuggingFindings).map(debuggingFinding),
    followUps: arrayValue(record.followUps).map(stringOrTask).filter(isString),
    entities: {
      files: stringArray(objectValue(record.entities).files),
      functions: stringArray(objectValue(record.entities).functions),
      tickets: stringArray(objectValue(record.entities).tickets),
      commands: stringArray(objectValue(record.entities).commands)
    },
    evidence: arrayValue(record.evidence).map((item) => objectValue(item)),
    quality: {
      confidence: confidenceValue(objectValue(record.quality).confidence) || "medium",
      caveats: stringArray(objectValue(record.quality).caveats)
    }
  };
}

export function normalizeTopicRollup(value: unknown, fallback: TopicRollup): TopicRollup {
  const record = objectValue(value);
  return {
    ...fallback,
    schema: "daily.topic-rollup.v1",
    date: stringValue(record.date) || fallback.date,
    key: stringValue(record.key) || fallback.key,
    title: stringValue(record.title) || fallback.title,
    sourceTurnKeys: stringArray(record.sourceTurnKeys).length ? stringArray(record.sourceTurnKeys) : fallback.sourceTurnKeys,
    providers: providerArray(record.providers).length ? providerArray(record.providers) : fallback.providers,
    timeSpentMs: numberValue(record.timeSpentMs) ?? fallback.timeSpentMs,
    summary: stringValue(record.summary) || fallback.summary,
    narrativeMarkdown: stringValue(record.narrativeMarkdown) || fallback.narrativeMarkdown,
    sections: arrayValue(record.sections).map((section) => ({
      heading: stringValue(objectValue(section).heading) || "Notes",
      markdown: stringValue(objectValue(section).markdown) || ""
    })),
    decisions: stringArray(record.decisions),
    experiments: stringArray(record.experiments),
    openQuestions: stringArray(record.openQuestions),
    followUps: stringArray(record.followUps),
    evidence: arrayValue(record.evidence).map((item) => objectValue(item)),
    caveats: stringArray(record.caveats)
  };
}

function topicHint(value: unknown): TurnDigest["topicHints"][number] | undefined {
  const record = objectValue(value);
  const title = stringValue(record.title);
  const key = slug(stringValue(record.key) || title);
  if (!key || !title) return undefined;
  return { key, title, confidence: confidenceValue(record.confidence) || "medium" };
}

function designNote(value: unknown): TurnDigest["designNotes"][number] {
  const record = objectValue(value);
  return {
    title: stringValue(record.title) || "Design note",
    context: stringValue(record.context) || "",
    options: arrayValue(record.options).map((option) => ({
      name: stringValue(objectValue(option).name) || "Option",
      details: stringValue(objectValue(option).details) || "",
      pros: stringArray(objectValue(option).pros),
      cons: stringArray(objectValue(option).cons)
    })),
    openQuestions: stringArray(record.openQuestions)
  };
}

function decision(value: unknown): TurnDigest["decisions"][number] {
  const record = objectValue(value);
  return {
    decision: stringValue(record.decision) || "",
    rationale: stringValue(record.rationale),
    alternatives: stringArray(record.alternatives)
  };
}

function experiment(value: unknown): TurnDigest["experiments"][number] {
  const record = objectValue(value);
  return {
    question: stringValue(record.question) || stringValue(record.questionOrHypothesis) || "",
    method: stringValue(record.method) || stringValue(record.whatWasTried) || "",
    outcome: outcomeValue(record.outcome),
    details: stringValue(record.details)
  };
}

function debuggingFinding(value: unknown): TurnDigest["debuggingFindings"][number] {
  const record = objectValue(value);
  return {
    symptom: stringValue(record.symptom) || "",
    investigation: stringValue(record.investigation) || "",
    finding: stringValue(record.finding) || "",
    fixOrNextStep: stringValue(record.fixOrNextStep)
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map(stringValue).filter(isString);
}

function providerValue(value: unknown): "claude" | "codex" | undefined {
  return value === "claude" || value === "codex" ? value : undefined;
}

function providerArray(value: unknown): Array<"claude" | "codex"> {
  return arrayValue(value).map(providerValue).filter((item): item is "claude" | "codex" => Boolean(item));
}

function confidenceValue(value: unknown): "high" | "medium" | "low" | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function outcomeValue(value: unknown): "worked" | "failed" | "inconclusive" | "unknown" {
  return value === "worked" || value === "failed" || value === "inconclusive" || value === "unknown" ? value : "unknown";
}

function stringOrTask(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return stringValue(objectValue(value).task);
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function slug(value: string | undefined): string {
  return (value || "general")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";
}
