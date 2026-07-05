import type { NormalizedConversation, NormalizedToolCall } from "../../conversation-report-types.js";
import { findingFingerprint } from "../fingerprint.js";
import type { Finding } from "../types.js";
import { estimateTokensFromText, flattenToolCalls, formatFindingDuration, lastAssistantText, sum } from "../util.js";

// A session's read+search time before its first write has to clear this floor to be worth
// surfacing; a few seconds of orienting reads is normal and not a finding.
const MIN_COST_MS = 60_000;

// When at least this share of the info-finding time was spent in "search" calls (grep/glob/find
// chains) rather than plain reads, the likely fix is a tool (structural search), not a map.
const SEARCH_HEAVY_SHARE = 0.5;

type FileReadDetail = {
  path: string;
  readCount: number;
  downstreamUse: boolean;
};

/**
 * Ranks sessions by how much read/search tool time they spent before their first write call: the
 * case miner for "give the agent a faster way to find things" fixes (a CLAUDE.md map, or a
 * structural-search tool). A session with no write call at all counts its entire read/search time,
 * since nothing downstream ever used what was read.
 */
export function infoFindingHeavySessions(conversations: NormalizedConversation[]): Finding[] {
  return conversations
    .map((conversation) => buildFinding(conversation))
    .filter((finding): finding is Finding => finding !== undefined)
    .sort((a, b) => b.costMs - a.costMs);
}

/** Builds one session's finding, or undefined if it has no qualifying info-finding cost. */
function buildFinding(conversation: NormalizedConversation): Finding | undefined {
  const calls = flattenToolCalls(conversation);
  const firstWriteIndex = calls.findIndex((call) => call.category === "write");
  const scanned = firstWriteIndex === -1 ? calls : calls.slice(0, firstWriteIndex);
  const infoCalls = scanned.filter((call) => call.category === "read" || call.category === "search");
  if (!infoCalls.length) return undefined;

  const costMs = sum(infoCalls.map((call) => call.result?.durationMs || 0));
  if (costMs < MIN_COST_MS) return undefined;

  const costTokens = sum(infoCalls.map((call) => estimateTokensFromText(call.result?.outputPreview)));
  const files = fileReadDetail(infoCalls, calls, conversation);
  const searchMs = sum(infoCalls.filter((call) => call.category === "search").map((call) => call.result?.durationMs || 0));
  const subject = conversation.conversationId;
  const repo = conversation.repo?.root;
  const label = conversation.providerSessionId || conversation.conversationId;
  const scope = firstWriteIndex === -1 ? "the whole session (no write ever happened)" : "the first write";

  return {
    generator: "info-finding-heavy-sessions",
    subject,
    title: `${label}: ${formatFindingDuration(costMs)} finding info across ${files.length} file${files.length === 1 ? "" : "s"} before ${scope}`,
    costMs,
    costTokens,
    costTokensEstimated: true,
    evidence: [{ conversationId: conversation.conversationId, sessionId: conversation.providerSessionId }],
    remedy: costMs > 0 && searchMs / costMs >= SEARCH_HEAVY_SHARE ? "structural-search" : "missing-map",
    fingerprint: findingFingerprint("info-finding-heavy-sessions", subject, repo),
    repo,
    detail: { files, hadWrite: firstWriteIndex !== -1 }
  };
}

/** Builds per-file read counts and the downstream-use proxy for a session's info-finding calls. */
function fileReadDetail(infoCalls: NormalizedToolCall[], allCalls: NormalizedToolCall[], conversation: NormalizedConversation): FileReadDetail[] {
  const counts = new Map<string, number>();
  for (const call of infoCalls) {
    for (const filePath of call.targetPaths) counts.set(filePath, (counts.get(filePath) || 0) + 1);
  }
  const writePaths = new Set(allCalls.filter((call) => call.category === "write").flatMap((call) => call.targetPaths));
  const finalText = lastAssistantText(conversation);
  return [...counts.entries()]
    .map(([filePath, readCount]) => ({
      path: filePath,
      readCount,
      downstreamUse: writePaths.has(filePath) || Boolean(finalText && finalText.includes(filePath))
    }))
    .sort((a, b) => b.readCount - a.readCount);
}
