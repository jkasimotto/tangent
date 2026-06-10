import type { NormalizedConversation, NormalizedConversationMessage, NormalizedToolCall } from "@tangent/usage";

import type { DailyConfig } from "../types/config.js";
import { excerptText, previewUnknown, truncateCompact } from "../core/redaction.js";

export function clampRollupConversation(conversation: NormalizedConversation, config: DailyConfig): NormalizedConversation {
  const steps: RollupClampOptions[] = [
    { userChars: 2000, assistantChars: 1000, toolInputChars: 800, toolResultChars: config.input.maxToolResultChars, maxToolCalls: 60 },
    { userChars: 1200, assistantChars: 500, toolInputChars: 400, toolResultChars: 500, maxToolCalls: 30 },
    { userChars: 800, assistantChars: 250, toolInputChars: 200, toolResultChars: 240, maxToolCalls: 12, onlyProblemTools: true },
    { userChars: 500, assistantChars: 120, toolInputChars: 0, toolResultChars: 0, maxToolCalls: 0 }
  ];

  for (const step of steps) {
    const candidate = compactRollupConversation(conversation, config, step);
    if (JSON.stringify(candidate).length <= config.input.maxTurnInputChars) return candidate;
  }

  return hardClampRollupConversation(conversation, config);
}

export function compactRollupCaveats(caveats: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const caveat of caveats) {
    if (!caveat) continue;
    const normalized = normalizeRollupCaveat(caveat);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  const entries = [...counts.entries()];
  const selected = entries.slice(0, limit).map(([caveat, count]) =>
    count > 1 ? `${caveat} (${count} occurrences).` : caveat
  );
  if (entries.length > limit) {
    selected.push(`${entries.length - limit} additional caveat types were omitted from the daily rollup input.`);
  }
  return selected;
}

type RollupClampOptions = {
  userChars: number;
  assistantChars: number;
  toolInputChars: number;
  toolResultChars: number;
  maxToolCalls: number;
  onlyProblemTools?: boolean;
};

function compactRollupConversation(conversation: NormalizedConversation, config: DailyConfig, options: RollupClampOptions): NormalizedConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => compactRollupMessage(message, config, options)),
    caveats: compactRollupCaveats([
      ...conversation.caveats,
      "Conversation report was truncated for daily rollup input."
    ], 8)
  };
}

function compactRollupMessage(message: NormalizedConversationMessage, config: DailyConfig, options: RollupClampOptions): NormalizedConversationMessage {
  if (message.role === "user") {
    return {
      ...message,
      text: excerptText(message.text, options.userChars, config.privacy.redactSecrets)
    };
  }

  return {
    ...message,
    text: excerptText(message.text, options.assistantChars, config.privacy.redactSecrets),
    toolCalls: compactRollupTools(message.toolCalls, config, options)
  };
}

function compactRollupTools(tools: NormalizedToolCall[], config: DailyConfig, options: RollupClampOptions): NormalizedToolCall[] {
  if (!options.maxToolCalls) return [];
  const selected = options.onlyProblemTools
    ? tools.filter((tool) => tool.result?.status === "error" || tool.category === "command")
    : tools;
  return selected.slice(0, options.maxToolCalls).map((tool) => ({
    ...tool,
    input: config.input.includeToolInputs && options.toolInputChars > 0
      ? previewUnknown(tool.input, options.toolInputChars, config.privacy.redactSecrets)
      : undefined,
    result: tool.result
      ? {
          ...tool.result,
          outputPreview: config.input.includeToolResults && tool.result.status === "error" && options.toolResultChars > 0
            ? previewUnknown(tool.result.outputPreview, options.toolResultChars, config.privacy.redactSecrets)
            : undefined
        }
      : undefined,
    targetPaths: tool.targetPaths.slice(0, 40)
  }));
}

function hardClampRollupConversation(conversation: NormalizedConversation, config: DailyConfig): NormalizedConversation {
  const userMessages = conversation.messages
    .filter((message) => message.role === "user")
    .map((message) => compactRollupMessage(message, config, {
      userChars: config.privacy.maxQuoteChars,
      assistantChars: 0,
      toolInputChars: 0,
      toolResultChars: 0,
      maxToolCalls: 0
    }));
  const fallbackMessages = userMessages.length ? userMessages : conversation.messages.slice(0, 1).map((message) => compactRollupMessage(message, config, {
    userChars: config.privacy.maxQuoteChars,
    assistantChars: 120,
    toolInputChars: 0,
    toolResultChars: 0,
    maxToolCalls: 0
  }));
  const base = {
    ...conversation,
    messages: fallbackMessages,
    caveats: compactRollupCaveats([
      ...conversation.caveats,
      "Conversation report was heavily truncated for daily rollup input; user messages were preserved first."
    ], 8)
  };
  if (JSON.stringify(base).length <= config.input.maxTurnInputChars) return base;

  for (const maxMessages of [20, 12, 6, 3, 1]) {
    for (const maxChars of [160, 100, 60]) {
      const candidate = {
        ...base,
        messages: keepEdges(base.messages, maxMessages).map((message) => ({
          ...message,
          text: truncateCompact(message.text, maxChars)
        }))
      };
      if (JSON.stringify(candidate).length <= config.input.maxTurnInputChars) return candidate;
    }
  }

  return {
    ...base,
    messages: keepEdges(base.messages, 1).map((message) => ({ ...message, text: truncateCompact(message.text, 60) }))
  };
}

function keepEdges<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  if (maxItems <= 1) return items.slice(0, 1);
  const head = Math.ceil(maxItems / 2);
  const tail = Math.floor(maxItems / 2);
  return [...items.slice(0, head), ...items.slice(-tail)];
}

function normalizeRollupCaveat(caveat: string): string {
  if (/^Imported from Codex native .+ event\.$/.test(caveat)) return caveat;
  if (/^tool call event .+ had no links\.message_id; attached to nearest previous assistant message in the same turn\.$/.test(caveat)) {
    return "Some tool call events had no message link and were attached to the nearest previous assistant message.";
  }
  if (/^Conversation report was heavily truncated/.test(caveat)) {
    return "Conversation report was heavily truncated for daily rollup input; user messages were preserved first.";
  }
  if (/^Conversation report was truncated/.test(caveat)) {
    return "Conversation report was truncated for daily rollup input.";
  }
  return truncateCompact(caveat, 180);
}
