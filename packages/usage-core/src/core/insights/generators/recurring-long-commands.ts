import type { NormalizedConversation } from "../../conversation-report-types.js";
import { extractCommandText, normalizeCommandHead } from "../command-head.js";
import { findingFingerprint } from "../fingerprint.js";
import type { Finding, FindingEvidenceRef } from "../types.js";
import { estimateTokensFromText, flattenToolCalls, formatFindingDuration, median, projectLabelForRoot, sum } from "../util.js";

// Below this, a "median Xs" clause reads as noise rather than signal (a floor-rounded near-zero
// median used to render as the confusing "median 0m"); omit the clause entirely instead.
const MEDIAN_CLAUSE_FLOOR_MS = 1_000;

// Noise floor: a command run once or twice, briefly, is normal iteration, not a pattern worth a
// CLAUDE.md note. Either condition alone is enough to surface (a command run 40 times at a few
// seconds each is as real a pattern as one run twice for 5 minutes).
const MIN_RUN_COUNT = 3;
const MIN_TOTAL_COST_MS = 2 * 60_000;

type CommandGroup = {
  repo?: string;
  head: string;
  durationsMs: number[];
  tokens: number[];
  sessions: Map<string, string | undefined>;
};

/**
 * Groups tool calls in the "command" category (shell/exec tool calls) by their normalized command
 * head across the whole window, ranking the commands that recur most expensively (e.g. "it keeps
 * running dart analyze on the entire client"). Aggregation spans every conversation in the window,
 * not just one session, since the pattern that matters is the recurring habit.
 */
export function recurringLongCommands(conversations: NormalizedConversation[]): Finding[] {
  const groups = new Map<string, CommandGroup>();
  for (const conversation of conversations) {
    const repo = conversation.repo?.root;
    for (const call of flattenToolCalls(conversation)) {
      if (call.category !== "command") continue;
      const commandText = extractCommandText(call.input);
      if (!commandText) continue;
      const head = normalizeCommandHead(commandText);
      if (!head) continue;

      const key = JSON.stringify([repo || "", head]);
      const group: CommandGroup = groups.get(key) || { repo, head, durationsMs: [], tokens: [], sessions: new Map() };
      group.durationsMs.push(call.result?.durationMs || 0);
      group.tokens.push(estimateTokensFromText(call.result?.outputPreview));
      group.sessions.set(conversation.conversationId, conversation.providerSessionId);
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => buildFinding(group))
    .filter((finding): finding is Finding => finding !== undefined)
    .sort((a, b) => b.costMs - a.costMs);
}

/** Builds one command group's finding, or undefined if it does not clear the noise floor. */
function buildFinding(group: CommandGroup): Finding | undefined {
  const count = group.durationsMs.length;
  const totalMs = sum(group.durationsMs);
  if (count < MIN_RUN_COUNT && totalMs < MIN_TOTAL_COST_MS) return undefined;

  const medianMs = median(group.durationsMs);
  const maxMs = Math.max(...group.durationsMs);
  const subject = group.head;
  const projectLabel = projectLabelForRoot(group.repo);
  const evidence: FindingEvidenceRef[] = [...group.sessions.entries()].map(([conversationId, sessionId]) => ({ conversationId, sessionId }));
  const medianClause = medianMs >= MEDIAN_CLAUSE_FLOOR_MS ? `median ${formatFindingDuration(medianMs)}, ` : "";

  return {
    generator: "recurring-long-commands",
    subject,
    title: `${group.head} ran ${count}x, ${medianClause}total ${formatFindingDuration(totalMs)}`,
    costMs: totalMs,
    costTokens: sum(group.tokens),
    costTokensEstimated: true,
    evidence,
    remedy: "document-command",
    fingerprint: findingFingerprint("recurring-long-commands", subject, group.repo),
    repo: group.repo,
    projectLabel,
    detail: { count, medianMs, maxMs, totalMs }
  };
}
