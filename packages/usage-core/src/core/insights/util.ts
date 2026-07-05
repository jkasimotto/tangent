import type { NormalizedConversation, NormalizedToolCall } from "../conversation-report-types.js";

const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Returns all tool calls across a conversation's assistant messages, in message order. */
export function flattenToolCalls(conversation: NormalizedConversation): NormalizedToolCall[] {
  return conversation.messages.flatMap((message) => (message.role === "assistant" ? message.toolCalls : []));
}

/**
 * Returns the text of the last assistant message in a conversation. Used as the "did this path get
 * referenced in the final answer" half of the downstream-use proxy (the other half is: did a later
 * write call touch the same path).
 */
export function lastAssistantText(conversation: NormalizedConversation): string | undefined {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]!;
    if (message.role === "assistant") return message.text;
  }
  return undefined;
}

/** Sums a list of numbers. */
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Returns the median of a list of numbers, 0 for an empty list. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Estimates a token count from result text length. Providers do not report exact per-tool-call
 * token usage, so this is always a rough estimate; callers must label it "est." wherever it is
 * shown, per the mark-loop design's honesty constraint.
 */
export function estimateTokensFromText(text: string | undefined): number {
  if (!text) return 0;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length ? Math.ceil(compact.length / CHARS_PER_TOKEN_ESTIMATE) : 0;
}

/** Formats a millisecond duration as a compact "Xm" or "X.Yh" label for finding titles. */
export function formatFindingDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
