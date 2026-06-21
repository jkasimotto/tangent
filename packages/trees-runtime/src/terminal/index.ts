import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { runProcess } from "@tangent/agent-runtime/process";
import { hashString } from "@tangent/core";
import type { AgentCommandSpec, TerminalSession, TreeObservation } from "@tangent/trees-schema";

export interface TerminalRuntimeAdapter {
  id: string;
  create(input: CreateTerminalSessionInput): Promise<TerminalSession>;
  start(sessionId: string, command: AgentCommandSpec): Promise<TerminalSession>;
  attach(sessionId: string): Promise<TerminalAttachHandle>;
  capture(sessionId: string, options?: CaptureOptions): Promise<TerminalCapture>;
  send(sessionId: string, input: TerminalInput): Promise<void>;
  kill(sessionId: string): Promise<void>;
  list(query?: TerminalQuery): Promise<TerminalSession[]>;
  observe?(query?: TerminalQuery): AsyncIterable<TreeObservation>;
}

export type CreateTerminalSessionInput = {
  id?: string;
  runtimeId?: string;
  entityId?: string;
  entityPath?: string;
  agentRunId?: string;
  workSessionId?: string;
  cwd?: string;
  command?: string;
};

export type TerminalAttachHandle = {
  command: string;
  args: string[];
};

export type CaptureOptions = {
  lines?: number;
};

export type TerminalCapture = {
  sessionId: string;
  text: string;
  lines: string[];
  capturedAt: string;
};

export type TerminalInput = {
  text: string;
  enter?: boolean;
};

export type TerminalQuery = {
  entityId?: string;
  agentRunId?: string;
};

/** Documents the tmuxSessionNameForEntityPath helper. */
export function tmuxSessionNameForEntityPath(entityPath: string): string {
  const readable = entityPath.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "root";
  return `tt-${readable}-${hashString(entityPath, 10)}`;
}

/** Documents the sanitizeTmuxEnvironment helper. */
export function sanitizeTmuxEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  delete sanitized.TMUX;
  delete sanitized.TMUX_PANE;
  return sanitized;
}

/** Documents the createTmuxRuntimeAdapter helper. */
export function createTmuxRuntimeAdapter(initialSessions: TerminalSession[] = []): TerminalRuntimeAdapter {
  const sessions = new Map<string, TerminalSession>(initialSessions.filter((session) => session.runtimeId === "tmux").map((session) => [session.id, session]));
  return {
    id: "tmux",
    /** Documents the create helper. */
    async create(input) {
      const id = input.id || `term_${hashString(`${input.entityPath || input.entityId || "session"}:${Date.now()}`, 12)}`;
      const tmuxSessionName = input.entityPath ? tmuxSessionNameForEntityPath(input.entityPath) : `tt-${id}`;
      const session: TerminalSession = {
        schema: "tangent.trees.terminalSession.v1",
        id,
        runtimeId: "tmux",
        entityId: input.entityId,
        agentRunId: input.agentRunId,
        workSessionId: input.workSessionId,
        cwd: input.cwd,
        command: input.command,
        runtimeRef: { tmuxSessionName },
        status: "detached",
        startedAt: new Date().toISOString(),
        evidence: []
      };
      await tmux(["has-session", "-t", tmuxSessionName]).catch(async () => {
        await tmux(["new-session", "-d", "-s", tmuxSessionName, "-c", input.cwd || process.cwd()]);
      });
      sessions.set(id, session);
      return session;
    },
    /** Documents the start helper. */
    async start(sessionId, command) {
      const session = requireSession(sessions, sessionId);
      const name = requireTmuxName(session);
      const shellLine = commandLine(command);
      await tmux(["send-keys", "-t", name, shellLine, "Enter"], command.env);
      const updated = { ...session, command: shellLine, status: "running" as const };
      sessions.set(sessionId, updated);
      return updated;
    },
    /** Documents the attach helper. */
    async attach(sessionId) {
      const session = requireSession(sessions, sessionId);
      return { command: "tmux", args: ["attach-session", "-t", requireTmuxName(session)] };
    },
    /** Documents the capture helper. */
    async capture(sessionId, options = {}) {
      const session = requireSession(sessions, sessionId);
      const lines = String(options.lines || 200);
      const result = await tmuxText(["capture-pane", "-p", "-t", requireTmuxName(session), "-S", `-${lines}`]);
      return { sessionId, text: result, lines: result.split(/\r?\n/), capturedAt: new Date().toISOString() };
    },
    /** Documents the send helper. */
    async send(sessionId, input) {
      const session = requireSession(sessions, sessionId);
      const args = ["send-keys", "-t", requireTmuxName(session), input.text];
      if (input.enter !== false) args.push("Enter");
      await tmux(args);
    },
    /** Documents the kill helper. */
    async kill(sessionId) {
      const session = requireSession(sessions, sessionId);
      await tmux(["kill-session", "-t", requireTmuxName(session)]).catch(() => undefined);
      sessions.set(sessionId, { ...session, status: "killed", endedAt: new Date().toISOString() });
    },
    /** Documents the list helper. */
    async list(query = {}) {
      return [...sessions.values()].filter((session) => (!query.entityId || session.entityId === query.entityId) && (!query.agentRunId || session.agentRunId === query.agentRunId));
    }
  };
}

