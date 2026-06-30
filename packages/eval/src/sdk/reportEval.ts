import { collectEval } from "../core/metrics.js";
import { renderReport } from "../core/report-renderer.js";

/** Collects metrics for a completed run and returns a formatted report string. */
export async function reportEval(runId: string): Promise<string> {
  const result = await collectEval(runId);
  return renderReport(result.manifest.id, result.metrics);
}
