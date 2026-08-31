import { renderCommandHelp } from "@tangent/core";
import { randomUUID } from "node:crypto";
import { booleanArg, parseArgs, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl, vaultFetch } from "../client.js";
import { agentCommandSpec } from "../spec.js";

type AgentSummary = {
  name: string;
  area: string | null;
  kind: string | null;
  goal: string | null;
  state: string | null;
  stateDetail: string | null;
  stateQuestion: string;
  queued: number;
  agentState?: { word: string; since: number; owner: string; evidence?: { source?: string; text?: string }; next?: string } | null;
};

/** Dispatches `tangent agent` subcommands. */
export async function runAgentCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "show") return showCommand(args);
  if (subcommand === "stop") return stopCommand(args);
  if (subcommand === "resume") return resumeCommand(args);
  if (subcommand === "context") { console.error("tangent agent context is now tangent agent show"); return showCommand(args); }
  if (subcommand === "send") return sendCommand(args);
  throw new Error(`Unknown agent command: ${subcommand}. Try "tangent agent list", "tangent agent show <session>", or "tangent agent send <session> <text>".`);
}

/** Shows one exact live or historical Agent. */
async function showCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = String(args._[1] ?? stringArg(args.session) ?? (await currentTmuxSession()) ?? "").trim();
  if (!session) throw new Error("tangent agent show needs a session name outside tmux.");
  const alias = args._[0] === "context" ? "&compatAlias=agent%20context" : "";
  const { agent } = await vaultFetch(server, `/api/agents/show?session=${encodeURIComponent(session)}${alias}`);
  if (booleanArg(args.json)) return console.log(JSON.stringify(agent, null, 2));
  console.log(`${agent.session}  [${agent.live ? "live" : "historical"}]  ${agent.role}`);
  if (agent.attempt) console.log(`Attempt ${agent.attempt.id} · Assignment ${agent.attempt.assignmentId} · Job ${agent.attempt.run}`);
  if (agent.context) printContext(agent.context);
}

/** Stops one exact Agent and its active Attempt. */
async function stopCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = requiredString(args._[1], "tangent agent stop requires <session>.");
  const { agent } = await vaultFetch(server, `/api/agents/show?session=${encodeURIComponent(session)}`);
  const result = await postJson(server, "/api/agents/stop", { session, expectedTarget: agent.target, expectedAttemptId: agent.attempt?.id ?? "", operationId: randomUUID() });
  if (booleanArg(args.json)) return console.log(JSON.stringify(result, null, 2));
  console.log(`stopped Agent ${session}`);
}

/** Resumes one historical Agent as an unbound session. */
async function resumeCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const session = requiredString(args._[1], "tangent agent resume requires <session>.");
  const result = await postJson(server, "/api/agents/resume", { session, conversationId: stringArg(args.conversation) ?? "", operationId: randomUUID() });
  if (booleanArg(args.json)) return console.log(JSON.stringify(result, null, 2));
  console.log(`resumed ${session} in unbound Agent ${result.agent.session}`);
}

/** Handles `tangent agent list`. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const { agents } = (await vaultFetch(server, "/api/agents")) as { agents: AgentSummary[] };
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }
  if (!agents.length) {
    console.log("No live agents.");
    return;
  }
  for (const agent of agents) {
    const parts = [agent.name, `[${describeState(agent)}]`];
    if (agent.area) parts.push(agent.area);
    if (agent.goal) parts.push(agent.goal);
    if (agent.queued) parts.push(`(${agent.queued} queued)`);
    console.log(parts.join("  "));
    if (agent.stateQuestion) console.log(`    asks: ${agent.stateQuestion}`);
  }
}

/** Compatibility implementation retained for tests during the alias release. */
async function contextCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const positional = String(args._[1] ?? "").trim();
  const explicit = stringArg(args.session);
  if (positional && explicit && positional !== explicit) throw new Error("tangent agent context received two different session names");
  const session = explicit || positional || (await currentTmuxSession());
  if (!session) throw new Error("tangent agent context needs a session name when it runs outside tmux");
  const query = new URLSearchParams({ session });
  const { context } = (await vaultFetch(server, `/api/agents/context?${query}`)) as { context: AgentContext };
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(context, null, 2));
    return;
  }
  printContext(context);
}

/** Sends to one exact Agent. Area addressing remains a one-release adapter. */
async function sendCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const to = requiredString(args._[1], "tangent agent send requires a live session.");
  const text = args._.slice(2).join(" ").trim();
  if (!text) throw new Error("tangent agent send requires the message text after the session or Area path.");
  const from = stringArg(args.from) || (await currentTmuxSession());
  const result = await postJson(server, "/api/agents/send", { to, text, from, operationId: randomUUID() });
  if (result.status === "delivered") {
    console.log(`delivered to ${result.to}`);
    return;
  }
  if (result.target === "area") {
    console.error('Area addressing moved to tangent send <area> "<plain note>"');
    console.log(`queued for ${result.to} (${result.reason})`);
    return;
  }
  console.log(`queued for ${result.to} (${result.reason}); it will arrive when the composer is empty`);
}

