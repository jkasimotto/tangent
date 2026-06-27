export { getCandidates } from "./getCandidates.js";
export type { CandidateConversation, GetCandidatesOptions } from "./getCandidates.js";
export { processRollup } from "./processRollup.js";
export type { ProcessResult, ProcessRollupOptions } from "./processRollup.js";
export { processMetrics } from "./processMetrics.js";
export type { ProcessMetricsOptions } from "./processMetrics.js";
export { ClaudeCliCorrectionRunner, normalizeCorrections } from "../metrics/runner.js";
export type { ClaudeCliCorrectionRunnerConfig } from "../metrics/runner.js";
export { correctionMetricsJsonSchema } from "../metrics/schema.js";
export { correctionPrompt } from "../metrics/prompt.js";
export type {
  ConversationMetrics,
  CorrectionEvidence,
  CorrectionRunner,
  CorrectionRunnerInput,
  CorrectionRunnerResult,
  MetricsAggregate,
  MetricsRollupResult
} from "../metrics/types.js";
export { getRollupNote } from "./getRollupNote.js";
export type { RollupNoteReadResult, GetRollupNoteOptions } from "./getRollupNote.js";
export { status } from "./status.js";
export type { RollupStatus, StatusOptions } from "./status.js";
export { configure } from "./config.js";
export type { ConfigureOptions } from "./config.js";

export type { RollupConfig } from "../types/config.js";
export type { RollupCandidate, RollupInput, RollupOutput, RollupUserConversation, RollupUserMessage, EvidenceRef, RollupPurpose } from "../types/digest.js";
export type { RollupLedgerLineV1, ProcessedConversationLedgerLine } from "../types/ledger.js";
export type { RollupPeriod } from "../types/period.js";
export type { SummaryProviderConfig, SummaryRunner, RunnerStatus } from "../types/provider.js";
