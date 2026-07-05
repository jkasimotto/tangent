import type { NormalizedConversation } from "../../conversation-report-types.js";
import { findingFingerprint } from "../fingerprint.js";
import type { Finding, FindingEvidenceRef } from "../types.js";
import { estimateTokensFromText, flattenToolCalls, formatFindingDuration, sum } from "../util.js";

// Churn: a file read this many times in one session is a sign the agent could not retain it and
// kept going back, not normal orientation.
const CHURN_MIN_READS = 3;

// Hot files: a file has to be read across several sessions, several times total, before it is
// worth flagging as a CLAUDE.md map candidate; one busy session alone is not a cross-session habit.
const HOT_FILE_MIN_READS = 5;
const HOT_FILE_MIN_SESSIONS = 3;

type FileReadEvent = {
  conversationId: string;
  sessionId?: string;
  repo?: string;
  path: string;
  durationMs: number;
  tokens: number;
};

/**
 * Two related patterns from one pass over read-category tool calls: churn (the same file read 3+
 * times within a single session, suggesting the agent could not retain it) and hot files (the
 * files read most across all sessions, candidates for a CLAUDE.md map entry). Both findings share
 * this generator because both come from the same underlying read-count-by-path aggregation.
 */
export function reReadChurnAndHotFiles(conversations: NormalizedConversation[]): Finding[] {
  const churn = conversations.flatMap((conversation) => churnFindingsForSession(conversation));
  const hotFiles = hotFileFindings(conversations);
  return [...churn, ...hotFiles].sort((a, b) => b.costMs - a.costMs);
}

/** Finds files re-read 3+ times within a single session and builds one finding per such file. */
function churnFindingsForSession(conversation: NormalizedConversation): Finding[] {
  const reads = readEventsForConversation(conversation);
  const byPath = new Map<string, FileReadEvent[]>();
  for (const read of reads) byPath.set(read.path, [...(byPath.get(read.path) || []), read]);

  const repo = conversation.repo?.root;
  const label = conversation.providerSessionId || conversation.conversationId;
  const findings: Finding[] = [];
  for (const [filePath, events] of byPath) {
    if (events.length < CHURN_MIN_READS) continue;
    const costMs = sum(events.map((event) => event.durationMs));
    const costTokens = sum(events.map((event) => event.tokens));
    const subject = JSON.stringify([conversation.conversationId, filePath]);
    findings.push({
      generator: "re-read-churn-and-hot-files",
      subject,
      title: `${label} re-read ${filePath} ${events.length}x (${formatFindingDuration(costMs)})`,
      costMs,
      costTokens,
      costTokensEstimated: true,
      evidence: [{ conversationId: conversation.conversationId, sessionId: conversation.providerSessionId }],
      remedy: "split-or-map-file",
      fingerprint: findingFingerprint("re-read-churn-and-hot-files", subject, repo),
      repo,
      detail: { path: filePath, readCount: events.length }
    });
  }
  return findings;
}

/** Finds files read across many sessions and builds one finding per file that clears the hot-file floor. */
function hotFileFindings(conversations: NormalizedConversation[]): Finding[] {
  const byRepoAndPath = new Map<string, FileReadEvent[]>();
  for (const conversation of conversations) {
    for (const read of readEventsForConversation(conversation)) {
      const key = JSON.stringify([read.repo || "", read.path]);
      byRepoAndPath.set(key, [...(byRepoAndPath.get(key) || []), read]);
    }
  }

  const findings: Finding[] = [];
  for (const events of byRepoAndPath.values()) {
    const sessionIds = new Set(events.map((event) => event.conversationId));
    if (events.length < HOT_FILE_MIN_READS || sessionIds.size < HOT_FILE_MIN_SESSIONS) continue;

    const repo = events[0]!.repo;
    const filePath = events[0]!.path;
    const costMs = sum(events.map((event) => event.durationMs));
    const costTokens = sum(events.map((event) => event.tokens));
    const subject = filePath;
    const evidence: FindingEvidenceRef[] = [...new Map(events.map((event) => [event.conversationId, event.sessionId])).entries()]
      .map(([conversationId, sessionId]) => ({ conversationId, sessionId }));

    findings.push({
      generator: "re-read-churn-and-hot-files",
      subject,
      title: `${filePath} read ${events.length}x across ${sessionIds.size} sessions (${formatFindingDuration(costMs)})`,
      costMs,
      costTokens,
      costTokensEstimated: true,
      evidence,
      remedy: "missing-map",
      fingerprint: findingFingerprint("re-read-churn-and-hot-files", subject, repo),
      repo,
      detail: { readCount: events.length, sessionCount: sessionIds.size }
    });
  }
  return findings;
}

/** Flattens a conversation's read-category tool calls into one FileReadEvent per target path per call. */
function readEventsForConversation(conversation: NormalizedConversation): FileReadEvent[] {
  const repo = conversation.repo?.root;
  return flattenToolCalls(conversation)
    .filter((call) => call.category === "read")
    .flatMap((call) => call.targetPaths.map((filePath) => ({
      conversationId: conversation.conversationId,
      sessionId: conversation.providerSessionId,
      repo,
      path: filePath,
      durationMs: call.result?.durationMs || 0,
      tokens: estimateTokensFromText(call.result?.outputPreview)
    })));
}
