import { booleanArg, requiredString, type Args } from "../args.js";
import { collectEval } from "../../core/metrics.js";
import { renderReport } from "../../core/report-renderer.js";
import { resolveRunId } from "./shared.js";

export async function reportCommand(args: Args): Promise<void> {
  const runId = await resolveRunId(requiredString(args._[1], "eval report requires <run-id>."));
  const result = await collectEval(runId);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result.metrics, null, 2));
    return;
  }
  console.log(renderReport(result.manifest.id, result.metrics));
}
