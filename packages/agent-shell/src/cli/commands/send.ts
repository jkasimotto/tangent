import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { currentSessionIsWorker, currentTmuxSession, postJson, resolveServerUrl } from "../client.js";
import { sendCommandSpec } from "../spec.js";

/** The one flag word of a send, or "note" when no flag is given. */
export type SendKind = "note" | "done" | "blocked" | "question";

const FLAG_KINDS: SendKind[] = ["done", "blocked", "question"];

/** The refusal a worker gets for any send target but its brain (D5). The server says the same. */
export const WORKER_SEND_TARGET_REFUSAL = 'workers only send to their brain. Use: tangent send brain "<note>"';

/**
 * Handles `tangent send <to> "<note>" [--done | --blocked | --question]`.
 * `brain` is the brain that controls the caller's Goal, resolved on the
 * server; any other target is a live session or an Area path.
 */
export async function runSendCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { boolean: FLAG_KINDS });
  if (args.help) {
    console.log(renderCommandHelp(sendCommandSpec));
    console.log(examples());
    return;
  }
  const server = resolveServerUrl(stringArg(args.server));
  const to = requiredString(args._[0], "tangent send needs a target: brain, a live session name, or an Area path.");
  const text = args._.slice(1).map(String).join(" ").trim();
  if (!text) throw new Error("tangent send needs the note text after the target.");
  const kind = sendKind(args);
  const from = stringArg(args.session) || stringArg(args.from) || (await currentTmuxSession());
  if (to === "brain") {
    if (!from) throw new Error("tangent send brain works inside a worker session. Name a session or an Area path.");
    const result = await postJson(server, "/api/agents/send", { to, text, from, kind });
    console.log(`sent to ${result.to} (${result.kind ?? kind})`);
    return;
  }
  if (kind !== "note") throw new Error("--done, --blocked, and --question work only with tangent send brain.");
  if (await currentSessionIsWorker()) throw new Error(WORKER_SEND_TARGET_REFUSAL);
  const result = await postJson(server, "/api/agents/send", { to, text, from });
  console.log(sendResultLine(result));
}

/** The one flag of this send. Two flags at once is an error. */
export function sendKind(args: Args): SendKind {
  const given = FLAG_KINDS.filter((flag) => booleanArg(args[flag]));
  if (given.length > 1) throw new Error(`tangent send takes one of --done, --blocked, or --question, not ${given.map((flag) => `--${flag}`).join(" and ")}.`);
  return given[0] ?? "note";
}

/** The line a session or Area send prints. */
export function sendResultLine(result: Record<string, any>): string {
  if (result.status === "delivered") return `delivered to ${result.to}`;
  if (result.target === "area") return `queued for ${result.to} (${result.reason})`;
  return `queued for ${result.to} (${result.reason}); it will arrive when the composer is empty`;
}

/** Real examples for the help text. */
function examples(): string {
  return `
Examples:
  tangent send brain "Tests pass on the new parser. Next: wire the route."
  tangent send brain --done "Parser and route committed as 3f2a1c0; npm test green."
  tangent send brain --blocked "The fixture server needs port 4321, which is taken."
  tangent send brain --question "Keep the old field name or rename it?"
  tangent send neara/essential/autodesign "Start the queued design Goal when you return."
`;
}
