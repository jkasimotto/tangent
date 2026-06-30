import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

import { correctionMetricsJsonSchema } from "./schema.js";
import { correctionPrompt } from "./prompt.js";
import type { CorrectionRunner, CorrectionRunnerInput, CorrectionRunnerResult } from "./types.js";

export type ClaudeCliCorrectionRunnerConfig = {
  command?: string;
  model: string;
  timeoutMs?: number;
  maxTurns?: number;
};

const correctionRunnerEnv = {
  USAGE_DISABLE_CAPTURE: "1",
  ROLLUP_SUMMARY_RUN: "1"
};

const minStructuredOutputTurns = 2;

/**
 * Judges corrections with one Claude CLI call per conversation, constrained to the correction
 * schema. Defaults to a small, cheap model (haiku) because the input is user messages only. Mirrors
 * the rollup summary runner's CLI invocation so structured output is requested the same way.
 */
export class ClaudeCliCorrectionRunner implements CorrectionRunner {
  constructor(private readonly config: ClaudeCliCorrectionRunnerConfig) {}

  /** Runs one Claude CLI call to judge corrections for a conversation and normalizes the output. */
  async analyze(input: CorrectionRunnerInput): Promise<CorrectionRunnerResult> {
    const command = this.config.command || "claude";
    const result = await runProcess({
      command,
      args: [
        "-p",
        correctionPrompt(input),
        "--model",
        this.config.model,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(correctionMetricsJsonSchema),
        "--setting-sources",
        "project,local",
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(Math.max(this.config.maxTurns || minStructuredOutputTurns, minStructuredOutputTurns))
      ],
      timeoutMs: this.config.timeoutMs || 120000,
      defaultEnv: correctionRunnerEnv
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeCorrections(parseRunnerJson(result.stdout));
  }
}

/** Coerces a runner JSON payload into the correction result contract, keeping count and evidence consistent. */
export function normalizeCorrections(value: unknown): CorrectionRunnerResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const corrections = Array.isArray(record.corrections)
    ? record.corrections.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const quote = (entry as Record<string, unknown>).quote;
        const why = (entry as Record<string, unknown>).why;
        if (typeof quote !== "string") return [];
        return [{ quote, why: typeof why === "string" ? why : "" }];
      })
    : [];
  // The evidence list is the source of truth for the count, so a model that miscounts its own
  // quotes can never produce a number that disagrees with the quotes shown to the user.
  return { correctionCount: corrections.length, corrections };
}
