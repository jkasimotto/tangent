// The phase-3 sweep: `tangent mark scan` writes `status: "suggested"` marks for conversations a
// human has not yet looked at, so the marks inbox has something to triage even when nobody has run
// `/mark` lately. The model never free-hunts: it only describes and classifies moments in
// conversations the deterministic insight generators (or a plain user message, for correction
// detection) already flagged as worth a look. Suggested marks are curation input only; nothing here
// creates an eval or edits a context file. See
// docs/superpowers/specs/2026-07-05-mark-loop-design.md, "Conversation review sweep (phase 3)".
//
// This file owns orchestration; candidate seeding lives in scan-candidates.ts and the model call
// lives in scan-runner.ts. Both are re-exported here so callers only need one import path.

import { loadUsageDatasetFromIndex, type NormalizedConversation } from "@tangent/usage-index-sqlite";
import { runInsightGenerators } from "@tangent/usage-core/core/insights/index";

import { createMarkRecord, listMarks, writeMark, type MarkDraft } from "./store.js";
import type { MarkKind, MarkRecord } from "./types.js";
import { buildScanCandidates, rankScanCandidates, type ScanCandidate, type ScanWindow } from "./scan-candidates.js";
import { ClaudeCliScanRunner, type ScanCategory, type ScanIncident, type ScanModelRunner, type ScanRunnerResult } from "./scan-runner.js";

export type { ScanCandidate, ScanWindow } from "./scan-candidates.js";
export { buildScanCandidates, rankScanCandidates } from "./scan-candidates.js";
export type {
  ScanCategory,
  ScanIncident,
  ScanModelRunner,
  ScanRunnerInput,
  ScanRunnerResult,
  ClaudeCliScanRunnerConfig
} from "./scan-runner.js";
export { ClaudeCliScanRunner, buildScanPrompt, normalizeScanIncidents, scanIncidentsJsonSchema, MAX_INCIDENTS_PER_CONVERSATION } from "./scan-runner.js";

/** Default lookback window for `tangent mark scan`, matching the design's "recent conversations" scope. */
export const DEFAULT_SCAN_DAYS = 7;

/** Default cap on model calls per scan, so a large window never runs an unbounded number of Claude CLI calls. */
export const DEFAULT_SCAN_LIMIT = 20;

/** Maps an incident category to the mark kind it produces: wasted-exploration is the efficiency lens, everything else is a quality failure. */
function markKindForCategory(category: ScanCategory): MarkKind {
  return category === "wasted-exploration" ? "candidate" : "failure";
}

/** Builds a suggested-mark draft from one candidate conversation and one validated incident. */
export function draftFromIncident(candidate: ScanCandidate, incident: ScanIncident): MarkDraft {
  return {
    kind: markKindForCategory(incident.category),
    anchor: {
      provider: "claude",
      sessionId: candidate.sessionId,
      conversationId: candidate.conversationId,
      transcriptPath: candidate.transcriptPath
    },
    repo: { root: candidate.repoRoot },
    observed: incident.why,
    quote: incident.quote,
    status: "suggested"
  };
}

/** Options for `scanForSuggestedMarks`; only `model` is required, since the CLI, not this library, owns the default. */
export type ScanOptions = {
  /** Lookback window in days; defaults to `DEFAULT_SCAN_DAYS`. */
  days?: number;
  /** Restricts the scan to one repo; omit to scan across every profile and project, like the Usage panel default. */
  repo?: string;
  /** Judge model, required with no library default per ADR-0013. */
  model: string;
  /** Caps total model calls for this scan, largest-cost conversations first; defaults to `DEFAULT_SCAN_LIMIT`. */
  limit?: number;
  /** When true, computes and returns would-be marks without writing them to the marks store. */
  dryRun?: boolean;
  /** Marks store directory override, for tests; defaults to `marksHome()` inside the store functions. */
  marksDir?: string;
  /** Clock override for deterministic mark ids/timestamps in tests. */
  now?: Date;
};

