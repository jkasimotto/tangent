import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalAgentEvent } from "../types/telemetry.js";
import { runClaudeCli } from "./claude-cli.js";
import { runCodexCli } from "./codex-cli.js";
import { runGeminiCli } from "./gemini-cli.js";

export type AgentRunProgress = {
  stream: "stdout" | "stderr";
  chunk: string;
};

/** Dispatches a variant's agent config to its runner, overlaying the agent's own env (e.g. CLAUDE_CONFIG_DIR) under the eval's TANGENT_EVAL_* vars so a variant can pick its config home/auth. */
export async function runAgent(args: {
  agent: EvalAgentConfig;
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: AgentRunProgress) => void;
  onEvent?: (event: EvalAgentEvent) => void;
  onUsageTotal?: (tokensTotal: number) => void;
}): Promise<string> {
  if (args.agent.kind === "manual") throw new Error("Manual agent cannot be run automatically.");
  const env: NodeJS.ProcessEnv = { ...("env" in args.agent ? args.agent.env : undefined), ...args.env };
  if (args.agent.kind === "codex-cli") return runCodexCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, sandbox: args.sandbox, env, signal: args.signal, onOutput: args.onOutput });
  if (args.agent.kind === "claude-cli") return runClaudeCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, env, signal: args.signal, onOutput: args.onOutput, onEvent: args.onEvent, onUsageTotal: args.onUsageTotal });
  if (args.agent.kind === "gemini-cli") return runGeminiCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, env, signal: args.signal, onOutput: args.onOutput });
  throw new Error(`Unknown agent kind: ${(args.agent as { kind?: string }).kind}`);
}