/** Documents the createProcessRuntimeAdapter helper. */
export function createProcessRuntimeAdapter(initialSessions: TerminalSession[] = []): TerminalRuntimeAdapter {
  const sessions = new Map<string, TerminalSession>(initialSessions.filter((session) => session.runtimeId === "process").map((session) => [session.id, session]));
  const processes = new Map<string, ChildProcessWithoutNullStreams>();
  const output = new Map<string, string[]>();
  return {
    id: "process",
    /** Documents the create helper. */
    async create(input) {
      const id = input.id || `term_${hashString(`${input.entityId || "process"}:${Date.now()}`, 12)}`;
      const session: TerminalSession = {
        schema: "tangent.trees.terminalSession.v1",
        id,
        runtimeId: "process",
        entityId: input.entityId,
        agentRunId: input.agentRunId,
        workSessionId: input.workSessionId,
        cwd: input.cwd,
        command: input.command,
        runtimeRef: {},
        status: "starting",
        startedAt: new Date().toISOString(),
        evidence: []
      };
      sessions.set(id, session);
      output.set(id, []);
      return session;
    },
    /** Documents the start helper. */
    async start(sessionId, command) {
      const session = requireSession(sessions, sessionId);
      const child = spawn(command.command, command.args, { cwd: command.cwd, env: { ...process.env, ...command.env }, stdio: ["pipe", "pipe", "pipe"] });
      processes.set(sessionId, child);
      /** Documents the appendOutput helper. */
      const appendOutput = (chunk: Buffer) => {
        output.get(sessionId)?.push(chunk.toString("utf8"));
        const current = sessions.get(sessionId);
        if (current) sessions.set(sessionId, { ...current, lastOutputAt: new Date().toISOString() });
      };
      child.stdout.on("data", appendOutput);
      child.stderr.on("data", appendOutput);
      child.on("close", (code) => {
        const current = sessions.get(sessionId);
        if (current) sessions.set(sessionId, { ...current, status: "exited", exitCode: code ?? undefined, endedAt: new Date().toISOString() });
      });
      if (command.stdin !== undefined) child.stdin.end(command.stdin);
      else child.stdin.end();
      const updated = { ...session, command: commandLine(command), status: "running" as const, runtimeRef: { processPid: child.pid } };
      sessions.set(sessionId, updated);
      return updated;
    },
    /** Documents the attach helper. */
    async attach(sessionId) {
      requireSession(sessions, sessionId);
      return { command: "tangent", args: ["trees", "terminal", "capture", sessionId] };
    },
    /** Documents the capture helper. */
    async capture(sessionId, options = {}) {
      requireSession(sessions, sessionId);
      const text = (output.get(sessionId) || []).join("");
      const lines = text.split(/\r?\n/).slice(-(options.lines || 200));
      return { sessionId, text: lines.join("\n"), lines, capturedAt: new Date().toISOString() };
    },
    /** Documents the send helper. */
    async send(sessionId, input) {
      const child = processes.get(sessionId);
      if (!child) throw new Error(`Process terminal is not running: ${sessionId}`);
      child.stdin.write(input.text);
      if (input.enter !== false) child.stdin.write("\n");
    },
    /** Documents the kill helper. */
    async kill(sessionId) {
      processes.get(sessionId)?.kill("SIGTERM");
      const session = requireSession(sessions, sessionId);
      sessions.set(sessionId, { ...session, status: "killed", endedAt: new Date().toISOString() });
    },
    /** Documents the list helper. */
    async list(query = {}) {
      return [...sessions.values()].filter((session) => (!query.entityId || session.entityId === query.entityId) && (!query.agentRunId || session.agentRunId === query.agentRunId));
    }
  };
}

/** Returns the foreground command in a tmux pane ("claude"/"codex"/"node" while the agent runs, a shell name once it exits), or undefined if the session is gone. Used by the notify watcher to detect completion. */
export async function tmuxPaneCurrentCommand(tmuxSessionName: string): Promise<string | undefined> {
  return tmuxText(["display-message", "-p", "-t", tmuxSessionName, "#{pane_current_command}"]).then((text) => text.trim() || undefined).catch(() => undefined);
}

/** Whether a tmux pane_current_command value is an interactive shell (the agent has returned control). */
export function isShellCommand(command: string | undefined): boolean {
  return !!command && /^-?(zsh|bash|sh|fish|dash|ksh)$/.test(command);
}

/** Documents the tmux helper. */
async function tmux(args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  const result = await runProcess({ command: "tmux", args, env: sanitizeTmuxEnvironment(env), timeoutMs: 15000 });
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `tmux ${args.join(" ")} failed`);
}

/** Documents the tmuxText helper. */
async function tmuxText(args: string[]): Promise<string> {
  const result = await runProcess({ command: "tmux", args, env: sanitizeTmuxEnvironment(), timeoutMs: 15000 });
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `tmux ${args.join(" ")} failed`);
  return result.stdout;
}

/** Documents the commandLine helper. */
function commandLine(command: AgentCommandSpec): string {
  const env = Object.entries(command.env || {}).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  const argv = [command.command, ...command.args].map(shellQuote).join(" ");
  return [env, argv].filter(Boolean).join(" ");
}

/** Documents the shellQuote helper. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Documents the requireSession helper. */
function requireSession(sessions: Map<string, TerminalSession>, id: string): TerminalSession {
  const session = sessions.get(id);
  if (!session) throw new Error(`Unknown terminal session: ${id}`);
  return session;
}

/** Documents the requireTmuxName helper. */
function requireTmuxName(session: TerminalSession): string {
  if (!session.runtimeRef.tmuxSessionName) throw new Error(`Terminal session is not tmux-backed: ${session.id}`);
  return session.runtimeRef.tmuxSessionName;
}
