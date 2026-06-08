export type DailyLedgerLineV2 = {
  schema: "daily.ledger.v2";
  repoId: string;
  dateBucket: string;
  sourceKey: string;
  provider: "claude" | "codex";
  conversationId: string;
  turnId: string;
  sourceFingerprint: string;
  inputVersion: string;
  inputHash?: string;
  digestPath?: string;
  topicKeys?: string[];
  processedAt: string;
  status:
    | "processed"
    | "failed"
    | "skipped-empty"
    | "skipped-active";
  error?: {
    code: string;
    message: string;
  };
};

export type ProcessedConversationLedgerLine = DailyLedgerLineV2;
