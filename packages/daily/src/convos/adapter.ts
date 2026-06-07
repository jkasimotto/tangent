import type { ConversationListItem, ConvosDataset, ConvosJsonlLineV1, ConvosProvider } from "@convos/convos";
import path from "node:path";

import type { DailyConfig } from "../types/config.js";
import type { SessionDigestInput } from "../types/digest.js";
import type { DailyRepoInfo } from "../core/repo.js";
import { excerptText, previewUnknown, truncateCompact } from "../core/redaction.js";
import { dateBucket as formatDateBucket } from "../core/time.js";
import { eventShortType, evidenceRef } from "./evidence.js";

type SessionTokens = NonNullable<NonNullable<SessionDigestInput["metrics"]>["tokens"]>;

export type ConversationEnvelope = {
  conversation: ConversationListItem & {
    lastActivityAt?: Date;
  };
  provider: ConvosProvider;
  dateBucket: string;
  lastActivityAt?: Date;
  eventHighWatermark?: string;
};

export function conversationEnvelopes(dataset: ConvosDataset, config: DailyConfig): ConversationEnvelope[] {
  const rows = dataset.conversations.all().data;
  return rows.map((conversation) => {
    const events = eventsForConversation(dataset, conversation.id);
    const lastEvent = events.at(-1);
    const lastActivityAt = lastEvent ? new Date(lastEvent.observed_at || lastEvent.recorded_at) : conversation.endedAt || conversation.startedAt;
    const bucketDate = dateForBucket(conversation, lastActivityAt, config.processing.dateBucket);
    return {
      conversation: { ...conversation, lastActivityAt },
      provider: conversation.provider,
      dateBucket: bucketDate ? formatDateBucket(bucketDate, config.processing.timezone) : formatDateBucket(new Date(), config.processing.timezone),
      lastActivityAt,
      eventHighWatermark: lastEvent?.event_id
    };
  });
}

export function isProcessable(envelope: ConversationEnvelope, config: DailyConfig, includeActiveOverride = false): boolean {
  if (envelope.conversation.endedAt) return true;
  if (!config.processing.includeActiveConversations && !includeActiveOverride) return false;
  if (!envelope.lastActivityAt) return false;
  const quietMs = config.processing.activeQuietMinutes * 60 * 1000;
  return Date.now() - envelope.lastActivityAt.getTime() >= quietMs;
}

