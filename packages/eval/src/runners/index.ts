import type { EvalAgentConfig } from "../types/provider.js";
import { runClaudeCli } from "./claude-cli.js";
import { runCodexCli } from "./codex-cli.js";

export async function runAgent(args: {
  agent: EvalAgentConfig;
  prompt: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  if (args.agent.kind === "manual") throw new Error("Manual agent cannot be run automatically.");
  if (args.agent.kind === "codex-cli") return runCodexCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, sandbox: args.sandbox, env: args.env });
  if (args.agent.kind === "claude-cli") return runClaudeCli({ config: args.agent, prompt: args.prompt, cwd: args.cwd, env: args.env });
  throw new Error(`Unknown agent kind: ${(args.agent as { kind?: string }).kind}`);
}
