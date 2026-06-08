import type { EvalAgentConfig } from "../types/provider.js";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

type ClaudeConfig = Extract<EvalAgentConfig, { kind: "claude-cli" }>;

export async function runClaudeCli(args: {
  config: ClaudeConfig;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  const command = args.config.command || "claude";
  const cliArgs = ["--print", "--model", args.config.model];
  if (args.config.permissionMode) cliArgs.push("--permission-mode", args.config.permissionMode);
  if (args.config.maxTurns) cliArgs.push("--max-turns", String(args.config.maxTurns));
  const result = await runProcess({
    command,
    args: cliArgs,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.config.timeoutMs || 1800000,
    env: args.env
  });
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return result.stdout;
}
