import type { UsageDataset, TurnListItem } from "@tangent/usage";
import type { ResolvedRepoInfo as RollupRepoInfo } from "@tangent/repo";

import type { RollupConfig } from "../types/config.js";
import type { RollupInput } from "../types/digest.js";
import type { RollupPeriod } from "../types/period.js";
import type { RollupStyleExample } from "../core/examples.js";
import { clampRollupConversation, compactRollupCaveats } from "./rollup-clamp.js";

export function buildRollupInput(args: {
  dataset: UsageDataset;
  repo: RollupRepoInfo;
  config: RollupConfig;
  turns: TurnListItem[];
  period: RollupPeriod;
  examples?: RollupStyleExample[];
}): RollupInput {
  const { dataset, repo, config, turns, period } = args;
  const conversations = turns.map((turn) => dataset.conversations.report({
    conversationId: turn.conversationId,
    turnId: turn.turnId
  }).data).map((conversation) => clampRollupConversation(conversation, config));
  return {
    schema: "rollup.input.v1",
    period,
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
      caveats: compactRollupCaveats([
        ...conversations.flatMap((conversation) => conversation.caveats),
        ...dataset.warnings.map((warning) => warning.message)
      ], 16)
    },
    examples: args.examples || [],
    conversations
  };
}

export function renderRollupMessages(input: RollupInput): string {
  const lines: string[] = [
    `# Rollup messages - ${input.period.label}`,
    "",
    `Repo: ${input.repo.name}`,
    `Providers: ${input.source.providers.join(", ") || "none"}`,
    ""
  ];

  for (const conversation of input.conversations) {
    lines.push(`## ${conversation.conversationId}`, "");
    for (const message of conversation.messages) {
      lines.push(`### ${message.at || "--"} ${message.role}${message.role === "assistant" && message.model ? ` ${message.model}` : ""}`);
      if (message.text) lines.push("", message.text.trim(), "");
      if (message.role === "assistant" && message.tokens) {
        lines.push(`tokens: input=${message.tokens.input ?? "-"} output=${message.tokens.output ?? "-"} cacheRead=${message.tokens.cacheRead ?? "-"} cacheCreation=${message.tokens.cacheCreation ?? "-"} confidence=${message.tokens.confidence}`);
      }
      if (message.role === "assistant" && message.toolCalls.length) {
        lines.push("tools:");
        for (const [index, tool] of message.toolCalls.entries()) {
          lines.push(`${index + 1}. ${tool.name} ${tool.result?.status || "unknown"} targets=${tool.targetPaths.join(", ") || "-"}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function isProcessableTurn(turn: TurnListItem, config: RollupConfig, includeActiveOverride = false): boolean {
  if (turn.status !== "active") return true;
  if (!config.processing.includeActiveConversations && !includeActiveOverride) return false;
  const quietMs = config.processing.activeQuietMinutes * 60 * 1000;
  return Date.now() - turn.lastActivityAt.getTime() >= quietMs;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
