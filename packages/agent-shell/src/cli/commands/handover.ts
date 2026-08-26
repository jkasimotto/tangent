import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl } from "../client.js";
import { handoverCommandSpec } from "../spec.js";

/** Reports one worker's facts to its controlling Area brain. */
export async function runHandoverCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(renderCommandHelp(handoverCommandSpec));
    return;
  }
  const server = resolveServerUrl(stringArg(args.server));
  const session = stringArg(args.session) || (await currentTmuxSession());
  if (!session) throw new Error("tangent handover needs a session: run it inside the worker's tmux session or pass --session <name>.");
  const text = args._.map(String).join(" ").trim();
  if (!text) throw new Error("tangent handover needs the facts as text.");
  const report = parseReport(stringArg(args.report));
  const result = await postJson(server, "/api/goals/handover", { session, text, ...(report ? { report } : {}) });
  if (result.status === "reported") console.log("reported to the brain; the brain chooses what happens next");
  else if (result.status === "started") console.log(`handed over; next: step ${String(result.next?.index ?? "?")} (${String(result.next?.session ?? "no session")})`);
  else console.log("handover recorded");
}

/** Parses one tagged report object. */
function parseReport(value: string | undefined): object | undefined {
  if (!value?.trim()) return undefined;
  try {
    const report = JSON.parse(value);
    if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error();
    return report;
  } catch {
    throw new Error("--report must be one JSON object.");
  }
}
