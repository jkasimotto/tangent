import { booleanArg, requiredString, type Args } from "../args.js";
import { collectEval } from "../../core/metrics.js";
import { resolveRunId } from "./shared.js";

/** Handles the `eval collect` subcommand, collecting and printing metrics for a completed run. */
export async function collectCommand(args: Args): Promise<void> {
  const runId = await resolveRunId(requiredString(args._[1], "eval collect requires <run-id>."));
  const result = await collectEval(runId);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result.metrics, null, 2));
    return;
  }
  console.log(`collected: ${result.manifest.id}`);
  console.log(`variants:  ${result.metrics.length}`);
}
