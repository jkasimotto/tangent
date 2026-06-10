import type { SummaryProviderConfig } from "../types/provider.js";
import type { SummaryRunner } from "../types/provider.js";
import { ClaudeCliSummaryRunner } from "./claude-cli.js";
import { ClaudeSdkSummaryRunner } from "./claude-sdk.js";
import { CodexCliSummaryRunner } from "./codex-cli.js";

export { type SummaryRunner } from "../types/provider.js";

export function createSummaryRunner(config: SummaryProviderConfig): SummaryRunner {
  if (config.kind === "claude-sdk") return new ClaudeSdkSummaryRunner(config);
  if (config.kind === "codex-cli") return new CodexCliSummaryRunner(config);
  return new ClaudeCliSummaryRunner(config);
}
