import type { ConvosDataset, ToolCallWithResult, TurnListItem } from "@convos/convos";
import type { ResolvedRepoInfo as DailyRepoInfo } from "@tangent/repo";

import type { DailyConfig } from "../types/config.js";
import type { TurnDigestInput } from "../types/digest.js";
import { excerptText, previewUnknown, truncateCompact } from "../core/redaction.js";

export function buildTurnDigestInput(args: {
  dataset: ConvosDataset;
  repo: DailyRepoInfo;
  config: DailyConfig;
  turn: TurnListItem;
  dateBucket: string;
}): TurnDigestInput {
  const { dataset, repo, config, turn, dateBucket } = args;
  const messages = config.input.includeVisibleMessages
    ? dataset.messages.visible({ conversationId: turn.conversationId, turnId: turn.turnId }).data
    : [];
  const tools = dataset.tools.calls({
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    includeResults: config.input.includeToolResults ? "full" : "none"
  }).data;
  const timeline = dataset.activity.timeline({ conversationId: turn.conversationId, turnId: turn.turnId }).data;

  const input: TurnDigestInput = {
    schema: "daily.turn-digest-input.v1",
    repo: {
      name: config.repo?.displayName || repo.displayName,
      rootHash: repo.rootHash,
      branch: repo.branch
    },
    source: {
      provider: turn.provider,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      sourceKey: turn.sourceKey,
      dateBucket,
      startedAt: turn.startedAt?.toISOString(),
      endedAt: turn.endedAt?.toISOString(),
      wallTimeMs: wallTimeMs(turn),
      sourceFingerprint: turn.sourceFingerprint,
      captureConfidence: turn.captureConfidence
    },
    transcript: messages
      .map((message) => ({
        role: message.role,
        text: messageText(message.text || message.textPreview || "", config, 4000),
        eventId: message.id,
        confidence: message.confidence === "exact" ? "exact" as const : "partial" as const
      }))
      .filter((message) => message.text.length > 0),
    activity: {
      commands: tools.filter((tool) => tool.category === "command").map((tool) => commandInput(tool, config)),
      fileChanges: fileChanges(tools),
      toolHighlights: tools.map((tool) => toolHighlight(tool, config)),
      compactions: timeline
        .filter((event) => event.kind === "compact.pre" || event.kind === "compact.post")
        .map((event) => ({
          trigger: triggerValue(field(event.data, "trigger")),
          summary: stringField(event.data, "compact_summary") || stringField(event.data, "summary"),
          eventId: event.eventId
        })),
      subagents: timeline
        .filter((event) => event.kind === "subagent.stop")
        .map((event) => ({
          agentType: stringField(event.data, "agent_type"),
          finalMessage: stringField(event.data, "last_assistant_message"),
          eventId: event.eventId
        }))
    },
    evidence: timeline.map((event) => ({
      id: event.eventId,
      eventId: event.eventId,
      kind: event.kind,
      quote: event.summary
    })),
    omissions: {
      rawToolResultsOmitted: 0,
      longMessagesTruncated: 0,
      filesContentOmitted: 0,
      reason: []
    }
  };

  return clampTurnInput(input, config.input.maxTurnInputChars, config);
}

export function isProcessableTurn(turn: TurnListItem, config: DailyConfig, includeActiveOverride = false): boolean {
  if (turn.status !== "active") return true;
  if (!config.processing.includeActiveConversations && !includeActiveOverride) return false;
  const quietMs = config.processing.activeQuietMinutes * 60 * 1000;
  return Date.now() - turn.lastActivityAt.getTime() >= quietMs;
}

function commandInput(tool: ToolCallWithResult, config: DailyConfig): TurnDigestInput["activity"]["commands"][number] {
  const command = commandText(tool.input) || "unknown";
  const resultText = previewUnknown(tool.result?.output, config.input.maxToolResultChars, config.privacy.redactSecrets);
  return {
    command: excerptText(command, 500, config.privacy.redactSecrets),
    status: tool.result?.status || "unknown",
    durationMs: tool.result?.durationMs,
    isTest: /\b(test|vitest|jest|mocha|pytest|cargo test|go test)\b/i.test(command),
    isBuild: /\b(build|tsc|webpack|vite build|cargo build)\b/i.test(command),
    isLint: /\b(lint|eslint|ruff|flake8)\b/i.test(command),
    outputPreview: tool.result?.status === "error" ? resultText : undefined,
    evidenceEventId: tool.evidenceEventId
  };
}

