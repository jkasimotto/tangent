// Builds the phase-3 sweep's candidate conversations: which conversations the model is asked about,
// and everything the prompt and the eventual mark anchor need from each one. Split out of scan.ts so
// that file stays focused on orchestration; see scan.ts's file-level comment for the sweep's overall
// design.

import type { NormalizedConversation } from "@tangent/usage-index-sqlite";
import type { Finding } from "@tangent/usage-core/core/insights/index";

/** The window of a scan: how far back to look, and an optional repo scope. */
export type ScanWindow = {
  days: number;
  repo?: string;
};

/** One conversation the sweep considered, with everything the model prompt and the mark anchor need. */
export type ScanCandidate = {
  conversationId: string;
  sessionId: string;
  transcriptPath: string;
  repoRoot: string;
  userMessages: string[];
  toolCallSummary: string;
  findingTitles: string[];
  costMs: number;
};

/**
 * Builds one scan candidate per anchorable conversation the deterministic signals seeded: findings'
 * evidence conversations (any provider, any message shape) union every conversation with at least
 * one user message (the correction-detection seed). Conversations that cannot resolve a session id,
 * transcript path, or repo root are dropped before the model is ever called, since they could never
 * produce a valid mark anchor and scanning them would waste a model call on a result that can't be
 * written.
 */
export function buildScanCandidates(conversations: NormalizedConversation[], findings: Finding[]): ScanCandidate[] {
  const seedIds = collectSeedConversationIds(conversations, findings);
  const costByConversation = new Map<string, number>();
  const titlesByConversation = new Map<string, string[]>();
  for (const finding of findings) {
    for (const evidence of finding.evidence) {
      costByConversation.set(evidence.conversationId, (costByConversation.get(evidence.conversationId) || 0) + finding.costMs);
      const titles = titlesByConversation.get(evidence.conversationId) || [];
      titles.push(finding.title);
      titlesByConversation.set(evidence.conversationId, titles);
    }
  }

  return conversations
    .filter((conversation) => seedIds.has(conversation.conversationId))
    .flatMap((conversation): ScanCandidate[] => {
      const anchor = anchorableConversation(conversation);
      if (!anchor) return [];
      return [{
        conversationId: conversation.conversationId,
        sessionId: anchor.sessionId,
        transcriptPath: anchor.transcriptPath,
        repoRoot: anchor.repoRoot,
        userMessages: conversation.messages
          .filter((message): message is Extract<NormalizedConversation["messages"][number], { role: "user" }> => message.role === "user")
          .map((message) => message.text),
        toolCallSummary: summarizeToolCalls(conversation),
        findingTitles: uniqueStrings(titlesByConversation.get(conversation.conversationId) || []),
        costMs: costByConversation.get(conversation.conversationId) || 0
      }];
    });
}

/** Sorts candidates by cost descending (ties broken by conversation id, for deterministic output), so the largest-cost conversations spend the model-call budget first. */
export function rankScanCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  return [...candidates].sort((a, b) => b.costMs - a.costMs || a.conversationId.localeCompare(b.conversationId));
}

/** The mark-anchorable fields of a conversation, once its session id, transcript path, and repo root are all resolvable. */
type AnchorableConversation = {
  sessionId: string;
  transcriptPath: string;
  repoRoot: string;
};

/** Returns the anchorable fields for a conversation, or undefined when any of them cannot be resolved. */
function anchorableConversation(conversation: NormalizedConversation): AnchorableConversation | undefined {
  if (conversation.provider !== "claude") return undefined;
  const transcriptPath = conversation.transcriptPath;
  const repoRoot = conversation.repo?.root;
  const sessionId = conversation.providerSessionId || sessionIdFromConversationId(conversation.conversationId);
  if (!transcriptPath || !repoRoot || !sessionId) return undefined;
  return { sessionId, transcriptPath, repoRoot };
}

/** Strips a leading "<provider>:" prefix off a conversation id, matching how anchors are built elsewhere in marks/resolve.ts. */
function sessionIdFromConversationId(conversationId: string): string {
  const colonIndex = conversationId.indexOf(":");
  return colonIndex === -1 ? conversationId : conversationId.slice(colonIndex + 1);
}

/** Returns the set of conversation ids the sweep should build candidates for: findings' evidence, union conversations with a user message. */
function collectSeedConversationIds(conversations: NormalizedConversation[], findings: Finding[]): Set<string> {
  const ids = new Set<string>();
  for (const finding of findings) {
    for (const evidence of finding.evidence) ids.add(evidence.conversationId);
  }
  for (const conversation of conversations) {
    if (conversation.messages.some((message) => message.role === "user")) ids.add(conversation.conversationId);
  }
  return ids;
}

/** Renders a compact "category: count" summary of a conversation's tool calls, for the scan prompt. */
function summarizeToolCalls(conversation: NormalizedConversation): string {
  const counts = new Map<string, number>();
  for (const message of conversation.messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls) counts.set(call.category, (counts.get(call.category) || 0) + 1);
  }
  if (!counts.size) return "(no tool calls)";
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, count]) => `${category}: ${count}`).join(", ");
}

/** Returns a list's distinct values, preserving first-seen order. */
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
