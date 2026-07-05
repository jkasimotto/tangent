// Loads the per-variant conversation transcripts the HTML report's drill-down section shows. Kept
// separate from model.ts so the core view-model (header, matrix, cards) never pays for usage-index
// reconstruction when only the markdown report is requested.

import { reconstructVariantConversations } from "../core/transcript.js";
import { projectConversation } from "../server/conversation-view.js";
import type { ReportTranscript, ReportVariantSidecars } from "./model.js";
import { variantKey } from "./model.js";

/**
 * Reconstructs every variant's conversations from the usage index and projects them to the compact
 * transcript shape the HTML report renders. A variant with no `metrics.json` (and so no recorded
 * conversation ids) or whose conversations cannot be reconstructed still yields a row, with an empty
 * conversation list and a note explaining why, per the "handle missing sidecars gracefully" rule.
 */
export async function loadReportTranscripts(sidecars: ReportVariantSidecars[]): Promise<ReportTranscript[]> {
  const rows: ReportTranscript[] = [];
  for (const row of sidecars) {
    const conversationIds = row.metrics?.conversations ?? [];
    if (conversationIds.length === 0) {
      rows.push({
        variantKey: variantKey(row.variant),
        conversations: [],
        notes: row.metrics ? [] : ["No metrics.json for this variant; no conversation ids to reconstruct."]
      });
      continue;
    }
    const { conversations, notes } = await reconstructVariantConversations(row.variant, conversationIds);
    rows.push({
      variantKey: variantKey(row.variant),
      conversations: conversations.map((conversation) => projectConversation(conversation, row.variant.worktree)),
      notes
    });
  }
  return rows;
}
