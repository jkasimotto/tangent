import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalAgentEvent, EvalAgentEventKind } from "../types/telemetry.js";
import { runAgentCli } from "@tangent/agent-runtime/agent";

type ClaudeConfig = Extract<EvalAgentConfig, { kind: "claude-cli" }>;
type ProcessOutputChunk = { stream: "stdout" | "stderr"; chunk: string };

/**
 * Runs `claude --print` in stream-json mode so the eval can capture timestamped activity (assistant
 * turns and tool calls) and final token totals. Headless `--print` writes no transcript the usage index
 * can scan, so onEvent/onUsageTotal are the eval's only telemetry source; the final assistant text is
 * pulled from the terminating `result` event and returned, keeping the runner's contract unchanged.
 */
export async function runClaudeCli(args: {
  config: ClaudeConfig;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
  onEvent?: (event: EvalAgentEvent) => void;
  onUsageTotal?: (tokensTotal: number) => void;
}): Promise<string> {
  /** Emits Eval telemetry from one shared runner event. */
  const handleEvent = (event: Record<string, unknown>): void => {
    if (event.type === "assistant") {
      const at = new Date().toISOString();
      const message = event.message as { usage?: Record<string, number>; content?: Array<{ type?: string; name?: string }> } | undefined;
      args.onEvent?.({ at, kind: "assistant", tokens: outputTokens(message?.usage) });
      for (const block of message?.content || []) {
        if (block.type === "tool_use") args.onEvent?.({ at, kind: toolEventKind(block.name || ""), tokens: 0 });
      }
    } else if (event.type === "result") {
      const total = totalTokens(event.usage as Record<string, number> | undefined);
      if (total) args.onUsageTotal?.(total);
    }
  };
  const result = await runAgentCli({
    agent: {
      provider: "claude",
      command: args.config.command,
      model: args.config.model,
      permissionMode: args.config.permissionMode,
      maxTurns: args.config.maxTurns,
      timeoutMs: args.config.timeoutMs,
      env: args.env
    },
    prompt: args.prompt,
    cwd: args.cwd,
    signal: args.signal,
    onOutput: args.onOutput,
    /** Projects one runner event into evaluation telemetry. */
    onEvent: ({ event }) => handleEvent(event)
  });
  return result.text;
}

/** Output tokens billed for one assistant turn, used to weight that turn's flame bucket. */
function outputTokens(usage: Record<string, number> | undefined): number {
  return usage && typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
}

/** Total tokens for the run from the result usage, for the flame caption. */
function totalTokens(usage: Record<string, number> | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
}

/** Maps a tool name to a flame-palette event kind. */
function toolEventKind(name: string): EvalAgentEventKind {
  if (/bash|shell|exec/i.test(name)) return "command";
  if (/write|edit|read|apply_patch|notebook/i.test(name)) return "file";
  return "tool";
}
