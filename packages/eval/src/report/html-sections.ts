// Renders the "above the fold" sections of report.html: header, verdict matrix, and variant cards.
// These three are meant to fit on one screen without scrolling, per the mark-loop design's at-a-glance
// rule; everything else (judge reasoning, context diff, transcripts) lives in html-drilldown.ts below them.

import { formatCountDelta, formatDuration, formatDurationDelta, formatPassPercent, formatPassRate, formatTokens, formatTokensDelta } from "./format.js";
import type { ReportCriterion, ReportModel, ReportVariant } from "./model.js";
import { escapeHtml } from "./html-escape.js";

/** Renders the header: task summary, run identity, repo/branch, and the originating mark when present. */
export function renderHeaderSection(model: ReportModel): string {
  const repoLine = model.task.repoRoot
    ? `<div>Repo: <code>${escapeHtml(model.task.repoRoot)}</code>${model.task.branch ? ` (${escapeHtml(model.task.branch)})` : ""}</div>`
    : "";
  const markLine = model.task.markId ? `<div>Mark: <code>${escapeHtml(model.task.markId)}</code></div>` : "";
  return `<header>
  <h1>${escapeHtml(model.task.summary)}</h1>
  <div class="report-meta">
    <div>Run <code>${escapeHtml(model.runId)}</code> (${escapeHtml(model.runName)}), created ${escapeHtml(model.createdAt)}.</div>
    ${repoLine}
    ${markLine}
  </div>
</header>`;
}

/** Renders the criteria x variants verdict matrix. Discriminating criteria are already sorted first in the model; this just marks them and colors pass/fail. */
export function renderMatrixSection(model: ReportModel): string {
  if (model.criteria.length === 0) return "";
  const headerCells = model.variants
    .map((variant) => `<th class="${variant.isBaseline ? "baseline-col" : ""}">${escapeHtml(variant.label)}${variant.isBaseline ? " (baseline)" : ""}</th>`)
    .join("");
  const rows = model.criteria.map((criterion) => renderMatrixRow(criterion, model.variants)).join("\n");
  return `<section>
  <h2>Verdict matrix</h2>
  <table class="matrix">
    <thead><tr><th>Criterion</th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/** Renders one criterion's row: its statement, a discriminating badge when variants disagree, and one verdict cell per variant. */
function renderMatrixRow(criterion: ReportCriterion, variants: ReportVariant[]): string {
  const badge = criterion.discriminating ? '<span class="discriminating-badge">disagreement</span>' : "";
  const cells = variants
    .map((variant) => {
      const cell = criterion.cells.find((candidate) => candidate.variantKey === variant.key);
      const className = variant.isBaseline ? "baseline-col " : "";
      if (cell?.passed === undefined) return `<td class="${className}verdict absent">n/a</td>`;
      return `<td class="${className}verdict ${cell.passed ? "pass" : "fail"}">${cell.passed ? "PASS" : "FAIL"}</td>`;
    })
    .join("");
  return `<tr><td>${escapeHtml(criterion.statement)}${badge}</td>${cells}</tr>`;
}

/** Renders one card per variant: pass rate, wall time, tokens, and tool calls, with a delta subline against the baseline for non-baseline variants. */
export function renderCardsSection(model: ReportModel): string {
  const cards = model.variants.map((variant) => renderCard(variant)).join("\n");
  return `<section>
  <h2>Variants</h2>
  <div class="cards">${cards}</div>
</section>`;
}

/** Renders a single variant card. */
function renderCard(variant: ReportVariant): string {
  const badge = variant.isBaseline ? '<span class="badge">baseline</span>' : "";
  return `<div class="card ${variant.isBaseline ? "is-baseline" : ""}">
    <h3>${escapeHtml(variant.label)} ${badge}</h3>
    <dl>
      <dt>Pass rate</dt><dd>${formatPassRate(variant.evaluation?.passCount, variant.evaluation?.criteriaTotal)} (${formatPassPercent(variant.evaluation?.passCount, variant.evaluation?.criteriaTotal)})${deltaSpan(formatCountDelta(variant.delta?.passCount))}</dd>
      <dt>Wall time</dt><dd>${formatDuration(variant.metrics?.durationMs)}${deltaSpan(formatDurationDelta(variant.delta?.durationMs))}</dd>
      <dt>Tokens</dt><dd>${formatTokens(variant.metrics?.tokensTotal)}${deltaSpan(formatTokensDelta(variant.delta?.tokensTotal))}</dd>
      <dt>Tool calls</dt><dd>${variant.metrics ? variant.metrics.toolCallsTotal : "n/a"}${deltaSpan(formatCountDelta(variant.delta?.toolCallsTotal))}</dd>
    </dl>
  </div>`;
}

/** Wraps a formatted delta string in the muted delta span, or renders nothing for a baseline row (whose delta is always "-"). */
function deltaSpan(delta: string): string {
  return delta === "-" ? "" : `<span class="delta">${escapeHtml(delta)}</span>`;
}

/** Renders sidecar-read warnings as a plain list, omitted when there are none. */
export function renderWarningsSection(model: ReportModel): string {
  if (model.warnings.length === 0) return "";
  const items = model.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  return `<section class="warnings"><h2>Warnings</h2><ul>${items}</ul></section>`;
}
