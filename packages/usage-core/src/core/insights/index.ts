import type { NormalizedConversation } from "../conversation-report-types.js";
import { isEvalRunConversation } from "./eval-run-filter.js";
import { failureRetryLoops } from "./generators/failure-retry-loops.js";
import { infoFindingHeavySessions } from "./generators/info-finding-heavy-sessions.js";
import { recurringLongCommands } from "./generators/recurring-long-commands.js";
import { reReadChurnAndHotFiles } from "./generators/re-read-churn-and-hot-files.js";
import { isParked, type ParkState } from "./park-state.js";
import type { Finding, FindingGeneratorName } from "./types.js";

/** The four v1 deterministic finding generators, each a pure function over a window of conversations. */
export const INSIGHT_GENERATORS: Record<FindingGeneratorName, (conversations: NormalizedConversation[]) => Finding[]> = {
  "info-finding-heavy-sessions": infoFindingHeavySessions,
  "recurring-long-commands": recurringLongCommands,
  "re-read-churn-and-hot-files": reReadChurnAndHotFiles,
  "failure-retry-loops": failureRetryLoops
};

export type RunInsightGeneratorsOptions = {
  /** Restricts which generators run; defaults to all four. */
  generators?: FindingGeneratorName[];
  /** Park state to filter against; omit to skip park filtering entirely. */
  parkState?: ParkState;
  /** Include parked findings in the result even though they are still parked. */
  includeParked?: boolean;
};

/**
 * Runs the requested (or all) deterministic finding generators over a window of conversations and
 * returns findings ranked by cost (wall-clock time) descending, applying park-state filtering
 * unless `includeParked` is set or no park state was supplied. Tangent's own eval-run sandbox
 * sessions are dropped from the window before any generator sees it, so eval harness activity never
 * shows up as a "finding" about the user's real workflow.
 */
export function runInsightGenerators(conversations: NormalizedConversation[], options: RunInsightGeneratorsOptions = {}): Finding[] {
  const realConversations = conversations.filter((conversation) => !isEvalRunConversation(conversation));
  const names = options.generators?.length ? options.generators : (Object.keys(INSIGHT_GENERATORS) as FindingGeneratorName[]);
  const findings = names.flatMap((name) => INSIGHT_GENERATORS[name](realConversations));
  const visible = options.includeParked || !options.parkState
    ? findings
    : findings.filter((finding) => !isParked(options.parkState!, finding.fingerprint, finding.costMs));
  return visible.sort((a, b) => b.costMs - a.costMs);
}

export type { Finding, FindingEvidenceRef, FindingGeneratorName, FindingRemedy } from "./types.js";
export { extractCommandText, normalizeCommandHead } from "./command-head.js";
export { computeAgentTimeDistribution, type AgentTimeCategoryKey, type AgentTimeCategoryShare, type AgentTimeDistribution } from "./distribution.js";
export { isEvalRunConversation } from "./eval-run-filter.js";
export { findingFingerprint } from "./fingerprint.js";
export { FINDING_REMEDY_LABELS } from "./remedies.js";
export { failureRetryLoops } from "./generators/failure-retry-loops.js";
export { infoFindingHeavySessions } from "./generators/info-finding-heavy-sessions.js";
export { recurringLongCommands } from "./generators/recurring-long-commands.js";
export { reReadChurnAndHotFiles } from "./generators/re-read-churn-and-hot-files.js";
export {
  globalInsightsParkStatePath,
  isParked,
  loadParkState,
  parkFinding,
  PARK_RESURFACE_GROWTH_THRESHOLD,
  repoInsightsParkStatePath,
  saveParkState,
  unparkFinding,
  type ParkedFindingRecord,
  type ParkState
} from "./park-state.js";
