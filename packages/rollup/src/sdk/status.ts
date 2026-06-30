import { openUsage, status as usageStatus, type ConversationListItem, type TurnListItem } from "@tangent/usage-index-sqlite";
import { pathExists } from "@tangent/repo";

import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { notePath } from "../core/paths.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import type { SummaryProviderConfig, RunnerStatus } from "../types/provider.js";
import { collectCandidates } from "../usage/selectors.js";

export type RollupStatus = {
  repo: {
    root: string;
    id: string;
    displayName: string;
  };
  usage: {
    available: boolean;
    providers: Record<
      "claude" | "codex",
      {
        tracked: boolean;
        sources: string[];
        turns: number;
        lastTurnAt?: string;
      }
    >;
  };
  rollup: {
    initialized: boolean;
    outputDir: string;
    notesDir: string;
    ledgerPath: string;
    configSources: string[];
  };
  summaryProvider: RunnerStatus & {
    kind: SummaryProviderConfig["kind"];
    model?: string;
  };
  candidates: {
    total: number;
    byProvider: Record<string, number>;
    byDate: Record<string, number>;
  };
  notes: Array<{
    date: string;
    path: string;
    exists: boolean;
    stale: boolean;
    turnCount: number;
  }>;
};

export type StatusOptions = {
  repo: string;
  date?: string;
};

export async function status(options: StatusOptions): Promise<RollupStatus> {
  const loaded = await loadConfig({ repo: options.repo });
  const usage = await usageStatus({ repo: loaded.repo.root });
  const dataset = await openUsage({ repo: loaded.repo.root, providers: ["claude", "codex"] });
  const conversations = dataset.conversations.all().data;
  const turns = dataset.turns.list().data;
  const runner = createSummaryRunner(loaded.config.summary.provider);
  const providerStatus = await runner.checkAvailable();
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  const candidates = await collectCandidates(loaded, { date });
  const note = notePath(loaded.paths, date);

  return {
    repo: {
      root: loaded.repo.root,
      id: loaded.repo.id,
      displayName: loaded.config.repo?.displayName || loaded.repo.displayName
    },
    usage: {
      available: true,
      providers: {
        claude: providerRow("claude", usage, conversations, turns),
        codex: providerRow("codex", usage, conversations, turns)
      }
    },
    rollup: {
      initialized: loaded.sources.includes(loaded.paths.privateConfigPath),
      outputDir: loaded.paths.outputDir,
      notesDir: loaded.paths.notesDir,
      ledgerPath: loaded.paths.ledgerPath,
      configSources: loaded.sources
    },
    summaryProvider: {
      ...providerStatus,
      kind: loaded.config.summary.provider.kind,
      model: "model" in loaded.config.summary.provider ? loaded.config.summary.provider.model : undefined
    },
    candidates: {
      total: candidates.length,
      byProvider: countBy(candidates, (row) => row.provider),
      byDate: countBy(candidates, (row) => row.dateBucket)
    },
    notes: [
      {
        date,
        path: note,
        exists: await pathExists(note),
        stale: false,
        turnCount: turns.filter((turn) => turn.endedAt?.toISOString().slice(0, 10) === date || turn.lastActivityAt.toISOString().slice(0, 10) === date).length
      }
    ]
  };
}

function providerRow(provider: "claude" | "codex", usage: Awaited<ReturnType<typeof usageStatus>>, conversations: ConversationListItem[], turns: TurnListItem[]): RollupStatus["usage"]["providers"]["claude"] {
  const row = usage.providers.find((entry) => entry.provider === provider);
  const providerTurns = turns.filter((turn) => turn.provider === provider);
  return {
    tracked: Boolean(row?.capture.enabled || row?.capture.lastEvent || row?.nativePaths.length),
    sources: [
      row?.nativePaths.length ? "native" : row?.capture.lastEvent ? "usage-jsonl" : undefined,
    ].filter((value): value is string => Boolean(value)),
    turns: providerTurns.length,
    lastTurnAt: latestTurnAt(providerTurns) || latestConversationAt(conversations.filter((conversation) => conversation.provider === provider)) || row?.capture.lastEvent
  };
}

function latestConversationAt(conversations: ConversationListItem[]): string | undefined {
  const times = conversations
    .flatMap((conversation) => [conversation.endedAt, conversation.startedAt])
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.getTime());
  const latest = Math.max(...times);
  return Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
}

function latestTurnAt(turns: TurnListItem[]): string | undefined {
  const times = turns.map((turn) => turn.lastActivityAt.getTime());
  const latest = Math.max(...times);
  return Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
}

function countBy<T>(rows: T[], selector: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