/** Injectable dependencies for `scanForSuggestedMarks`; all default to the real conversation loader and marks store. */
export type ScanDependencies = {
  loadConversations?: (window: ScanWindow) => Promise<NormalizedConversation[]>;
  runner?: ScanModelRunner;
  listMarksFn?: typeof listMarks;
  writeMarkFn?: typeof writeMark;
};

/** Per-category incident counts, always present with every category at zero or more. */
export type ScanCategoryCounts = Record<ScanCategory, number>;

/** What the sweep did, for the CLI to print and for tests to assert against. */
export type ScanSummary = {
  conversationsScanned: number;
  modelCalls: number;
  skippedResponses: number;
  marksWritten: number;
  byCategory: ScanCategoryCounts;
};

/** The full result of one scan: the summary plus the suggested marks it wrote (or would write, in dry-run mode). */
export type ScanResult = {
  summary: ScanSummary;
  marks: MarkRecord[];
};

/** Returns a fresh all-zero category counts map. */
function emptyCategoryCounts(): ScanCategoryCounts {
  return { "user-correction": 0, "wasted-exploration": 0, "ignored-instruction": 0, "wrong-pattern": 0 };
}

/**
 * Runs the phase-3 sweep: loads recent conversations, seeds candidates from the deterministic
 * insight generators plus every conversation with a user message, deduplicates against existing
 * non-dismissed marks, judges the highest-cost candidates up to `options.limit` model calls, and
 * writes a `status: "suggested"` mark for each validated incident (or computes them without writing,
 * in `dryRun` mode). A model call that throws (a malformed response, a process failure, a timeout) is
 * caught and counted in `skippedResponses`; it never aborts the scan.
 */
export async function scanForSuggestedMarks(options: ScanOptions, deps: ScanDependencies = {}): Promise<ScanResult> {
  const days = options.days ?? DEFAULT_SCAN_DAYS;
  const limit = options.limit ?? DEFAULT_SCAN_LIMIT;
  const loadConversations = deps.loadConversations || defaultLoadConversations;
  const runner = deps.runner || new ClaudeCliScanRunner({ model: options.model });
  const listMarksFn = deps.listMarksFn || listMarks;
  const writeMarkFn = deps.writeMarkFn || writeMark;
  const now = options.now || new Date();

  const conversations = await loadConversations({ days, repo: options.repo });
  const findings = runInsightGenerators(conversations);
  const existingMarks = await listMarksFn({}, options.marksDir);
  const anchoredConversationIds = new Set(
    existingMarks.filter((mark) => mark.status !== "dismissed").map((mark) => mark.anchor.conversationId)
  );

  const candidates = rankScanCandidates(
    buildScanCandidates(conversations, findings).filter((candidate) => !anchoredConversationIds.has(candidate.conversationId))
  ).slice(0, limit);

  const summary: ScanSummary = {
    conversationsScanned: candidates.length,
    modelCalls: 0,
    skippedResponses: 0,
    marksWritten: 0,
    byCategory: emptyCategoryCounts()
  };
  const marks: MarkRecord[] = [];

  for (const candidate of candidates) {
    summary.modelCalls += 1;
    let result: ScanRunnerResult;
    try {
      result = await runner.analyze({ candidate });
    } catch {
      summary.skippedResponses += 1;
      continue;
    }
    for (const incident of result.incidents) {
      summary.byCategory[incident.category] += 1;
      const draft = draftFromIncident(candidate, incident);
      const record = createMarkRecord(draft, now);
      marks.push(record);
      if (!options.dryRun) await writeMarkFn(record, options.marksDir);
      summary.marksWritten += 1;
    }
  }

  return { summary, marks };
}

/** The real conversation loader: ensures the Usage index is current for the window, then builds one `NormalizedConversation` per indexed Claude conversation. */
async function defaultLoadConversations(window: ScanWindow): Promise<NormalizedConversation[]> {
  const since = new Date(Date.now() - window.days * 24 * 60 * 60 * 1000);
  const repo = window.repo || ".";
  const scope = window.repo ? "repo" : "all";
  const dataset = await loadUsageDatasetFromIndex({ repo, scope, since, providers: ["claude"] });
  return dataset.conversations.all().data.map((row) => dataset.conversations.report({ conversationId: row.id }).data);
}
