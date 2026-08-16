import { renderCommandHelp } from "@tangent/core";
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
};

/** Dispatches `tangent agent` subcommands. */
export async function runAgentCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "list") return listCommand(args);
  if (subcommand === "send") return sendCommand(args);
  throw new Error(`Unknown agent command: ${subcommand}. Try "tangent agent list" or "tangent agent send <name> <text>".`);
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

/** Handles `tangent agent send <name> <text...>`. */
async function sendCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const to = requiredString(args._[1], "tangent agent send requires <name>; run \"tangent agent list\" first.");
  const text = args._.slice(2).join(" ").trim();
  if (!text) throw new Error("tangent agent send requires the message text after the session name.");
  const from = stringArg(args.from) || (await currentTmuxSession());
  const result = await postJson(server, "/api/agents/send", { to, text, from });
  if (result.status === "delivered") {
    console.log(`delivered to ${result.to}`);
    return;
  }
  console.log(`queued for ${result.to} (${result.reason}); it will arrive when the composer is empty`);
}

/** One human word for an agent's refined state. */
function describeState(agent: AgentSummary): string {
  if (agent.state === "waiting" && agent.stateDetail === "decision") return "needs decision";
  if (agent.state === "waiting" && agent.stateDetail === "idle") return "idle";
  if (agent.state === "waiting" && agent.stateDetail === "draft") return "draft";
  return agent.state ?? "unknown";
}

/** Prints `tangent agent` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(agentCommandSpec));
  console.log(`
Delivery is state-aware: a message types into the target only when its
composer is empty. Otherwise it queues and arrives when the agent is ready.

Examples:
  tangent agent list
  tangent agent send tangent-copy-text-from-agent-terminals "The endpoint you need is /api/goals/brief."
`);
}
