import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RollupInput, RollupOutput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { rollupPrompt } from "../core/prompts.js";
import { rollupJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "@tangent/agent-runtime/process";

type CodexCliConfig = Extract<SummaryProviderConfig, { kind: "codex-cli" }>;

const rollupRunnerEnv = {
  USAGE_DISABLE_CAPTURE: "1",
  ROLLUP_SUMMARY_RUN: "1"
};

export class CodexCliSummaryRunner implements SummaryRunner {
  id = "codex-cli";
  kind = "codex-cli" as const;

  constructor(private readonly config: CodexCliConfig) {}

  /** Checks whether the configured Codex CLI command is available. */
  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "codex";
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

  /** Runs one Codex CLI rollup request and reads the structured last-message output. */
  async summarizeRollup(input: RollupInput): Promise<RollupOutput> {
    const command = this.config.command || "codex";
    const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-rollup-codex-"));
    const schemaPath = path.join(tempDir, "rollup.schema.json");
    const inputPath = path.join(tempDir, "rollup-input.json");
    const outputPath = path.join(tempDir, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(rollupJsonSchema), "utf8");
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    try {
      const result = await runProcess({
        command,
        args: this.codexExecArgs(schemaPath, outputPath, ["--skip-git-repo-check"]),
        cwd: tempDir,
        stdin: rollupPrompt({ inputPath, period: input.period, purpose: input.purpose }),
        timeoutMs: this.config.timeoutMs || 300000,
        defaultEnv: rollupRunnerEnv
      });
      if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
      const output = await readFile(outputPath, "utf8").catch(() => result.stdout);
      return normalizeRollup(parseRunnerJson(output));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  /** Builds Codex exec arguments for a schema-constrained rollup run. */
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