export function buildSessionDigestInput(args: {
  dataset: ConvosDataset;
  repo: DailyRepoInfo;
  config: DailyConfig;
  envelope: ConversationEnvelope;
}): SessionDigestInput {
  const { dataset, repo, config, envelope } = args;
  const conversation = envelope.conversation;
  const events = eventsForConversation(dataset, conversation.id);
  const visibleMessages = config.input.includeVisibleMessages ? dataset.messages.visible({ conversationId: conversation.id }).data : [];
  const toolCalls = dataset.tools.calls({ conversationId: conversation.id, includeResults: config.input.includeToolResults }).data;
  const internalEvents = config.input.includeInternalMessages ? dataset.messages.internal({ conversationId: conversation.id }).data as ConvosJsonlLineV1[] : [];

  const messages = visibleMessages.map((message) => ({
    role: message.role,
    visible: true,
    text: messageText(message.text, message.textPreview, config),
    at: message.createdAt?.toISOString(),
    eventId: message.id
  })).filter((message) => message.text.length > 0);

  const tools = toolCalls.map((tool) => ({
    id: tool.id,
    name: tool.toolName,
    category: tool.category,
    inputPreview: config.input.includeToolInputs ? previewUnknown(tool.input, 1000, config.privacy.redactSecrets) : undefined,
    resultPreview: config.input.includeToolResults ? previewUnknown(tool.result?.output, config.input.maxToolResultChars, config.privacy.redactSecrets) : undefined,
    status: tool.result?.status,
    durationMs: tool.result?.durationMs,
    targetPaths: config.input.includeFilePaths ? filterPaths(tool.targetPaths, config) : undefined
  }));

  const fileEvents = events.filter((event) => event.kind === "file.read" || event.kind === "file.write" || event.kind === "file.search");
  const commandEvents = events.filter((event) => event.kind === "command.exec");
  const tokens = config.input.includeTokenUsage ? aggregateTokens(dataset.tokens.byConversation({ conversationId: conversation.id }).data) : undefined;
  const rawInput: SessionDigestInput = {
    schema: "daily.session-digest-input.v1",
    repo: {
      name: config.repo?.displayName || repo.displayName,
      root: repo.root,
      branch: repo.branch
    },
    conversation: {
      id: conversation.id,
      provider: conversation.provider,
      title: conversation.title || truncateCompact(conversation.firstPrompt || "", 80) || undefined,
      startedAt: conversation.startedAt?.toISOString(),
      endedAt: conversation.endedAt?.toISOString(),
      lastActivityAt: envelope.lastActivityAt?.toISOString(),
      durationMs: conversation.startedAt && conversation.endedAt ? conversation.endedAt.getTime() - conversation.startedAt.getTime() : undefined,
      dateBucket: envelope.dateBucket
    },
    messages,
    internal: internalEvents.map((event) => ({
      kind: internalKind(event),
      text: stringField(event.data, "text") || stringField(event.data, "summary"),
      structured: typeof event.data === "object" ? event.data : undefined,
      eventId: event.event_id
    })),
    tools,
    files: {
      read: eventPaths(fileEvents.filter((event) => event.kind === "file.read"), config),
      written: eventPaths(fileEvents.filter((event) => event.kind === "file.write"), config),
      searched: eventPaths(fileEvents.filter((event) => event.kind === "file.search"), config)
    },
    commands: commandEvents.map((event) => {
      const command = stringField(event.data, "command") || stringField(event.data, "cmd") || previewUnknown(event.data, 240, config.privacy.redactSecrets) || "unknown";
      return {
        command: excerptText(command, 500, config.privacy.redactSecrets),
        classification: classifyCommand(command),
        status: statusField(event.data),
        outputPreview: previewUnknown(field(event.data, "output") ?? field(event.data, "stdout") ?? field(event.data, "stderr"), config.input.maxToolResultChars, config.privacy.redactSecrets)
      };
    }),
    metrics: {
      tokens,
      toolCalls: tools.length,
      filesTouched: new Set([...eventPaths(fileEvents, config), ...tools.flatMap((tool) => tool.targetPaths || [])]).size
    },
    evidenceIndex: events.map((event) => ({
      eventId: event.event_id,
      type: eventShortType(event),
      shortRef: evidenceRef(event)
    }))
  };

  return clampConversation(rawInput, config.input.maxConversationChars);
}

export function eventsForConversation(dataset: ConvosDataset, conversationId: string): ConvosJsonlLineV1[] {
  return dataset.events.filter((event) => event.conversation.id === conversationId);
}

function dateForBucket(conversation: ConversationListItem, lastActivityAt: Date | undefined, bucketBy: DailyConfig["processing"]["dateBucket"]): Date | undefined {
  if (bucketBy === "startedAt") return conversation.startedAt || lastActivityAt || conversation.endedAt;
  if (bucketBy === "lastActivityAt") return lastActivityAt || conversation.endedAt || conversation.startedAt;
  return conversation.endedAt || lastActivityAt || conversation.startedAt;
}

function messageText(text: string | undefined, preview: string | undefined, config: DailyConfig): string {
  if (config.privacy.contentMode === "metadata-only") return preview ? excerptText(preview, config.privacy.maxQuoteChars, config.privacy.redactSecrets) : "";
  const max = config.privacy.contentMode === "full" ? 8000 : config.privacy.maxQuoteChars * 4;
  return excerptText(text || preview || "", max, config.privacy.redactSecrets);
}

function filterPaths(paths: string[], config: DailyConfig): string[] {
  if (!config.input.includeFilePaths) return [];
  const excludes = config.privacy.excludePathGlobs;
  return [...new Set(paths.filter((filePath) => !excludes.some((pattern) => pathMatches(pattern, filePath))))].sort();
}

