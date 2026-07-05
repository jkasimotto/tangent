// Renders a ReportModel to report.md: a plain-markdown artifact meant to paste into a PR description
// and render natively on GitHub and Phabricator. No HTML tags anywhere in the output, per the mark-loop
// design's "The report artifact" section.

import { formatCountDelta, formatDuration, formatDurationDelta, formatPassRate, formatTokens, formatTokensDelta } from "./format.js";
import type { ReportCriterion, ReportModel, ReportVariant } from "./model.js";

/** Renders the full markdown report: header, verdict matrix, variant cards, deltas, and warnings. */
export function renderMarkdownReport(model: ReportModel): string {
  const sections = [
    renderHeader(model),
    renderVerdictMatrix(model),
    renderVariantCards(model),
    renderDeltas(model),
    renderWarnings(model)
  ].filter((section) => section.length > 0);
  return `${sections.join("\n\n")}\n`;
}

/** Renders the one-line task statement plus run identity and, when present, the originating mark and repo. */
function renderHeader(model: ReportModel): string {
  const lines = [`# ${model.task.summary}`, "", `Run \`${model.runId}\` (${model.runName}), created ${model.createdAt}.`];
  if (model.task.repoRoot) {
    const branch = model.task.branch ? ` (${model.task.branch})` : "";
    lines.push(`Repo: \`${model.task.repoRoot}\`${branch}`);
  }
  if (model.task.markId) lines.push(`Mark: \`${model.task.markId}\``);
  return lines.join("\n");
}

/** Renders the criteria x variants verdict matrix, discriminating criteria first, baseline column marked. */
function renderVerdictMatrix(model: ReportModel): string {
  if (model.criteria.length === 0) return "";
  const header = ["Criterion", ...model.variants.map(columnLabel)];
  const separator = header.map(() => "---");
  const rows = model.criteria.map((criterion) => [
    escapeCell(criterion.statement),
    ...model.variants.map((variant) => verdictCell(criterion, variant))
  ]);
  return ["## Verdict matrix", "", table([header, separator, ...rows])].join("\n");
}

/** Renders one variant's cell in the verdict matrix: pass/fail as a checkmark or cross, or "n/a" when this variant has no verdict for the criterion. */
function verdictCell(criterion: ReportCriterion, variant: ReportVariant): string {
  const cell = criterion.cells.find((candidate) => candidate.variantKey === variant.key);
  if (cell?.passed === undefined) return "n/a";
  return cell.passed ? "✅" : "❌";
}

/** Renders the compact variant-card table: pass rate, wall time, tokens, and tool calls per variant. */
function renderVariantCards(model: ReportModel): string {
  const header = ["Variant", "Pass rate", "Wall time", "Tokens", "Tool calls"];
  const rows = model.variants.map((variant) => [
    columnLabel(variant),
    formatPassRate(variant.evaluation?.passCount, variant.evaluation?.criteriaTotal),
    formatDuration(variant.metrics?.durationMs),
    formatTokens(variant.metrics?.tokensTotal),
    variant.metrics ? String(variant.metrics.toolCallsTotal ?? 0) : "n/a"
  ]);
  return ["## Variants", "", table([header, header.map(() => "---"), ...rows])].join("\n");
}

/** Renders each non-baseline variant's delta against the baseline. Omitted entirely when the run has only a baseline. */
function renderDeltas(model: ReportModel): string {
  const rows = model.variants.filter((variant) => !variant.isBaseline);
  if (rows.length === 0) return "";
  const header = ["Variant", "Wall time", "Tokens", "Tool calls", "Pass count"];
  const body = rows.map((variant) => [
    variant.label,
    formatDurationDelta(variant.delta?.durationMs),
    formatTokensDelta(variant.delta?.tokensTotal),
    formatCountDelta(variant.delta?.toolCallsTotal),
    formatCountDelta(variant.delta?.passCount)
  ]);
  return ["## Deltas vs baseline", "", table([header, header.map(() => "---"), ...body])].join("\n");
}

/** Renders sidecar-read warnings (e.g. a variant missing evaluation.json) as a bullet list, omitted when there are none. */
function renderWarnings(model: ReportModel): string {
  if (model.warnings.length === 0) return "";
  return ["## Warnings", "", ...model.warnings.map((warning) => `- ${warning}`)].join("\n");
}

/** Returns a variant's column label, appending "(baseline)" to the designated baseline. */
function columnLabel(variant: ReportVariant): string {
  return variant.isBaseline ? `${variant.label} (baseline)` : variant.label;
}

/** Joins pre-built rows into a GitHub/Phab-flavored markdown table. */
function table(rows: string[][]): string {
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

/** Escapes markdown table-breaking characters (pipes and newlines) in free-text cell content. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
