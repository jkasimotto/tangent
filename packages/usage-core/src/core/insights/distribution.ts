import type { NormalizedConversation } from "../conversation-report-types.js";
import { flattenToolCalls } from "./util.js";

/** The three coarse categories the Insights header groups agent tool time into, in fixed display order. */
export type AgentTimeCategoryKey = "findingInfo" | "executing" | "writing";

/** One category's share of the window's total agent tool time. */
export type AgentTimeCategoryShare = {
  key: AgentTimeCategoryKey;
  label: string;
  ms: number;
  fraction: number;
};

/** The Insights distribution header: total agent tool time plus a fixed-order category breakdown. */
export type AgentTimeDistribution = {
  totalMs: number;
  categories: AgentTimeCategoryShare[];
};

const CATEGORY_LABELS: Record<AgentTimeCategoryKey, string> = {
  findingInfo: "finding info",
  executing: "executing",
  writing: "writing"
};

/**
 * Computes the Insights distribution header shared verbatim by `tangent usage insights` and the
 * Insights view in the Usage UI: total agent tool time in the window, then the share spent finding
 * info (read+search calls), executing (command calls), and writing, in that fixed order. Calls
 * outside these three categories (e.g. "other") count toward totalMs but are not broken out, matching
 * the CLI header this mirrors.
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
  return {
    totalMs,
    categories: [
      { key: "findingInfo", label: CATEGORY_LABELS.findingInfo, ms: readMs + searchMs, fraction: share(readMs + searchMs) },
      { key: "executing", label: CATEGORY_LABELS.executing, ms: commandMs, fraction: share(commandMs) },
      { key: "writing", label: CATEGORY_LABELS.writing, ms: writeMs, fraction: share(writeMs) }
    ]
  };
}
