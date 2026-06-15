import type { EvalAgentConfig } from "../types/provider.js";
import { runClaudeCli } from "./claude-cli.js";
import { runCodexCli } from "./codex-cli.js";

export type AgentRunProgress = {
  stream: "stdout" | "stderr";
  chunk: string;
};

export async function runAgent(args: {
  agent: EvalAgentConfig;
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: AgentRunProgress) => void;
}): Promise<string> {
  if (args.agent.kind === "manual") throw new Error("Manual agent cannot be run automatically.");
  if (args.agent.kind === "codex-cli") return runCodexCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, sandbox: args.sandbox, env: args.env, signal: args.signal, onOutput: args.onOutput });
  if (args.agent.kind === "claude-cli") return runClaudeCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, env: args.env, signal: args.signal, onOutput: args.onOutput });
  throw new Error(`Unknown agent kind: ${(args.agent as { kind?: string }).kind}`);
}
