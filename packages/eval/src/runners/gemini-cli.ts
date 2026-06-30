import type { EvalAgentConfig } from "../types/provider.js";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

type GeminiConfig = Extract<EvalAgentConfig, { kind: "gemini-cli" }>;
type ProcessOutputChunk = { stream: "stdout" | "stderr"; chunk: string };

/** Runs `gemini` in non-interactive mode by piping the prompt to stdin and returning stdout as the result. */
export async function runGeminiCli(args: {
  config: GeminiConfig;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
}): Promise<string> {
  const command = args.config.command || "gemini";
  const cliArgs: string[] = [];
  if (args.config.model) cliArgs.push("--model", args.config.model);

  const result = await runProcess({
    command,
    args: cliArgs,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.config.timeoutMs || 1800000,
    env: args.env,
    signal: args.signal,
    onOutput: args.onOutput
  });
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return result.stdout;
}
