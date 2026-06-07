import type { SessionDigest, SessionDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryProviderConfig, SummaryRunner } from "../types/provider.js";
import { sessionDigestPrompt } from "../core/prompts.js";
import { normalizeSessionDigest, sessionDigestJsonSchema } from "../core/schemas.js";
import { parseRunnerJson, runnerFailure, runProcess } from "./process.js";

type ClaudeCliConfig = Extract<SummaryProviderConfig, { kind: "claude-cli" }>;

export class ClaudeCliSummaryRunner implements SummaryRunner {
  id = "claude-cli";
  kind = "claude-cli" as const;

  constructor(private readonly config: ClaudeCliConfig) {}

  async checkAvailable(): Promise<RunnerStatus> {
    const command = this.config.command || "claude";
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
    const command = this.config.command || "claude";
    const prompt = sessionDigestPrompt(input);
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
        JSON.stringify(sessionDigestJsonSchema),
        "--no-session-persistence",
        "--tools",
        "",
        "--max-turns",
        String(this.config.maxTurns || 1)
      ],
      timeoutMs: this.config.timeoutMs || 120000
    });
    if (result.code !== 0) throw runnerFailure(command, result.code, result.stderr, result.stdout);
    return normalizeSessionDigest(parseRunnerJson(result.stdout));
  }
}
