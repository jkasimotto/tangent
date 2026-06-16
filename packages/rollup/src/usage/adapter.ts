import type { UsageDataset, TurnListItem } from "@tangent/usage-index-sqlite";
import type { ResolvedRepoInfo as RollupRepoInfo } from "@tangent/repo";

import type { RollupConfig } from "../types/config.js";
import type { RollupInput, RollupPurpose } from "../types/digest.js";
import type { RollupPeriod } from "../types/period.js";
import type { RollupStyleExample } from "../core/examples.js";
import { redactMessageText } from "../core/redaction.js";

/** Builds the period-level rollup input from selected Usage turns and user messages. */
export function buildRollupInput(args: {
  dataset: UsageDataset;
  repo: RollupRepoInfo;
  config: RollupConfig;
  turns: TurnListItem[];
  period: RollupPeriod;
  examples?: RollupStyleExample[];
  purpose?: RollupPurpose;
}): RollupInput {
  const { dataset, repo, config, turns, period } = args;
  const purpose = sanitizePurpose(args.purpose);
  const maxUserMessageChars = config.input.maxUserMessageChars;
  const excludedLongMessages: Array<{ sourceKey: string; chars: number }> = [];

  const conversations = turns.map((turn) => {
    const messages = dataset.messages.visible({
      conversationId: turn.conversationId,
      turnId: turn.turnId
    }).data
      .filter((message) => message.role === "user")
      .flatMap((message) => {
        const rawText = message.text || message.textPreview || "";
        const chars = messageLength(rawText);
        if (Number.isFinite(maxUserMessageChars) && maxUserMessageChars >= 0 && chars > maxUserMessageChars) {
          excludedLongMessages.push({ sourceKey: turn.sourceKey, chars });
          return [];
        }
        const text = redactMessageText(rawText, config.privacy.redactSecrets);
        if (!text.trim()) return [];
        return [{
          id: message.id,
          role: "user" as const,
          at: message.createdAt?.toISOString(),
          text,
          confidence: message.confidence,
          source: message.source
        }];
      });

    return {
      schema: "rollup.user-conversation.v1" as const,
      provider: turn.provider,
      conversationId: turn.conversationId,
      providerSessionId: turn.providerSessionId,
      turnId: turn.turnId,
      sourceKey: turn.sourceKey,
      titlePreview: turn.titlePreview,
      startedAt: turn.startedAt?.toISOString(),
      endedAt: turn.endedAt?.toISOString(),
      lastActivityAt: turn.lastActivityAt.toISOString(),
      messages
    };
  });

  const sourceCaveats = [
    ...dataset.warnings.map((warning) => warning.message),
    "Rollup input intentionally contains user messages only. Assistant messages, tool calls, tool results, token metadata, and assistant-produced context were excluded."
  ];
  if (excludedLongMessages.length > 0) {
    sourceCaveats.push(longMessageCaveat(excludedLongMessages, maxUserMessageChars));
  }

  return {
    schema: "rollup.input.v1",
    messageMode: "user-only",
    period,
    purpose,
    timezone: config.processing.timezone,
    repo: {
      name: config.repo?.displayName || repo.displayName,
      rootHash: repo.rootHash,
      branch: repo.branch
    },
    source: {
      generatedAt: new Date().toISOString(),
      providers: unique(turns.map((turn) => turn.provider)),
      conversationIds: unique(turns.map((turn) => turn.conversationId)),
      sourceFiles: dataset.provenance.sourceFiles,
      caveats: unique(sourceCaveats)
    },
    examples: args.examples || [],
    conversations
  };
}

/** Counts user-visible characters in a message. */
function messageLength(text: string): number {
  return Array.from(text).length;
}

/** Summarizes user messages omitted by the max length filter. */
function longMessageCaveat(messages: Array<{ sourceKey: string; chars: number }>, maxChars: number): string {
  const longest = Math.max(...messages.map((message) => message.chars));
  const affectedTurns = unique(messages.map((message) => message.sourceKey)).length;
  return `Excluded ${messages.length} user message(s) longer than ${maxChars} characters from rollup input across ${affectedTurns} turn(s); longest was ${longest} characters.`;
}

/** Renders rollup input messages into a readable artifact for inspection. */
export function renderRollupMessages(input: RollupInput): string {
  const lines: string[] = [
    `# Rollup user messages - ${input.period.label}`,
    "",
    `Repo: ${input.repo.name}`,
    `Mode: ${input.messageMode}`,
    `Providers: ${input.source.providers.join(", ") || "none"}`,
    ""
  ];

  for (const conversation of input.conversations) {
    lines.push(`## ${conversation.sourceKey}`, "");
    for (const message of conversation.messages) {
      lines.push(`### ${message.at || "--"} ${message.role}`);
      if (message.text) lines.push("", message.text.trim(), "");
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/** Normalizes optional purpose fields before including them in rollup input. */
function sanitizePurpose(purpose?: RollupPurpose): RollupPurpose | undefined {
  if (!purpose?.request) return undefined;
  return {
    ...purpose,
    focusTerms: purpose.focusTerms?.filter((term) => Boolean(term && String(term).trim())) || [],
    request: purpose.request.trim(),
    title: purpose.title?.trim() || undefined
  };
}

/** Returns truthy values in first-seen order without duplicates. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