function eventPaths(events: ConvosJsonlLineV1[], config: DailyConfig): string[] {
  return filterPaths(events.flatMap((event) => {
    const values = [field(event.data, "path"), field(event.data, "file"), field(event.data, "target_path"), field(event.data, "targetPaths"), field(event.data, "target_paths")];
    return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string");
  }), config);
}

function classifyCommand(command: string): SessionDigestInput["commands"][number]["classification"] {
  const lower = command.toLowerCase();
  return {
    isTest: /\b(test|vitest|jest|mocha|pytest|cargo test|go test)\b/.test(lower),
    isBuild: /\b(build|tsc|webpack|vite build|cargo build)\b/.test(lower),
    isLint: /\b(lint|eslint|ruff|flake8)\b/.test(lower),
    isTypecheck: /\b(tsc|typecheck|mypy|pyright)\b/.test(lower),
    isDestructive: /\b(rm\s+-rf|git\s+reset|git\s+clean|drop\s+database|truncate\s+table)\b/.test(lower)
  };
}

function aggregateTokens(rows: unknown[]): SessionTokens | undefined {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let total = 0;
  let found = false;
  for (const row of rows) {
    for (const usage of collectUsageObjects(row)) {
      input += numberField(usage, "input") || numberField(usage, "input_tokens") || 0;
      output += numberField(usage, "output") || numberField(usage, "output_tokens") || 0;
      cacheRead += numberField(usage, "cacheRead") || numberField(usage, "cache_read_input_tokens") || 0;
      total += numberField(usage, "total") || numberField(usage, "total_tokens") || 0;
      found = true;
    }
  }
  if (!found) return undefined;
  const computedTotal = total || input + output + cacheRead;
  return {
    input: input || undefined,
    output: output || undefined,
    cacheRead: cacheRead || undefined,
    total: computedTotal || undefined,
    confidence: "derived"
  };
}

function collectUsageObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectUsageObjects);
  const record = value as Record<string, unknown>;
  const direct = "usage" in record ? collectUsageObjects(record.usage) : [];
  const isUsage = Object.keys(record).some((key) => key.includes("token") || key === "input" || key === "output" || key === "total");
  return isUsage ? [record, ...direct] : [...direct, ...Object.values(record).flatMap(collectUsageObjects)];
}

function clampConversation(input: SessionDigestInput, maxChars: number): SessionDigestInput {
  const clone = structuredClone(input) as SessionDigestInput;
  while (JSON.stringify(clone).length > maxChars && clone.messages.length > 0) {
    const longest = clone.messages.reduce((best, message, index) => message.text.length > clone.messages[best]!.text.length ? index : best, 0);
    clone.messages[longest]!.text = truncateCompact(clone.messages[longest]!.text, Math.max(240, Math.floor(clone.messages[longest]!.text.length * 0.75)));
  }
  return clone;
}

function internalKind(event: ConvosJsonlLineV1): NonNullable<SessionDigestInput["internal"]>[number]["kind"] {
  if (event.kind === "compact.post" || event.kind === "compact.pre") return "compaction_summary";
  if (event.kind === "subagent.stop") return "subagent_summary";
  if (event.kind === "message.system") return "system";
  return "reasoning_summary";
}

function field(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

function stringField(data: unknown, key: string): string | undefined {
  const value = field(data, key);
  return typeof value === "string" ? value : undefined;
}

function numberField(data: unknown, key: string): number | undefined {
  const value = field(data, key);
  return typeof value === "number" ? value : undefined;
}

function statusField(data: unknown): "success" | "error" | "unknown" | undefined {
  const value = stringField(data, "status");
  return value === "success" || value === "error" || value === "unknown" ? value : undefined;
}

function pathMatches(pattern: string, filePath: string): boolean {
  if (pattern === filePath) return true;
  if (pattern.endsWith("/**")) return filePath.startsWith(pattern.slice(0, -3));
  if (pattern.startsWith("**/")) return filePath.endsWith(pattern.slice(3));
  if (pattern.includes("*")) {
    const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}$`).test(filePath);
  }
  return filePath === pattern || filePath.startsWith(`${pattern}${path.sep}`);
}
