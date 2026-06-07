import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionDigest, SessionDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { sessionDigestPrompt } from "../core/prompts.js";
import { normalizeSessionDigest, sessionDigestJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "./process.js";

type CodexCliConfig = Extract<SummaryProviderConfig, { kind: "codex-cli" }>;

export class CodexCliSummaryRunner implements SummaryRunner {
  id = "codex-cli";
  kind = "codex-cli" as const;

  constructor(private readonly config: CodexCliConfig) {}

  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "codex";
    try {
      const result = await runProcess({ command, args: ["--version"], timeoutMs: 5000 });
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

  async summarizeSession(input: SessionDigestInput): Promise<SessionDigest> {
    const command = this.config.command || "codex";
    const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-daily-codex-"));
    const schemaPath = path.join(tempDir, "session-digest.schema.json");
    const outputPath = path.join(tempDir, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(sessionDigestJsonSchema), "utf8");
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
        stdin: sessionDigestPrompt(input),
        timeoutMs: this.config.timeoutMs || 300000
      });
      if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
      const output = await readFile(outputPath, "utf8").catch(() => result.stdout);
      return normalizeSessionDigest(parseRunnerJson(output));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
