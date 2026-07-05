// The report-export GET endpoints' one shared helper: renders a run's report.md or report.html on
// demand. Kept out of server/index.ts, which is already near the file-size limit, so this stays a
// one-line addition there.

import type { EvalRunManifest } from "../types/run.js";
import { loadReportModel } from "../report/model.js";
import { renderMarkdownReport } from "../report/markdown.js";
import { renderHtmlReport } from "../report/html.js";

/**
 * Renders a run's report.md or report.html for the export-button endpoints. HTML loads the transcript
 * and context-diff drill-down data; markdown does not need it, so that load is skipped to keep the
 * plain-text export fast.
 */
export async function renderReportArtifact(manifest: EvalRunManifest, format: "md" | "html"): Promise<string> {
  const isHtml = format === "html";
  const model = await loadReportModel(manifest, { includeTranscripts: isHtml, includeContextDiff: isHtml });
  return isHtml ? renderHtmlReport(model) : renderMarkdownReport(model);
}
