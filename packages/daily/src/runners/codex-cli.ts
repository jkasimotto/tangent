import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TurnDigest, TurnDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { turnDigestPrompt } from "../core/prompts.js";
import { normalizeTurnDigest, turnDigestJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

type CodexCliConfig = Extract<SummaryProviderConfig, { kind: "codex-cli" }>;

const dailyRunnerEnv = {
  CONVOS_DISABLE_CAPTURE: "1",
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
      const args = [
        "exec",
        "--ephemeral",
        "--sandbox",
        this.config.sandbox,
        "--model",
        this.config.model,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath
      ];
      if (this.config.profile) args.push("--profile", this.config.profile);
      args.push("-");
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
}
