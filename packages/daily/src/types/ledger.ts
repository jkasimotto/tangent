export type ProcessedConversationLedgerLine = {
  schema: "daily.ledger.v1";
  repoId: string;
  repoRootHash: string;
  conversationId: string;
  provider: "claude" | "codex";
  inputHash: string;
  eventHighWatermark?: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  dateBucket: string;
  processedAt: string;
  status:
    | "processed"
    | "skipped-active"
    | "skipped-empty"
    | "failed"
    | "stale";
  digestPath?: string;
  notePath?: string;
  error?: {
    code: string;
    message: string;
  };
};
