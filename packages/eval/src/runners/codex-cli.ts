import type { EvalAgentConfig } from "../types/provider.js";
import { runAgentCli } from "@tangent/agent-runtime/agent";

type CodexConfig = Extract<EvalAgentConfig, { kind: "codex-cli" }>;
type ProcessOutputChunk = { stream: "stdout" | "stderr"; chunk: string };

/** Runs Codex CLI in exec mode for an eval phase and returns its last message output. */
export async function runCodexCli(args: {
  config: CodexConfig;
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
}): Promise<string> {
  const result = await runAgentCli({
    agent: {
      provider: "codex",
      command: args.config.command,
      model: args.config.model,
      profile: args.config.profile,
      timeoutMs: args.config.timeoutMs,
      env: args.env
    },
    prompt: args.prompt,
    cwd: args.cwd,
    sandbox: args.sandbox,
    signal: args.signal,
    onOutput: args.onOutput
  });
  return result.text;
}
