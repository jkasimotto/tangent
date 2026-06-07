import { scanRepo, type ConvosProvider } from "@convos/convos";

import { buildSessionDigestInput, conversationEnvelopes, isProcessable, type ConversationEnvelope } from "./adapter.js";
import { hashObject } from "../core/hash.js";
import { readLedger, latestLedgerByConversation } from "../core/ledger.js";
import type { LoadedDailyConfig } from "../core/config.js";
import type { SessionDigestInput } from "../types/digest.js";

export type UnprocessedConversationQuery = {
  repo: string;
  providers?: ConvosProvider[];
  date?: string;
  from?: Date;
  to?: Date;
  bucketBy?: "startedAt" | "endedAt" | "lastActivityAt";
  includeActive?: boolean;
  force?: boolean;
  conversationId?: string;
};

export type UnprocessedConversation = {
  conversationId: string;
  provider: ConvosProvider;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  dateBucket: string;
  title?: string;
  reason: "new" | "changed" | "previously-failed" | "forced";
  inputHash: string;
};

export type InternalUnprocessedConversation = UnprocessedConversation & {
  envelope: ConversationEnvelope;
  input: SessionDigestInput;
  eventHighWatermark?: string;
};

export async function collectUnprocessed(loaded: LoadedDailyConfig, query: Omit<UnprocessedConversationQuery, "repo"> = {}): Promise<InternalUnprocessedConversation[]> {
  const providers = query.providers || loaded.config.input.providers;
  const scan = await scanRepo({
    repo: loaded.repo.root,
    providers,
    sources: ["native", "convos-jsonl"]
  });
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const latest = latestLedgerByConversation(ledger);

  return conversationEnvelopes(scan, {
    ...loaded.config,
    processing: {
      ...loaded.config.processing,
      dateBucket: query.bucketBy || loaded.config.processing.dateBucket
    }
  }).filter((envelope) => providers.includes(envelope.provider))
    .filter((envelope) => !query.conversationId || envelope.conversation.id === query.conversationId)
    .filter((envelope) => !query.date || envelope.dateBucket === query.date)
    .filter((envelope) => inDateRange(envelope, query.from, query.to))
    .filter((envelope) => isProcessable(envelope, loaded.config, query.includeActive))
    .map((envelope) => {
      const input = buildSessionDigestInput({ dataset: scan, repo: loaded.repo, config: loaded.config, envelope });
      const inputHash = hashObject(input);
      const prior = latest.get(envelope.conversation.id);
      const reason: UnprocessedConversation["reason"] = query.force
        ? "forced"
        : prior?.status === "failed" && prior.inputHash === inputHash
          ? "previously-failed"
          : prior && prior.inputHash !== inputHash
            ? "changed"
            : "new";
      return {
        conversationId: envelope.conversation.id,
        provider: envelope.provider,
        startedAt: envelope.conversation.startedAt?.toISOString(),
        endedAt: envelope.conversation.endedAt?.toISOString(),
        lastActivityAt: envelope.lastActivityAt?.toISOString(),
        dateBucket: envelope.dateBucket,
        title: envelope.conversation.title,
        reason,
        inputHash,
        envelope,
        input,
        eventHighWatermark: envelope.eventHighWatermark
      };
    })
    .filter((row) => {
      if (query.force) return true;
      const prior = latest.get(row.conversationId);
      return !(prior?.inputHash === row.inputHash && prior.status === "processed");
    });
}

function inDateRange(envelope: ConversationEnvelope, from?: Date, to?: Date): boolean {
  const date = envelope.conversation.endedAt || envelope.lastActivityAt || envelope.conversation.startedAt;
  if (!date) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
