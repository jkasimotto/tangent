import type { EvalAgentConfig } from "../types/provider.js";

/** Builds a shell command hint for manually running a phase with the configured agent. */
export function manualCommandHint(args: {
  agent: EvalAgentConfig;
  executionCwd: string;
  promptPath: string;
}): string {
  if (args.agent.kind === "codex-cli") {
    const command = args.agent.command || "codex";
    return `cd ${shellQuote(args.executionCwd)} && ${command} exec --sandbox ${args.agent.sandbox} --model ${args.agent.model} - < ${shellQuote(args.promptPath)}`;
  }
  if (args.agent.kind === "claude-cli") {
    const command = args.agent.command || "claude";
    return `cd ${shellQuote(args.executionCwd)} && ${command} --print --model ${args.agent.model} < ${shellQuote(args.promptPath)}`;
  }
  return `cd ${shellQuote(args.executionCwd)} # run your agent with ${shellQuote(args.promptPath)}`;
}

/** Wraps a string in single quotes, escaping any interior single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
