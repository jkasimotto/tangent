import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DailyRollupInput, DailyRollupOutput, TurnDigest, TurnDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { dayRollupPrompt, turnDigestPrompt } from "../core/prompts.js";
import { dayRollupJsonSchema, normalizeTurnDigest, turnDigestJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

type CodexCliConfig = Extract<SummaryProviderConfig, { kind: "codex-cli" }>;

const dailyRunnerEnv = {
  USAGE_DISABLE_CAPTURE: "1",
  DAILY_SUMMARY_RUN: "1"
};

export class CodexCliSummaryRunner implements SummaryRunner {
  id = "codex-cli";
  kind = "codex-cli" as const;

  constructor(private readonly config: CodexCliConfig) {}

  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "codex";
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
    const command = this.config.command || "codex";
    const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-daily-codex-"));
    const schemaPath = path.join(tempDir, "turn-digest.schema.json");
    const outputPath = path.join(tempDir, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(turnDigestJsonSchema), "utf8");
    try {
      const args = this.codexExecArgs(schemaPath, outputPath);
      const result = await runProcess({
        command,
        args,
        stdin: turnDigestPrompt(input),
        timeoutMs: this.config.timeoutMs || 300000,
        defaultEnv: dailyRunnerEnv
      });
      if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
      const output = await readFile(outputPath, "utf8").catch(() => result.stdout);
      return normalizeTurnDigest(parseRunnerJson(output), { source: {
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
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async summarizeDay(input: DailyRollupInput): Promise<DailyRollupOutput> {
    const command = this.config.command || "codex";
    const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-daily-codex-day-"));
    const schemaPath = path.join(tempDir, "day-rollup.schema.json");
    const inputPath = path.join(tempDir, "day-input.json");
    const outputPath = path.join(tempDir, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(dayRollupJsonSchema), "utf8");
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    try {
      const result = await runProcess({
        command,
        args: this.codexExecArgs(schemaPath, outputPath, ["--skip-git-repo-check"]),
        cwd: tempDir,
        stdin: dayRollupPrompt({ inputPath, date: input.date }),
        timeoutMs: this.config.timeoutMs || 300000,
        defaultEnv: dailyRunnerEnv
      });
      if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
      const output = await readFile(outputPath, "utf8").catch(() => result.stdout);
      return normalizeDayRollup(parseRunnerJson(output));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private codexExecArgs(schemaPath: string, outputPath: string, extra: string[] = []): string[] {
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      this.config.sandbox,
      "--model",
      this.config.model,
      "-c",
      `model_reasoning_effort=${JSON.stringify(this.config.reasoningEffort || "low")}`,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      ...extra
    ];
    if (this.config.profile) args.push("--profile", this.config.profile);
    args.push("-");
    return args;
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
