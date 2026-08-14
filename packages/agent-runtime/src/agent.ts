import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { processFailure, runProcess, stripMarkdownFence, type ProcessOutputChunk } from "./process.js";

export type AgentCliProvider = "claude" | "codex" | "gemini";

export type AgentCliSandbox = "read-only" | "workspace-write" | "danger-full-access";

export type AgentCliSession =
  | { kind: "fresh"; id?: string }
  | { kind: "resume"; id: string };

export type AgentCliConfig = {
  provider: AgentCliProvider;
  command?: string;
  loginShell?: boolean;
  model?: string;
  profile?: string;
  effort?: string;
  permissionMode?: string;
  maxTurns?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
};

export type AgentCliEvent = {
  provider: AgentCliProvider;
  event: Record<string, unknown>;
};

export type RunAgentCliArgs = {
  agent: AgentCliConfig;
  prompt: string;
  cwd: string;
  sandbox?: AgentCliSandbox;
  session?: AgentCliSession;
  schema?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
  onEvent?: (event: AgentCliEvent) => void;
};

export type AgentCliResult = {
  provider: AgentCliProvider;
  text: string;
  structuredOutput?: unknown;
  sessionId?: string;
  stdout: string;
  stderr: string;
};

/** Runs one supported coding-agent CLI and returns its durable handoff facts. */
export async function runAgentCli(args: RunAgentCliArgs): Promise<AgentCliResult> {
  const session = args.session || { kind: "fresh" as const };
  if (args.agent.provider === "claude") return runClaude(args, session);
  if (args.agent.provider === "codex") return runCodex(args, session);
  return runGemini(args, session);
}

/** Runs one Claude CLI print session. */
async function runClaude(args: RunAgentCliArgs, session: AgentCliSession): Promise<AgentCliResult> {
  const cliArgs = ["--print", "--output-format", "stream-json", "--verbose"];
  if (args.agent.model) cliArgs.push("--model", args.agent.model);
  if (args.agent.effort) cliArgs.push("--effort", args.agent.effort);
  if (args.agent.permissionMode) cliArgs.push("--permission-mode", args.agent.permissionMode);
  if (args.agent.maxTurns) cliArgs.push("--max-turns", String(args.agent.maxTurns));
  if (args.schema) cliArgs.push("--json-schema", JSON.stringify(args.schema));
  if (session.kind === "resume") cliArgs.push("--resume", session.id);
  else if (session.id) cliArgs.push("--session-id", session.id);
  cliArgs.push(...(args.agent.extraArgs || []));
  const invocation = providerInvocation(args.agent, "claude", cliArgs);

  let buffer = "";
  let resultText = "";
  let structuredOutput: unknown;
  let sessionId = session.id;
  /** Reads one Claude stream-json event. */
  const handleLine = (line: string): void => {
    const event = parseEvent(line);
    if (!event) return;
    args.onEvent?.({ provider: "claude", event });
    sessionId = sessionIdFromEvent(event) || sessionId;
    if (event.type === "result") {
      if (typeof event.result === "string") resultText = event.result;
      if (event.structured_output !== undefined) structuredOutput = event.structured_output;
    }
  };

  const result = await runProcess({
    command: invocation.command,
    args: invocation.args,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.agent.timeoutMs || 1_800_000,
    env: mergedEnv(args),
    signal: args.signal,
    /** Parses complete JSONL records while it forwards the original stream. */
    onOutput: (chunk) => {
      if (chunk.stream === "stdout") {
        buffer += chunk.chunk;
        buffer = consumeLines(buffer, handleLine);
      }
      args.onOutput?.(chunk);
    }
  });
  if (buffer.trim()) handleLine(buffer);
  if (result.code !== 0) throw processFailure(invocation.displayCommand, result.code, result.stderr, result.stdout);
  if (structuredOutput === undefined && args.schema && resultText.trim()) structuredOutput = parseStructured(resultText);
  if (!resultText && structuredOutput !== undefined) resultText = JSON.stringify(structuredOutput);
  return { provider: "claude", text: resultText, structuredOutput, sessionId, ...result };
}

