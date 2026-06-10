import type { RollupInput, RollupOutput } from "./digest.js";

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
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | string;
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
  summarizeRollup(input: RollupInput): Promise<RollupOutput>;
}
