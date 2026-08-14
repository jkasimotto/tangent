import type { EvalAgentConfig } from "../types/provider.js";
import { runAgentCli } from "@tangent/agent-runtime/agent";

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
  const result = await runAgentCli({
    agent: {
      provider: "gemini",
      command: args.config.command,
      model: args.config.model,
      timeoutMs: args.config.timeoutMs,
      env: args.env
    },
    prompt: args.prompt,
    cwd: args.cwd,
    signal: args.signal,
    onOutput: args.onOutput
  });
  return result.text;
}
