import { renderCommandHelp } from "@tangent/core";
import { parseArgs, requiredString, stringArg } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl } from "../client.js";
import { sendCommandSpec } from "../spec.js";

/**
 * Handles one ordinary note to a live session or durable Area inbox.
 */
export async function runSendCli(argv = process.argv.slice(2)): Promise<void> {
  const legacy = argv.find((value) => ["--done", "--blocked"].includes(value));
  if (argv.some((value) => ["--question", "--present"].includes(value))) throw new Error('worker send flags are gone. Use: tangent send <brain-area> "<plain note>"');
  const args = parseArgs(argv.filter((value) => value !== legacy));
  if (args.help) {
    console.log(renderCommandHelp(sendCommandSpec));
    console.log(examples());
    return;
  }
  const server = resolveServerUrl(stringArg(args.server));
  const to = requiredString(args._[0], "tangent send needs a live session name or an Area path.");
  if (to === "brain") throw new Error('brain is not a send target. Use the Area path in the worker prompt.');
  let text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent send needs the note text after the target.");
  if (legacy) text = `${legacy.slice(2)}: ${text}`;
  const from = stringArg(args.session) || stringArg(args.from) || (await currentTmuxSession());
  const result = await postJson(server, "/api/agents/send", { to, text, from });
  console.log(sendResultLine(result));
}

/** The line a session or Area send prints. */
export function sendResultLine(result: Record<string, any>): string {
  if (result.target === "area" && result.live) return `Sent to ${result.to}.`;
  if (result.target === "area") return `Saved for ${result.to}. It reads this when it runs.`;
  if (result.status === "delivered") return `Sent to ${result.to}.`;
  return `queued for ${result.to} (${result.reason}); it will arrive when the composer is empty`;
}

/** Real examples for the help text. */
function examples(): string {
  return `
Examples:
  tangent send otto/tangent "Parser and route committed as 3f2a1c0; npm test is green."
  tangent send neara/essential/autodesign "Start the queued design Goal when you return."
`;
}
