// Renders a ReportModel to report.html: one self-contained file with inline CSS, zero external
// requests, and minimal inline JS for an expand-all/collapse-all convenience over the native
// `<details>` drill-down sections (which already collapse and expand without any script). See
// docs/superpowers/specs/2026-07-05-mark-loop-design.md, "The report artifact (what a reviewer sees)".

import { renderCardsSection, renderHeaderSection, renderMatrixSection, renderWarningsSection } from "./html-sections.js";
import { renderContextDiffSection, renderReasoningSection } from "./html-drilldown.js";
import { renderTranscriptsSection } from "./html-transcripts.js";
import { reportStyleBlock } from "./html-styles.js";
import { escapeHtml } from "./html-escape.js";
import type { ReportModel } from "./model.js";

/**
 * Renders the full report.html document. The matrix and cards sections are placed immediately after
 * the header so they fit on one screen without scrolling; judge reasoning, the context diff, and full
 * transcripts follow below as collapsed drill-down. Pure and synchronous: pass a model already populated
 * by `loadReportModel(manifest, { includeTranscripts: true, includeContextDiff: true })` to get the
 * drill-down sections, or a lean model (markdown-only load) to render just the above-the-fold sections.
 */
export function renderHtmlReport(model: ReportModel): string {
  const aboveTheFold = [renderMatrixSection(model), renderCardsSection(model)].filter((section) => section.length > 0);
  const drilldown = [renderReasoningSection(model), renderContextDiffSection(model), renderTranscriptsSection(model)].filter(
    (section) => section.length > 0
  );
  const warnings = renderWarningsSection(model);
  const toolbar = drilldown.length > 0
    ? `<div class="toolbar">
  <button type="button" onclick="document.querySelectorAll('details.report-collapsible').forEach(function(d){d.open=true;})">Expand all</button>
  <button type="button" onclick="document.querySelectorAll('details.report-collapsible').forEach(function(d){d.open=false;})">Collapse all</button>
</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.task.summary)}: eval report</title>
${reportStyleBlock()}
</head>
<body>
<main>
${renderHeaderSection(model)}
${aboveTheFold.join("\n")}
${toolbar}
${drilldown.join("\n")}
${warnings}
</main>
</body>
</html>
`;
}
