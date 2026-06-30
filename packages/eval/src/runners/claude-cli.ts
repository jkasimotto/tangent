import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalAgentEvent, EvalAgentEventKind } from "../types/telemetry.js";
import { processFailure, runProcess } from "@tangent/agent-runtime/process";

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
  const command = args.config.command || "claude";
  const cliArgs = ["--print", "--output-format", "stream-json", "--verbose", "--model", args.config.model];
  if (args.config.permissionMode) cliArgs.push("--permission-mode", args.config.permissionMode);
  if (args.config.maxTurns) cliArgs.push("--max-turns", String(args.config.maxTurns));

  let buffer = "";
  let resultText = "";
  /** Parses one stream-json line, emitting telemetry and capturing the final result text. */
  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.type === "assistant") {
      const at = new Date().toISOString();
      const message = event.message as { usage?: Record<string, number>; content?: Array<{ type?: string; name?: string }> } | undefined;
      args.onEvent?.({ at, kind: "assistant", tokens: outputTokens(message?.usage) });
      for (const block of message?.content || []) {
        if (block.type === "tool_use") args.onEvent?.({ at, kind: toolEventKind(block.name || ""), tokens: 0 });
      }
    } else if (event.type === "result") {
      if (typeof event.result === "string") resultText = event.result;
      const total = totalTokens(event.usage as Record<string, number> | undefined);
      if (total) args.onUsageTotal?.(total);
    }
  };

  const result = await runProcess({
    command,
    args: cliArgs,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.config.timeoutMs || 1800000,
    env: args.env,
    signal: args.signal,
    /** Splits streamed stdout into whole lines for incremental stream-json parsing. */
    onOutput: (chunk) => {
      if (chunk.stream === "stdout") {
        buffer += chunk.chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      args.onOutput?.(chunk);
    }
  });
  if (buffer.trim()) handleLine(buffer);
  if (result.code !== 0) throw processFailure(command, result.code, result.stderr, result.stdout);
  return resultText;
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
