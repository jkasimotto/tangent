import type { NormalizedConversation } from "../conversation-report-types.js";
import { flattenToolCalls } from "./util.js";

/** The coarse categories the Insights header groups agent tool time into, in fixed display order. */
export type AgentTimeCategoryKey = "findingInfo" | "executing" | "writing" | "other";

/** One category's share of the window's total agent tool time. */
export type AgentTimeCategoryShare = {
  key: AgentTimeCategoryKey;
  label: string;
  ms: number;
  fraction: number;
};

/**
 * The Insights distribution header: total agent tool time plus a category breakdown. `categories`
 * includes every category with nonzero time in the window (zero-ms categories are dropped rather
 * than shown as an empty slice), so the fractions always sum to 1.0 and the header never silently
 * hides a chunk of the window's time under an uncounted "other" bucket.
 */
export type AgentTimeDistribution = {
  totalMs: number;
  categories: AgentTimeCategoryShare[];
};

const CATEGORY_LABELS: Record<AgentTimeCategoryKey, string> = {
  findingInfo: "finding info",
  executing: "executing",
  writing: "writing",
  other: "other tools"
};

/**
 * Computes the Insights distribution header shared verbatim by `tangent usage insights` and the
 * Insights view in the Usage UI: total agent tool time in the window, then the share spent finding
 * info (read+search calls), executing (command calls), writing, and everything else ("other
 * tools"), in that fixed order. Every category with nonzero time is included, so the returned shares
 * always sum to 1.0; a category with no time in this window is omitted entirely rather than shown as
 * a hidden or zero-width slice.
 */
export function computeAgentTimeDistribution(conversations: NormalizedConversation[]): AgentTimeDistribution {
  let readMs = 0;
  let searchMs = 0;
  let writeMs = 0;
  let commandMs = 0;
  let otherMs = 0;
  for (const conversation of conversations) {
    for (const call of flattenToolCalls(conversation)) {
      const durationMs = call.result?.durationMs || 0;
      if (call.category === "read") readMs += durationMs;
      else if (call.category === "search") searchMs += durationMs;
      else if (call.category === "write") writeMs += durationMs;
      else if (call.category === "command") commandMs += durationMs;
      else otherMs += durationMs;
    }
  }
  const totalMs = readMs + searchMs + writeMs + commandMs + otherMs;
  /** Returns a category's fraction of the window's total agent tool time, 0 when the window is empty. */
  const share = (ms: number): number => (totalMs > 0 ? ms / totalMs : 0);
  const allCategories: AgentTimeCategoryShare[] = [
    { key: "findingInfo", label: CATEGORY_LABELS.findingInfo, ms: readMs + searchMs, fraction: share(readMs + searchMs) },
    { key: "executing", label: CATEGORY_LABELS.executing, ms: commandMs, fraction: share(commandMs) },
    { key: "writing", label: CATEGORY_LABELS.writing, ms: writeMs, fraction: share(writeMs) },
    { key: "other", label: CATEGORY_LABELS.other, ms: otherMs, fraction: share(otherMs) }
  ];
  return { totalMs, categories: allCategories.filter((category) => category.ms > 0) };
}
