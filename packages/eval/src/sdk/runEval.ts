import { loadEvalSpec } from "../core/config.js";
import { collectEval } from "../core/metrics.js";
import { runPreparedEval } from "../core/run.js";
import { prepareEval } from "../core/worktree.js";

/** Loads, prepares, runs, and collects an eval spec, returning the collected run and metrics. */
export async function runEval(specPath: string): Promise<Awaited<ReturnType<typeof collectEval>>> {
  const prepared = await prepareEval(await loadEvalSpec(specPath));
  await runPreparedEval(prepared.manifest);
  return collectEval(prepared.manifest);
}
