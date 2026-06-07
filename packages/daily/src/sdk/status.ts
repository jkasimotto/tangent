import { scanRepo, status as convosStatus, type ConversationListItem } from "@convos/convos";

import { loadConfig } from "../core/config.js";
import { dateArgToBucket, dateBucket, todayBucket } from "../core/time.js";
import { notePath } from "../core/paths.js";
import { pathExists } from "../core/repo.js";
import { latestLedgerByConversation, readLedger } from "../core/ledger.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import type { SummaryProviderConfig, RunnerStatus } from "../types/provider.js";

export type DailyStatus = {
  repo: {
    root: string;
    id: string;
    displayName: string;
  };
  convos: {
    available: boolean;
    providers: Record<
      "claude" | "codex",
      {
        tracked: boolean;
        sources: string[];
        conversations: number;
        lastConversationAt?: string;
      }
    >;
  };
  daily: {
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
  unprocessed: {
    total: number;
    byProvider: Record<string, number>;
    byDate: Record<string, number>;
  };
  notes: Array<{
    date: string;
    path: string;
    exists: boolean;
    stale: boolean;
    conversationCount: number;
  }>;
};

export type StatusOptions = {
  repo: string;
  date?: string;
};

export async function status(options: StatusOptions): Promise<DailyStatus> {
  const loaded = await loadConfig({ repo: options.repo });
  const convos = await convosStatus({ repo: loaded.repo.root });
  const dataset = await scanRepo({ repo: loaded.repo.root, providers: ["claude", "codex"], sources: ["convos-jsonl"] });
  const conversations = dataset.conversations.all().data;
  const runner = createSummaryRunner(loaded.config.summary.provider);
  const providerStatus = await runner.checkAvailable();
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  const unprocessed = await lightweightUnprocessed(loaded, conversations);
  const note = notePath(loaded.paths, date);

  return {
    repo: {
      root: loaded.repo.root,
      id: loaded.repo.id,
      displayName: loaded.config.repo?.displayName || loaded.repo.displayName
    },
    convos: {
      available: true,
      providers: {
        claude: providerRow("claude", convos, conversations),
        codex: providerRow("codex", convos, conversations)
      }
    },
    daily: {
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
    unprocessed: {
      total: unprocessed.length,
      byProvider: countBy(unprocessed, (row) => row.provider),
      byDate: countBy(unprocessed, (row) => row.dateBucket)
    },
    notes: [
      {
        date,
        path: note,
        exists: await pathExists(note),
        stale: false,
        conversationCount: 0
      }
    ]
  };
}

async function lightweightUnprocessed(loaded: Awaited<ReturnType<typeof loadConfig>>, conversations: ConversationListItem[]): Promise<Array<{ provider: "claude" | "codex"; dateBucket: string }>> {
  const ledger = latestLedgerByConversation(await readLedger(loaded.paths.ledgerPath));
  return conversations
    .filter((conversation) => loaded.config.input.providers.includes(conversation.provider))
    .filter((conversation) => conversation.endedAt || loaded.config.processing.includeActiveConversations)
    .filter((conversation) => ledger.get(conversation.id)?.status !== "processed")
    .map((conversation) => ({
      provider: conversation.provider,
      dateBucket: bucketConversation(conversation, loaded.config.processing.dateBucket, loaded.config.processing.timezone)
    }));
}

function bucketConversation(conversation: ConversationListItem, bucketBy: "endedAt" | "startedAt" | "lastActivityAt", timezone: string): string {
  const date = bucketBy === "startedAt" ? conversation.startedAt : conversation.endedAt || conversation.startedAt;
  return dateBucket(date || new Date(), timezone);
}

function providerRow(provider: "claude" | "codex", convos: Awaited<ReturnType<typeof convosStatus>>, conversations: ConversationListItem[]): DailyStatus["convos"]["providers"]["claude"] {
  const row = convos.providers.find((entry) => entry.provider === provider);
  const providerConversations = conversations.filter((conversation) => conversation.provider === provider);
  return {
    tracked: Boolean(row?.capture.enabled || row?.capture.lastEvent || row?.nativePaths.length),
    sources: [
      row?.capture.lastEvent ? "convos-jsonl" : undefined,
      row?.nativePaths.length ? "native" : undefined
    ].filter((value): value is string => Boolean(value)),
    conversations: providerConversations.length,
    lastConversationAt: latestConversationAt(providerConversations) || row?.capture.lastEvent
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

function countBy<T>(rows: T[], selector: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