/** Runs one Codex CLI exec session. */
async function runCodex(args: RunAgentCliArgs, session: AgentCliSession): Promise<AgentCliResult> {
  const temporary = await mkdtemp(path.join(tmpdir(), "tangent-agent-codex-"));
  const outputPath = path.join(temporary, "last-message.json");
  const schemaPath = path.join(temporary, "output-schema.json");
  try {
    if (args.schema) await writeFile(schemaPath, `${JSON.stringify(args.schema, null, 2)}\n`, "utf8");
    const cliArgs = session.kind === "resume" ? ["exec", "resume"] : ["exec"];
    if (session.kind === "fresh" && args.sandbox) cliArgs.push("--sandbox", args.sandbox);
    if (args.agent.model) cliArgs.push("--model", args.agent.model);
    if (session.kind === "fresh" && args.agent.profile) cliArgs.push("--profile", args.agent.profile);
    if (args.agent.effort) cliArgs.push("--config", `model_reasoning_effort=${JSON.stringify(args.agent.effort)}`);
    if (args.schema) cliArgs.push("--output-schema", schemaPath);
    cliArgs.push("--json", "--output-last-message", outputPath);
    cliArgs.push(...(args.agent.extraArgs || []));
    if (session.kind === "resume") cliArgs.push(session.id);
    cliArgs.push("-");
    const invocation = providerInvocation(args.agent, "codex", cliArgs);

    let buffer = "";
    let sessionId = session.kind === "resume" ? session.id : undefined;
    let eventText = "";
    /** Reads one Codex JSONL event. */
    const handleLine = (line: string): void => {
      const event = parseEvent(line);
      if (!event) return;
      args.onEvent?.({ provider: "codex", event });
      sessionId = sessionIdFromEvent(event) || sessionId;
      eventText = agentTextFromCodexEvent(event) || eventText;
    };
    const result = await runProcess({
      command: invocation.command,
      args: invocation.args,
      stdin: args.prompt,
      cwd: args.cwd,
      timeoutMs: args.agent.timeoutMs || 1_800_000,
      env: mergedEnv(args),
      signal: args.signal,
      /** Parses complete JSONL records while it forwards the original stream. */
      onOutput: (chunk) => {
        if (chunk.stream === "stdout") {
          buffer += chunk.chunk;
          buffer = consumeLines(buffer, handleLine);
        }
        args.onOutput?.(chunk);
      }
    });
    if (buffer.trim()) handleLine(buffer);
    if (result.code !== 0) throw processFailure(invocation.displayCommand, result.code, result.stderr, result.stdout);
    const text = await readFile(outputPath, "utf8").catch(() => eventText || result.stdout);
    const structuredOutput = args.schema ? parseStructured(text) : undefined;
    return { provider: "codex", text, structuredOutput, sessionId, ...result };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Runs one Gemini CLI session. Gemini does not expose a compatible resume contract. */
async function runGemini(args: RunAgentCliArgs, session: AgentCliSession): Promise<AgentCliResult> {
  if (session.kind === "resume") throw new Error("Gemini CLI session continuation is not supported.");
  const cliArgs: string[] = [];
  if (args.agent.model) cliArgs.push("--model", args.agent.model);
  cliArgs.push(...(args.agent.extraArgs || []));
  const invocation = providerInvocation(args.agent, "gemini", cliArgs);
  const result = await runProcess({
    command: invocation.command,
    args: invocation.args,
    stdin: args.prompt,
    cwd: args.cwd,
    timeoutMs: args.agent.timeoutMs || 1_800_000,
    env: mergedEnv(args),
    signal: args.signal,
    onOutput: args.onOutput
  });
  if (result.code !== 0) throw processFailure(invocation.displayCommand, result.code, result.stderr, result.stdout);
  const structuredOutput = args.schema ? parseStructured(result.stdout) : undefined;
  return { provider: "gemini", text: result.stdout, structuredOutput, ...result };
}

/** Wraps a provider command in the user's login shell when a saved preset can be an alias. */
function providerInvocation(agent: AgentCliConfig, fallback: string, cliArgs: string[]): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  const providerCommand = agent.command || fallback;
  if (!agent.loginShell) return { command: providerCommand, args: cliArgs, displayCommand: providerCommand };
  if (!/^[A-Za-z0-9_./:+-]+$/.test(providerCommand)) {
    throw new Error(`Login-shell agent command must be one executable or alias name: ${providerCommand}`);
  }
  const shell = agent.env?.SHELL || process.env.SHELL || "/bin/zsh";
  const launch = path.basename(shell).startsWith("zsh")
    ? `if (( \${+aliases[${providerCommand}]} )); then eval "exec \${aliases[${providerCommand}]} \\\"\\$@\\\""; else exec ${providerCommand} "$@"; fi`
    : `exec ${providerCommand} "$@"`;
  return {
    command: shell,
    args: ["-lic", launch, "tangent-agent", ...cliArgs],
    displayCommand: providerCommand
  };
}

/** Merges the saved agent environment under invocation-specific values. */
function mergedEnv(args: RunAgentCliArgs): NodeJS.ProcessEnv {
  return { ...args.agent.env, ...args.env };
}

/** Parses one JSONL line and ignores non-event output. */
function parseEvent(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Removes complete newline-terminated records from one stream buffer. */
function consumeLines(buffer: string, handleLine: (line: string) => void): string {
  let rest = buffer;
  let newline = rest.indexOf("\n");
  while (newline >= 0) {
    handleLine(rest.slice(0, newline));
    rest = rest.slice(newline + 1);
    newline = rest.indexOf("\n");
  }
  return rest;
}

/** Reads a provider session identifier from common CLI event shapes. */
function sessionIdFromEvent(event: Record<string, unknown>): string | undefined {
  for (const key of ["session_id", "sessionId", "thread_id", "threadId"]) {
    const value = event[key];
    if (typeof value === "string" && value) return value;
  }
  const thread = event.thread;
  if (thread && typeof thread === "object") {
    const id = (thread as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

/** Reads final assistant text from a Codex item event. */
function agentTextFromCodexEvent(event: Record<string, unknown>): string | undefined {
  const item = event.item;
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (record.type !== "agent_message") return undefined;
  return typeof record.text === "string" ? record.text : undefined;
}

/** Parses one structured final response from plain or fenced JSON text. */
function parseStructured(text: string): unknown {
  const trimmed = stripMarkdownFence(text);
  if (!trimmed) throw new Error("Agent returned empty structured output.");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(`Agent returned invalid structured output: ${(error as Error).message}`);
  }
}
