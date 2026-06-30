import type { RollupInput, RollupOutput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { rollupPrompt } from "../core/prompts.js";
import { rollupJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

type ClaudeCliConfig = Extract<SummaryProviderConfig, { kind: "claude-cli" }>;

const rollupRunnerEnv = {
  USAGE_DISABLE_CAPTURE: "1",
  ROLLUP_SUMMARY_RUN: "1"
};

const minStructuredOutputTurns = 2;

export class ClaudeCliSummaryRunner implements SummaryRunner {
  id = "claude-cli";
  kind = "claude-cli" as const;

  constructor(private readonly config: ClaudeCliConfig) {}

  /** Checks whether the configured Claude CLI command is available. */
  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "claude";
    try {
      const result = await runProcess({ command, args: ["--version"], timeoutMs: 5000, defaultEnv: rollupRunnerEnv });
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

  /** Runs one Claude CLI rollup request and normalizes the structured output. */
  async summarizeRollup(input: RollupInput): Promise<RollupOutput> {
    const command = this.config.command || "claude";
    const prompt = rollupPrompt({ period: input.period, inputJson: JSON.stringify(input), purpose: input.purpose });
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
        JSON.stringify(rollupJsonSchema),
        "--setting-sources",
        "project,local",
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(maxStructuredOutputTurns(this.config))
      ],
      timeoutMs: this.config.timeoutMs || 120000,
      defaultEnv: rollupRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeRollup(parseRunnerJson(result.stdout));
  }
}

/** Ensures Claude gets enough turns to emit structured output reliably. */
function maxStructuredOutputTurns(config: ClaudeCliConfig): number {
  return Math.max(config.maxTurns || minStructuredOutputTurns, minStructuredOutputTurns);
}

/** Converts a runner JSON payload into the rollup output contract. */
function normalizeRollup(value: unknown): RollupOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    schema: "rollup.output.v1",
    markdown: typeof record.markdown === "string" ? record.markdown : typeof record.generatedMarkdown === "string" ? record.generatedMarkdown : "",
    sourceCaveats: stringArray(record.sourceCaveats)
  };
}

/** Keeps only string entries from an unknown array-like field. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
