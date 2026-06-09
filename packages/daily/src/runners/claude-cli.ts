import type { DailyRollupInput, DailyRollupOutput, TurnDigest, TurnDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { dayRollupPrompt, turnDigestPrompt } from "../core/prompts.js";
import { dayRollupJsonSchema, normalizeTurnDigest, turnDigestJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

type ClaudeCliConfig = Extract<SummaryProviderConfig, { kind: "claude-cli" }>;

const dailyRunnerEnv = {
  USAGE_DISABLE_CAPTURE: "1",
  DAILY_SUMMARY_RUN: "1"
};

export class ClaudeCliSummaryRunner implements SummaryRunner {
  id = "claude-cli";
  kind = "claude-cli" as const;

  constructor(private readonly config: ClaudeCliConfig) {}

  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "claude";
    try {
      const result = await runProcess({ command, args: ["--version"], timeoutMs: 5000, defaultEnv: dailyRunnerEnv });
      return {
        available: result.code === 0,
        command,
        version: (result.stdout || result.stderr).trim() || undefined,
        authStatus: "unknown",
        warnings: result.code === 0 ? [] : [result.stderr.trim()].filter(Boolean)
      };
    } catch (error) {
      return { available: false, command, authStatus: "unknown", warnings: [(error as Error).message] };
    }
  }

  async summarizeTurn(input: TurnDigestInput): Promise<TurnDigest> {
    const command = this.config.command || "claude";
    const prompt = turnDigestPrompt(input);
    const result = await runProcess({
      command,
      args: [
        "-p",
        prompt,
        "--model",
        this.config.model,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(turnDigestJsonSchema),
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(this.config.maxTurns || 1)
      ],
      timeoutMs: this.config.timeoutMs || 120000,
      defaultEnv: dailyRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeTurnDigest(parseRunnerJson(result.stdout), { source: {
      sourceKey: input.source.sourceKey,
      provider: input.source.provider,
      conversationId: input.source.conversationId,
      turnId: input.source.turnId,
      dateBucket: input.source.dateBucket,
      startedAt: input.source.startedAt,
      endedAt: input.source.endedAt,
      wallTimeMs: input.source.wallTimeMs,
      inputHash: ""
    } });
  }

  async summarizeDay(input: DailyRollupInput): Promise<DailyRollupOutput> {
    const command = this.config.command || "claude";
    const prompt = dayRollupPrompt({ date: input.date, inputJson: JSON.stringify(input) });
    const result = await runProcess({
      command,
      args: [
        "-p",
        prompt,
        "--model",
        this.config.model,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(dayRollupJsonSchema),
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(this.config.maxTurns || 1)
      ],
      timeoutMs: this.config.timeoutMs || 120000,
      defaultEnv: dailyRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeDayRollup(parseRunnerJson(result.stdout));
  }
}

function normalizeDayRollup(value: unknown): DailyRollupOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    schema: "daily.rollup.v1",
    markdown: typeof record.markdown === "string" ? record.markdown : typeof record.generatedMarkdown === "string" ? record.generatedMarkdown : "",
    sourceCaveats: stringArray(record.sourceCaveats)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
