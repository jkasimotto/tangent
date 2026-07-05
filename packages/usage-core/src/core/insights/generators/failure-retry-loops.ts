import type { NormalizedConversation, NormalizedToolCall } from "../../conversation-report-types.js";
import { extractCommandText, normalizeCommandHead } from "../command-head.js";
import { findingFingerprint } from "../fingerprint.js";
import type { Finding, FindingEvidenceRef } from "../types.js";
import { estimateTokensFromText, formatFindingDuration, sum } from "../util.js";

// A rerun of the same command head this close to the previous attempt counts as the same retry
// loop rather than an unrelated later run of the same tool.
const RETRY_WINDOW_MS = 10 * 60_000;
// Fallback proximity (in assistant-message count) when either call lacks a timestamp.
const RETRY_MESSAGE_DISTANCE = 5;

// Noise floor: either condition alone is enough (two failures is a real loop even if brief; one
// failure that burned 30+ seconds before retrying is worth surfacing even if it only happened once
// per session, since it recurs across the window once aggregated by command head).
const MIN_FAILURES = 2;
const MIN_TOTAL_COST_MS = 30_000;

type TimedCall = {
  call: NormalizedToolCall;
  head: string;
  atMs?: number;
  messageIndex: number;
};

type RetryRun = {
  head: string;
  failures: number;
  retries: number;
  totalMs: number;
  tokens: number;
};

type RetryGroup = {
  repo?: string;
  head: string;
  failures: number;
  retries: number;
  totalMs: number;
  tokens: number;
  sessions: Map<string, string | undefined>;
};

/**
 * Finds commands that errored and were re-run shortly after, grouped by normalized command head
 * across the whole window. The remedy is usually documenting the correct invocation, since the
 * pattern almost always means the agent does not know the right flags, cwd, or scope for the tool.
 */
export function failureRetryLoops(conversations: NormalizedConversation[]): Finding[] {
  const groups = new Map<string, RetryGroup>();
  for (const conversation of conversations) {
    const repo = conversation.repo?.root;
    for (const run of retryRunsForSession(conversation)) {
      const key = JSON.stringify([repo || "", run.head]);
      const group: RetryGroup = groups.get(key) || { repo, head: run.head, failures: 0, retries: 0, totalMs: 0, tokens: 0, sessions: new Map() };
      group.failures += run.failures;
      group.retries += run.retries;
      group.totalMs += run.totalMs;
      group.tokens += run.tokens;
      group.sessions.set(conversation.conversationId, conversation.providerSessionId);
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => buildFinding(group))
    .filter((finding): finding is Finding => finding !== undefined)
    .sort((a, b) => b.costMs - a.costMs);
}

/** Detects retry runs within one session: chains of same-head command calls within the retry window that include at least one failure. */
function retryRunsForSession(conversation: NormalizedConversation): RetryRun[] {
  const byHead = new Map<string, TimedCall[]>();
  for (const timed of timedCommandCalls(conversation)) {
    byHead.set(timed.head, [...(byHead.get(timed.head) || []), timed]);
  }

  const runs: RetryRun[] = [];
  for (const [head, calls] of byHead) {
    let runStart = 0;
    for (let cursor = 0; cursor < calls.length; cursor += 1) {
      const isLast = cursor === calls.length - 1;
      const breaksHere = isLast || !withinRetryWindow(calls[cursor]!, calls[cursor + 1]!);
      if (!breaksHere) continue;
      const run = calls.slice(runStart, cursor + 1);
      const failures = run.filter((item) => item.call.result?.status === "error").length;
      if (run.length > 1 && failures >= 1) {
        runs.push({
          head,
          failures,
          retries: run.length - 1,
          totalMs: sum(run.map((item) => item.call.result?.durationMs || 0)),
          tokens: sum(run.map((item) => estimateTokensFromText(item.call.result?.outputPreview)))
        });
      }
      runStart = cursor + 1;
    }
  }
  return runs;
}

/** Returns true if the next call happened close enough to the previous one to count as the same retry loop. */
function withinRetryWindow(previous: TimedCall, next: TimedCall): boolean {
  if (previous.atMs !== undefined && next.atMs !== undefined) return next.atMs - previous.atMs <= RETRY_WINDOW_MS;
  return next.messageIndex - previous.messageIndex <= RETRY_MESSAGE_DISTANCE;
}

/** Flattens a conversation's command-category tool calls into timestamped, head-normalized entries in message order. */
function timedCommandCalls(conversation: NormalizedConversation): TimedCall[] {
  const result: TimedCall[] = [];
  conversation.messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") return;
    const parsedAt = message.at ? Date.parse(message.at) : Number.NaN;
    const atMs = Number.isFinite(parsedAt) ? parsedAt : undefined;
    for (const call of message.toolCalls) {
      if (call.category !== "command") continue;
      const commandText = extractCommandText(call.input);
      if (!commandText) continue;
      result.push({ call, head: normalizeCommandHead(commandText), atMs, messageIndex });
    }
  });
  return result;
}

/** Builds one command group's finding, or undefined if it does not clear the noise floor. */
function buildFinding(group: RetryGroup): Finding | undefined {
  if (group.failures < MIN_FAILURES && group.totalMs < MIN_TOTAL_COST_MS) return undefined;

  const subject = group.head;
  const evidence: FindingEvidenceRef[] = [...group.sessions.entries()].map(([conversationId, sessionId]) => ({ conversationId, sessionId }));

  return {
    generator: "failure-retry-loops",
    subject,
    title: `${group.head} failed ${group.failures}x and was retried ${group.retries}x, burning ${formatFindingDuration(group.totalMs)}`,
    costMs: group.totalMs,
    costTokens: group.tokens,
    costTokensEstimated: true,
    evidence,
    remedy: "document-invocation",
    fingerprint: findingFingerprint("failure-retry-loops", subject, group.repo),
    repo: group.repo,
    detail: { failures: group.failures, retries: group.retries, totalMs: group.totalMs }
  };
}
