import { openUsage, type UsageProvider, type TurnListItem } from "@tangent/usage-index-sqlite";

import { readLedger, latestLedgerBySource } from "../core/ledger.js";
import type { LoadedRollupConfig } from "../core/config.js";
import { dateBucket as formatDateBucket } from "../core/time.js";
import type { RollupCandidate } from "../types/digest.js";

export type CandidateQuery = {
  repo: string;
  providers?: UsageProvider[];
  date?: string;
  fromDate?: string;
  toDate?: string;
  rollupKey?: string;
  from?: Date;
  to?: Date;
  bucketBy?: "turnStartedAt" | "turnEndedAt" | "lastActivityAt";
  force?: boolean;
  sourceKey?: string;
};

export type CandidateConversationQuery = CandidateQuery;
export type CandidateConversation = RollupCandidate;
export type InternalCandidateConversation = RollupCandidate & {
  turn: TurnListItem;
};

/** Queries usage turns and returns the list of internal candidate conversations for rollup processing. */
export async function collectCandidates(loaded: LoadedRollupConfig, query: Omit<CandidateQuery, "repo"> = {}): Promise<InternalCandidateConversation[]> {
  const providers = query.providers || loaded.config.input.providers;
  const startedAt = Date.now();
  const dataset = await openUsage({
    repo: loaded.repo.root,
    providers
  });
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const scopedLedger = query.rollupKey ? ledger.filter((line) => (line.rollupKey || line.dateBucket) === query.rollupKey) : ledger;
  const latest = latestLedgerBySource(scopedLedger);
  const bucketBy = query.bucketBy || loaded.config.processing.dateBucket;

  const rows = dataset.turns.list({
    provider: providers.length === 1 ? providers[0] : undefined,
    from: query.from,
    to: query.to,
    bucketBy
  }).data
    .filter((turn) => providers.includes(turn.provider))
    .filter((turn) => !query.sourceKey || turn.sourceKey === query.sourceKey)
    .map((turn) => ({ turn, dateBucket: bucketForTurn(turn, bucketBy, loaded.config.processing.timezone) }))
    .filter((row) => !query.date || row.dateBucket === query.date)
    .filter((row) => !query.fromDate || row.dateBucket >= query.fromDate)
    .filter((row) => !query.toDate || row.dateBucket <= query.toDate)
    .map(({ turn, dateBucket }) => candidateForTurn(turn, dateBucket, latest.get(turn.sourceKey), Boolean(query.force)));

  void startedAt;
  return rows;
}

/** Builds an InternalCandidateConversation from a turn and its prior ledger entry. */
function candidateForTurn(
  turn: TurnListItem,
  dateBucket: string,
  prior: ReturnType<typeof latestLedgerBySource> extends Map<string, infer T> ? T | undefined : never,
  force: boolean
): InternalCandidateConversation {
  const reason: RollupCandidate["reason"] = force
    ? "forced"
    : prior?.status === "failed" && prior.sourceFingerprint === turn.sourceFingerprint
      ? "previously-failed"
      : prior && prior.sourceFingerprint !== turn.sourceFingerprint
        ? "changed"
        : "new";
  return {
    schema: "rollup.candidate.v1",
    sourceKey: turn.sourceKey,
    provider: turn.provider,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    dateBucket,
    startedAt: turn.startedAt?.toISOString(),
    endedAt: turn.endedAt?.toISOString(),
    lastActivityAt: turn.lastActivityAt.toISOString(),
    titlePreview: turn.titlePreview,
    sourceFingerprint: turn.sourceFingerprint,
    priorStatus: prior?.status,
    reason,
    stats: turn.stats,
    turn
  };
}

/** Returns the date bucket string for a turn based on the configured bucketing strategy. */
function bucketForTurn(turn: TurnListItem, bucketBy: NonNullable<CandidateQuery["bucketBy"]>, timezone: string): string {
  const date = bucketBy === "turnStartedAt"
    ? turn.startedAt || turn.lastActivityAt
    : bucketBy === "lastActivityAt"
      ? turn.lastActivityAt
      : turn.endedAt || turn.lastActivityAt;
  return formatDateBucket(date, timezone);
}
