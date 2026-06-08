import { openUsage, type UsageProvider, type TurnListItem } from "@tangent/usage";

import { isProcessableTurn } from "./adapter.js";
import { readLedger, latestLedgerBySource } from "../core/ledger.js";
import type { LoadedDailyConfig } from "../core/config.js";
import { dateBucket as formatDateBucket } from "../core/time.js";
import type { DailyCandidate } from "../types/digest.js";

export type CandidateQuery = {
  repo: string;
  providers?: UsageProvider[];
  date?: string;
  from?: Date;
  to?: Date;
  bucketBy?: "turnStartedAt" | "turnEndedAt" | "lastActivityAt";
  includeActive?: boolean;
  force?: boolean;
  sourceKey?: string;
};

export type UnprocessedConversationQuery = CandidateQuery;
export type UnprocessedConversation = DailyCandidate;
export type InternalUnprocessedConversation = DailyCandidate & {
  turn: TurnListItem;
};

export async function collectCandidates(loaded: LoadedDailyConfig, query: Omit<CandidateQuery, "repo"> = {}): Promise<InternalUnprocessedConversation[]> {
  const providers = query.providers || loaded.config.input.providers;
  const startedAt = Date.now();
  const dataset = await openUsage({
    repo: loaded.repo.root,
    providers
  });
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const latest = latestLedgerBySource(ledger);
  const bucketBy = query.bucketBy || loaded.config.processing.dateBucket;

  const rows = dataset.turns.list({
    provider: providers.length === 1 ? providers[0] : undefined,
    from: query.from,
    to: query.to,
    includeActive: query.includeActive || loaded.config.processing.includeActiveConversations,
    bucketBy
  }).data
    .filter((turn) => providers.includes(turn.provider))
    .filter((turn) => !query.sourceKey || turn.sourceKey === query.sourceKey)
    .map((turn) => ({ turn, dateBucket: bucketForTurn(turn, bucketBy, loaded.config.processing.timezone) }))
    .filter((row) => !query.date || row.dateBucket === query.date)
    .filter((row) => isProcessableTurn(row.turn, loaded.config, query.includeActive))
    .map(({ turn, dateBucket }) => candidateForTurn(turn, dateBucket, latest.get(turn.sourceKey), Boolean(query.force)))
    .filter((row) => {
      if (query.force) return true;
      const prior = latest.get(row.sourceKey);
      return !(prior?.sourceFingerprint === row.sourceFingerprint && prior.status === "processed");
    });

  void startedAt;
  return rows;
}

export const collectUnprocessed = collectCandidates;

function candidateForTurn(
  turn: TurnListItem,
  dateBucket: string,
  prior: ReturnType<typeof latestLedgerBySource> extends Map<string, infer T> ? T | undefined : never,
  force: boolean
): InternalUnprocessedConversation {
  const reason: DailyCandidate["reason"] = force
    ? "forced"
    : prior?.status === "failed" && prior.sourceFingerprint === turn.sourceFingerprint
      ? "previously-failed"
      : prior && prior.sourceFingerprint !== turn.sourceFingerprint
        ? "changed"
        : "new";
  return {
    schema: "daily.candidate.v1",
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

function bucketForTurn(turn: TurnListItem, bucketBy: NonNullable<CandidateQuery["bucketBy"]>, timezone: string): string {
  const date = bucketBy === "turnStartedAt"
    ? turn.startedAt || turn.lastActivityAt
    : bucketBy === "lastActivityAt"
      ? turn.lastActivityAt
      : turn.endedAt || turn.lastActivityAt;
  return formatDateBucket(date, timezone);
}