function fileChanges(tools: ToolCallWithResult[]): TurnDigestInput["activity"]["fileChanges"] {
  const rows = new Map<string, TurnDigestInput["activity"]["fileChanges"][number]>();
  for (const tool of tools) {
    for (const filePath of tool.targetPaths) {
      rows.set(`${actionForTool(tool.category)}:${filePath}`, {
        path: filePath,
        action: actionForTool(tool.category),
        toolCallId: tool.id
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function toolHighlight(tool: ToolCallWithResult, config: DailyConfig): TurnDigestInput["activity"]["toolHighlights"][number] {
  const includeResult = tool.result?.status === "error";
  return {
    toolName: tool.toolName,
    category: tool.category,
    inputSummary: config.input.includeToolInputs ? previewUnknown(tool.input, 1000, config.privacy.redactSecrets) : undefined,
    resultSummary: includeResult ? previewUnknown(tool.result?.output, config.input.maxToolResultChars, config.privacy.redactSecrets) : undefined,
    status: tool.result?.status,
    evidenceEventId: tool.evidenceEventId
  };
}

function clampTurnInput(input: TurnDigestInput, maxChars: number, config: DailyConfig): TurnDigestInput {
  const steps: Array<(value: TurnDigestInput) => TurnDigestInput> = [
    (value) => value,
    (value) => withTranscriptCap(value, 1500),
    (value) => dropSuccessfulToolSummaries(withTranscriptCap(value, 800)),
    (value) => limitCollections(dropSuccessfulToolSummaries(withTranscriptCap(value, 400)), 80),
    (value) => lastResortTurnInput(value, config)
  ];

  for (const step of steps) {
    const candidate = step(structuredClone(input) as TurnDigestInput);
    annotateOmissions(candidate, input);
    if (JSON.stringify(candidate).length <= maxChars) return candidate;
  }

  const minimal = lastResortTurnInput(input, config);
  minimal.transcript = minimal.transcript.map((message) => ({ ...message, text: truncateCompact(message.text, 120) }));
  minimal.activity.toolHighlights = [];
  minimal.evidence = [];
  annotateOmissions(minimal, input);
  return minimal;
}

function withTranscriptCap(input: TurnDigestInput, maxChars: number): TurnDigestInput {
  input.transcript = input.transcript.map((message) => ({ ...message, text: truncateCompact(message.text, maxChars) }));
  return input;
}

function dropSuccessfulToolSummaries(input: TurnDigestInput): TurnDigestInput {
  input.activity.toolHighlights = input.activity.toolHighlights.map((tool) => ({
    ...tool,
    inputSummary: tool.status === "error" ? tool.inputSummary : undefined,
    resultSummary: tool.status === "error" ? tool.resultSummary : undefined
  }));
  return input;
}

function limitCollections(input: TurnDigestInput, limit: number): TurnDigestInput {
  input.activity.toolHighlights = input.activity.toolHighlights.slice(0, limit);
  input.activity.fileChanges = input.activity.fileChanges.slice(0, limit * 2);
  input.evidence = input.evidence.slice(0, limit * 2);
  return input;
}

function lastResortTurnInput(input: TurnDigestInput, config: DailyConfig): TurnDigestInput {
  return {
    ...input,
    transcript: input.transcript.map((message) => ({ ...message, text: truncateCompact(message.text, config.privacy.maxQuoteChars) })),
    activity: {
      commands: input.activity.commands.map((command) => ({ ...command, outputPreview: command.status === "error" ? truncateCompact(command.outputPreview || "", 500) : undefined })),
      fileChanges: input.activity.fileChanges.slice(0, 100),
      toolHighlights: input.activity.toolHighlights
        .filter((tool) => tool.status === "error")
        .slice(0, 30)
        .map((tool) => ({ ...tool, inputSummary: undefined, resultSummary: truncateCompact(tool.resultSummary || "", 500) })),
      compactions: input.activity.compactions.map((entry) => ({ ...entry, summary: truncateCompact(entry.summary || "", 500) })),
      subagents: input.activity.subagents.map((entry) => ({ ...entry, finalMessage: truncateCompact(entry.finalMessage || "", 500) }))
    },
    evidence: input.evidence.slice(0, 80)
  };
}

function annotateOmissions(candidate: TurnDigestInput, original: TurnDigestInput): void {
  candidate.omissions.longMessagesTruncated = original.transcript.filter((message, index) => message.text.length > (candidate.transcript[index]?.text.length || 0)).length;
  candidate.omissions.rawToolResultsOmitted = original.activity.toolHighlights.filter((tool, index) => tool.resultSummary && !candidate.activity.toolHighlights[index]?.resultSummary).length;
  candidate.omissions.filesContentOmitted = candidate.activity.fileChanges.length;
  candidate.omissions.reason = [
    candidate.omissions.longMessagesTruncated ? "Long transcript messages were truncated." : undefined,
    candidate.omissions.rawToolResultsOmitted ? "Raw or successful tool result bodies were omitted." : undefined,
    "File contents are not captured by default."
  ].filter((item): item is string => Boolean(item));
}

function wallTimeMs(turn: TurnListItem): number | undefined {
  if (!turn.startedAt || !turn.endedAt) return undefined;
  return turn.endedAt.getTime() - turn.startedAt.getTime();
}

function messageText(text: string, config: DailyConfig, maxChars: number): string {
  if (config.privacy.contentMode === "metadata-only") return "";
  return excerptText(text, maxChars, config.privacy.redactSecrets);
}

function commandText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.command === "string" ? record.command : typeof record.cmd === "string" ? record.cmd : undefined;
}

function actionForTool(category: string): "read" | "searched" | "wrote" | "edited" | "unknown" {
  if (category === "file_read") return "read";
  if (category === "file_search") return "searched";
  if (category === "file_write") return "edited";
  return "unknown";
}

function triggerValue(value: unknown): "manual" | "auto" | "unknown" {
  return value === "manual" || value === "auto" ? value : "unknown";
}

function field(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

function stringField(data: unknown, key: string): string | undefined {
  const value = field(data, key);
  return typeof value === "string" ? value : undefined;
}
