import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg } from "@tangent/core/cli";

import { currentTmuxSession, postJson, resolveServerUrl } from "../client.js";
import { handoverCommandSpec } from "../spec.js";
import { parseWorkerReportOption, workerHandoverResultLine } from "../worker-report.js";

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
  const report = parseWorkerReportOption(args);
  const result = await postJson(server, "/api/goals/handover", { session, text, ...(report ? { report } : {}) });
  console.log(workerHandoverResultLine(result));
}
