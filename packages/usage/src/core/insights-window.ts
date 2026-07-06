import type { NormalizedConversation } from "@tangent/usage-core/core/conversation-report";
import { isEvalRunConversation } from "@tangent/usage-core/core/insights/index";

/** The result of splitting a window into real conversations and Tangent's own eval sandbox sessions. */
export type EvalRunPartition = {
  /** The conversations that remain in the window after filtering. */
  conversations: NormalizedConversation[];
  /** How many eval sandbox conversations were dropped. Always 0 when includeEvalRuns is set. */
  excludedEvalRuns: number;
};

/**
 * Drops Tangent's own eval sandbox sessions from an Insights window and counts how many were
 * removed. Shared by the CLI's loadWindow and the server's loadInsightsWindow so both surfaces
 * filter before the finding generators and before computeAgentTimeDistribution, and both can show
 * the same honest "N eval sandbox sessions excluded" note. Passing includeEvalRuns true opts back
 * in (the CLI flag --include-eval-runs, the server query param includeEvalRuns=1) and reports 0
 * exclusions, since nothing was hidden.
 */
export function partitionEvalRunConversations(
  conversations: NormalizedConversation[],
  options: { includeEvalRuns: boolean }
): EvalRunPartition {
  if (options.includeEvalRuns) return { conversations, excludedEvalRuns: 0 };
  const kept = conversations.filter((conversation) => !isEvalRunConversation(conversation));
  return { conversations: kept, excludedEvalRuns: conversations.length - kept.length };
}
