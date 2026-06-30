export type RollupLedgerLineV1 = {
  schema: "rollup.ledger.v1";
  repoId: string;
  dateBucket: string;
  rollupKey?: string;
  sourceKey: string;
  provider: "claude" | "codex" | "gemini";
  conversationId: string;
  turnId: string;
  sourceFingerprint: string;
  inputVersion: string;
  inputHash?: string;
  rollupPath?: string;
  failurePath?: string;
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

export type ProcessedConversationLedgerLine = RollupLedgerLineV1;