/** One human word for an agent's refined state. */
export function describeState(agent: AgentSummary): string {
  if (agent.agentState?.word) return `${agent.agentState.word} · ${stateAge(agent.agentState.since)} · owner ${agent.agentState.owner}`;
  if (agent.state === "waiting" && agent.stateDetail === "decision") return "needs decision";
  if (agent.state === "waiting" && agent.stateDetail === "idle") return "idle";
  if (agent.state === "waiting" && agent.stateDetail === "draft") return "draft";
  return agent.state ?? "unknown";
}

/** Formats the age of one server-authoritative state word. */
export function stateAge(since: number): string {
  const elapsed = Math.max(0, Date.now() - Number(since || Date.now()));
  if (elapsed < 60_000) return "0m";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  return `${Math.floor(elapsed / 3_600_000)}h`;
}

type AgentContext = {
  session: string;
  role: "brain" | "worker" | "repair" | "unassigned";
  area: string | null;
  current: boolean;
  source: string;
  brain?: {
    status?: string;
    generation?: number | null;
    foundingInstruction?: string;
    checkpoint?: string;
  };
  repair?: { result?: string | null; report?: string | null; leaseUntil?: string; resolvedLaunch?: { command?: string } };
  unreadNotices?: Array<{ id?: string; area?: string; text?: string }>;
  goal?: { title?: string; file?: string; status?: string; doneWhen?: string };
  queue?: { status?: string; revision?: number; currentAssignmentId?: string | null } | null;
  assignment?: { index?: number; total?: number; kind?: string; status?: string; instruction?: string } | null;
  priorHandovers?: Array<{ index?: number; handover?: string | null }>;
  prompt?: string | null;
  promptError?: string | null;
  message?: string;
};

/** Prints durable context in a form a person or replacement harness can read. */
function printContext(context: AgentContext): void {
  console.log(`session: ${context.session}`);
  console.log(`role: ${context.role}${context.current ? " (current)" : " (historical)"}`);
  console.log(`area: ${context.area ?? "unassigned"}`);
  if (context.role === "unassigned") {
    console.log(context.message ?? "This session has no durable Tangent assignment.");
    return;
  }
  if (context.role === "brain") {
    console.log(`brain: ${context.brain?.status ?? "unknown"}${context.brain?.generation ? ` generation ${context.brain.generation}` : ""}`);
    if (context.brain?.foundingInstruction) console.log(`\nFounding instruction:\n${context.brain.foundingInstruction}`);
    if (context.brain?.checkpoint) console.log(`\nCheckpoint:\n${context.brain.checkpoint}`);
    const notices = context.unreadNotices ?? [];
    console.log(`\nUnread durable notices: ${notices.length}`);
    for (const notice of notices) console.log(`- ${notice.id ?? "notice"}${notice.area ? ` [${notice.area}]` : ""}: ${notice.text ?? ""}`);
    if (context.prompt) console.log(`\nRebuilt prompt:\n${context.prompt}`);
    else if (context.promptError) console.log(`\nPrompt rebuild unavailable: ${context.promptError}`);
    return;
  }
  if (context.role === "repair") {
    console.log(`repair: ${context.current ? "current" : context.repair?.result ?? "ended"}`);
    if (context.repair?.leaseUntil) console.log(`lease: ${context.repair.leaseUntil}`);
    if (context.repair?.report) console.log(`report: ${context.repair.report}`);
    return;
  }
  if (context.goal) {
    console.log(`goal: ${context.goal.title ?? ""} (${context.goal.file ?? "unknown file"})`);
    console.log(`goal status: ${context.goal.status ?? "unknown"}`);
    if (context.goal.doneWhen) console.log(`\nDone when:\n${context.goal.doneWhen}`);
  }
  if (context.queue) console.log(`\njob: ${context.queue.status ?? "unknown"} revision ${context.queue.revision ?? "unknown"}`);
  if (context.assignment) {
    console.log(`assignment: ${context.assignment.index ?? "?"} of ${context.assignment.total ?? "?"} · ${context.assignment.kind ?? "implementation"} · ${context.assignment.status ?? "unknown"}`);
    if (context.assignment.instruction) console.log(`\nInstruction:\n${context.assignment.instruction}`);
  }
  const handovers = (context.priorHandovers ?? []).filter((entry) => entry.handover);
  if (handovers.length) {
    console.log("\nPrior handovers:");
    for (const handover of handovers) console.log(`- Assignment ${handover.index ?? "?"}: ${handover.handover}`);
  }
  if (context.prompt) console.log(`\nRebuilt prompt:\n${context.prompt}`);
  else if (context.promptError) console.log(`\nPrompt rebuild unavailable: ${context.promptError}`);
}

/** Prints `tangent agent` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(agentCommandSpec));
  console.log(`
Delivery is state-aware: a message types into the target only when its
composer is empty. An Area path stores the message in that brain's durable
inbox even when the brain is not running.

Examples:
  tangent agent list
  tangent agent context
  tangent agent context tangent-copy-text-from-agent-terminals --json
  tangent send tangent-copy-text-from-agent-terminals "The endpoint you need is /api/goals/brief."
  tangent send neara/essential/autodesign "Start the queued design Goal when you return."
`);
}
