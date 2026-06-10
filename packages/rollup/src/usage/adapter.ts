import type { UsageDataset, TurnListItem } from "@tangent/usage";
import type { ResolvedRepoInfo as RollupRepoInfo } from "@tangent/repo";

import type { RollupConfig } from "../types/config.js";
import type { RollupInput, RollupPurpose } from "../types/digest.js";
import type { RollupPeriod } from "../types/period.js";
import type { RollupStyleExample } from "../core/examples.js";
import { clampRollupConversation, compactRollupCaveats } from "./rollup-clamp.js";

type ScoredConversation = {
  turn: TurnListItem;
  index: number;
  score: number;
  conversation: ReturnType<typeof clampRollupConversation>;
};

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

  const scoredConversations = turns.map((turn, index) => {
    const conversation = dataset.conversations.report({
      conversationId: turn.conversationId,
      turnId: turn.turnId
    }).data;
    const clamped = clampRollupConversation(conversation, config);
    return {
      turn,
      index,
      score: conversationScore(clamped, turn, purpose),
      conversation: clamped
    };
  });

  const purposeAware = clampRollupConversationsForInput(scoredConversations, purpose, config.input.maxTurnInputChars);
  const conversations = purposeAware.conversations;
  const droppedCount = purposeAware.dropped;

  const sourceCaveats = [
    ...conversations.flatMap((conversation) => conversation.caveats),
    ...dataset.warnings.map((warning) => warning.message)
  ];
  if (droppedCount > 0) {
    sourceCaveats.push(`Purpose-focused clamping dropped ${droppedCount} conversation(s) with low relevance signal.`);
  }

  return {
    schema: "rollup.input.v1",
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
      caveats: compactRollupCaveats(sourceCaveats, 16)
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

function sanitizePurpose(purpose?: RollupPurpose): RollupPurpose | undefined {
  if (!purpose?.request) return undefined;
  return {
    ...purpose,
    focusTerms: purpose.focusTerms?.filter((term) => Boolean(term && String(term).trim())) || [],
    request: purpose.request.trim(),
    title: purpose.title?.trim() || undefined
  };
}

function conversationScore(
  conversation: ReturnType<typeof clampRollupConversation>,
  turn: TurnListItem,
  purpose?: RollupPurpose
): number {
  if (!purpose?.request && (!purpose?.focusTerms || !purpose.focusTerms.length)) return 0;

  const terms = [...new Set([
    ...(purpose.request ? [purpose.request] : []),
    ...(purpose.focusTerms || [])
  ])]
    .filter((term) => typeof term === "string")
    .map((term) => term.toLocaleLowerCase());
  if (!terms.length) return 0;

  const haystacks = [
    turn.titlePreview || "",
    ...conversation.messages.flatMap((message) => {
      const entries: string[] = [message.text || ""];
      if (message.role === "assistant" && message.model) entries.push(message.model);
      if (message.role === "assistant") {
        for (const tool of message.toolCalls) entries.push(...tool.targetPaths);
      }
      return entries;
    })
  ];

  const haystack = haystacks.join(" ").toLocaleLowerCase();
  return terms.reduce((score, term) => {
    if (!term) return score;
    const escaped = term.toLocaleLowerCase();
    let index = 0;
    let matches = 0;
    while (index >= 0) {
      index = haystack.indexOf(escaped, index);
      if (index === -1) break;
      matches += 1;
      index += escaped.length || 1;
    }
    return score + matches;
  }, 0);
}

function clampRollupConversationsForInput(
  scored: ScoredConversation[],
  purpose: RollupPurpose | undefined,
  maxInput: number
): { conversations: ReturnType<typeof clampRollupConversation>[]; dropped: number } {
  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const allConversations = sorted.map((entry) => entry.conversation);
  if (maxInput <= 0 || JSON.stringify({ conversations: allConversations }).length <= maxInput) {
    return { conversations: allConversations, dropped: 0 };
  }

  if (!purpose?.request && (!purpose?.focusTerms || purpose.focusTerms.length === 0)) {
    const fallback = sorted.slice(0, 1).map((entry) => entry.conversation);
    return { conversations: fallback, dropped: Math.max(0, sorted.length - 1) };
  }

  const kept: ScoredConversation[] = [];
  for (const entry of sorted) {
    const nextPayload = { conversations: [...kept.map((item) => item.conversation), entry.conversation] };
    const nextLength = JSON.stringify(nextPayload).length;
    if (nextLength > maxInput) break;
    kept.push(entry);
  }

  if (!kept.length && sorted.length > 0) {
    return { conversations: [sorted[0].conversation], dropped: sorted.length - 1 };
  }

  return {
    conversations: kept.sort((a, b) => a.index - b.index).map((entry) => entry.conversation),
    dropped: sorted.length - kept.length
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
