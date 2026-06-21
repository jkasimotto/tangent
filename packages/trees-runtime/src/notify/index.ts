import { notify, loadNotifyConfig, type NotifyConfig } from "@tangent/agent-runtime/notify";
import type { TreesClient } from "@tangent/trees-core";
import type { AgentRun, TerminalSession } from "@tangent/trees-schema";

import { parseCommonAgentOutput } from "../agents/index.js";
import { resolveAgentRunStatus } from "../attention/index.js";
import { isShellCommand, tmuxPaneCurrentCommand, type TerminalRuntimeAdapter } from "../terminal/index.js";

export { loadNotifyConfig, type NotifyConfig };

const MAX_CONSECUTIVE_CAPTURE_FAILURES = 3;
const MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;
const CAPTURE_LINES = 40;
const PARSE_TAIL_LINES = 15;

export interface WatchAgentRunInput {
  client: TreesClient;
  agentRun: AgentRun;
  /** Terminal runtime seeded with the run's terminal session. */
  runtime: TerminalRuntimeAdapter;
  terminalSession: TerminalSession;
  config: NotifyConfig;
}

/**
 * Polls a started agent's terminal pane and fires one desktop notification when it
 * needs input (permission/blocked) or finishes, then exits. Trees has no live
 * supervisor: after `trees agent start` sends the agent into a detached tmux session
 * nothing reads its output, so this per-run watcher (spawned detached by the CLI) is
 * the only thing that notices the agent come to rest while you are away.
 */
export async function watchAgentRunNotifications(input: WatchAgentRunInput): Promise<void> {
  const { client, agentRun, runtime, terminalSession, config } = input;
  if (config.driver === "none") return;
  const label = await entityLabel(client, agentRun.entityId);
  const tmuxName = terminalSession.runtimeRef.tmuxSessionName;
  const pollMs = Math.max(1, config.pollSeconds) * 1000;
  const deadline = Date.now() + MAX_RUNTIME_MS;
  let lastStatus: AgentRun["status"] | undefined = agentRun.status;
  let sawRunning = false;
  let failures = 0;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let text: string;
    try {
      text = (await runtime.capture(terminalSession.id, { lines: CAPTURE_LINES })).text;
      failures = 0;
    } catch {
      // tmux session gone (killed/closed) -> nothing left to watch.
      if (++failures >= MAX_CONSECUTIVE_CAPTURE_FAILURES) return;
      continue;
    }

    const observations = parseCommonAgentOutput({ text: tail(text), observedAt: new Date().toISOString(), agentRunId: agentRun.id, entityId: agentRun.entityId, terminalSessionId: terminalSession.id });
    const parsed = resolveAgentRunStatus({ observations, agentRun }).status;

    // Completion is detected by the agent process returning the pane to a shell, which is
    // robust for the one-shot `claude -p` / `codex exec` commands trees runs. Text parsing
    // only refines done-vs-failed. ponytail: tmux pane heuristic; tighten if a shell name slips through.
    const paneCommand = tmuxName ? await tmuxPaneCurrentCommand(tmuxName) : undefined;
    if (paneCommand && !isShellCommand(paneCommand)) sawRunning = true;
    const exited = sawRunning && isShellCommand(paneCommand);

    const status: AgentRun["status"] = parsed === "failed" ? "failed" : parsed === "waiting_permission" || parsed === "blocked" ? parsed : exited ? "done" : parsed;
    if (status === lastStatus) continue;
    lastStatus = status;

    if (status === "waiting_permission" || status === "blocked") {
      if (config.events.needsInput) await notify({ title: `Agent needs you: ${label}`, body: lastLine(text) }, config);
    } else if (status === "failed") {
      if (config.events.failed) await notify({ title: `Agent failed: ${label}`, body: lastLine(text) }, config);
      return;
    } else if (status === "done") {
      if (config.events.done) await notify({ title: `Agent done: ${label}`, body: lastLine(text) }, config);
      return;
    } else if (status === "cancelled") {
      return;
    }
  }
}

/** Resolves a human-friendly label (entity title or path) for the notification. */
async function entityLabel(client: TreesClient, entityId?: string): Promise<string> {
  if (!entityId) return "agent";
  const projection = await client.projection().catch(() => undefined);
  const entity = projection?.entities.find((candidate) => candidate.id === entityId);
  return entity?.title || entity?.path || entityId;
}

/** Keeps only the last few lines so the parser reads the current screen, not stale scrollback. */
function tail(text: string): string {
  return text.split(/\r?\n/).slice(-PARSE_TAIL_LINES).join("\n");
}

/** Last non-empty line of the pane, trimmed and capped for the notification body. */
function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.at(-1) || "").slice(0, 120);
}

/** Resolves after the given delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
