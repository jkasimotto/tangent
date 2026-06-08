import type { DailyNote } from "./daily-note.js";
import type { TopicRollup, TurnDigest, TurnDigestInput } from "./digest.js";

export type SummaryProviderKind = "claude-cli" | "claude-sdk" | "codex-cli";

export type SummaryProviderConfig =
  | {
      kind: "claude-cli";
      command?: "claude" | string;
      model: "sonnet" | "opus" | "haiku" | string;
      fallbackModel?: string;
      maxTurns?: number;
      timeoutMs?: number;
    }
  | {
      kind: "claude-sdk";
      model: "sonnet" | "opus" | "haiku" | string;
      timeoutMs?: number;
    }
  | {
      kind: "codex-cli";
      command?: "codex" | string;
      model: string;
      profile?: string;
      sandbox: "read-only" | "workspace-write" | "danger-full-access";
      timeoutMs?: number;
    };

export type RunnerStatus = {
  available: boolean;
  command?: string;
  version?: string;
  authStatus?: "ok" | "missing" | "unknown";
  supportedModels?: string[];
  warnings: string[];
};

export interface SummaryRunner {
  id: string;
  kind: SummaryProviderKind;
  checkAvailable(): Promise<RunnerStatus>;
  summarizeTurn(input: TurnDigestInput): Promise<TurnDigest>;
  rollupTopic?(args: { date: string; key: string; title: string; digests: TurnDigest[] }): Promise<TopicRollup>;
  rollupDay?(note: DailyNote): Promise<Partial<DailyNote>>;
}
