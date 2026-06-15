import type { EvalAgentConfig } from "../types/provider.js";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

type ClaudeConfig = Extract<EvalAgentConfig, { kind: "claude-cli" }>;
type ProcessOutputChunk = { stream: "stdout" | "stderr"; chunk: string };

export async function runClaudeCli(args: {
  config: ClaudeConfig;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
}): Promise<string> {
  const command = args.config.command || "claude";
  const cliArgs = ["--print", "--model", args.config.model];
  if (args.config.permissionMode) cliArgs.push("--permission-mode", args.config.permissionMode);
  if (args.config.maxTurns) cliArgs.push("--max-turns", String(args.config.maxTurns));
  const processArgs = {
    command,
    args: cliArgs,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.config.timeoutMs || 1800000,
    env: args.env,
    signal: args.signal,
    onOutput: args.onOutput
  };
  const result = await runProcess(processArgs);
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return result.stdout;
}
