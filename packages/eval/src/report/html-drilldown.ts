// Renders the two lighter drill-down sections below the fold: per-criterion judge reasoning, and the
// context-file diff between the baseline and each other variant. Both are collapsible and both skip
// cleanly when there is nothing to show, per "skip the section cleanly when not [derivable]".

import type { EvalDiffLineView } from "../server/types.js";
import type { ReportContextDiff, ReportModel, ReportVariant } from "./model.js";
import { escapeHtml } from "./html-escape.js";

/** Renders one collapsible `<details>` block per criterion with each variant's verdict and judge reasoning. */
export function renderReasoningSection(model: ReportModel): string {
  if (model.criteria.length === 0) return "";
  const blocks = model.criteria.map((criterion) => renderCriterionDetails(criterion, model.variants)).join("\n");
  return `<section>
  <h2>Judge reasoning</h2>
  ${blocks}
</section>`;
}

/** Renders one criterion's collapsible reasoning block. */
function renderCriterionDetails(criterion: ReportModel["criteria"][number], variants: ReportVariant[]): string {
  const rows = variants
    .map((variant) => {
      const cell = criterion.cells.find((candidate) => candidate.variantKey === variant.key);
      const verdict = cell?.passed === undefined ? '<span class="absent">n/a</span>' : cell.passed ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>';
      const reasoning = cell?.reasoning ? escapeHtml(cell.reasoning) : "No reasoning recorded.";
      return `<div class="reasoning-row"><div class="label">${escapeHtml(variant.label)} ${verdict}</div><div>${reasoning}</div></div>`;
    })
    .join("");
  return `<details class="report-collapsible">
    <summary>${escapeHtml(criterion.statement)}</summary>
    <div class="body">${rows}</div>
  </details>`;
}

/**
 * Renders the context-diff section: one collapsible block per non-baseline variant that has at least one
 * changed context file. Returns an empty string (the section is fully skipped) when `contextDiffs` was
 * never loaded, or every pair came back with no differences, since both cases read the same to a viewer:
 * nothing to show here.
 */
export function renderContextDiffSection(model: ReportModel): string {
  const diffs = (model.contextDiffs ?? []).filter((diff) => diff.files.length > 0);
  if (diffs.length === 0) return "";
  const blocks = diffs.map((diff) => renderVariantContextDiff(diff, model)).join("\n");
  return `<section>
  <h2>Context diff vs baseline</h2>
  ${blocks}
</section>`;
}

/** Renders one variant's changed context files against the baseline. */
function renderVariantContextDiff(diff: ReportContextDiff, model: ReportModel): string {
  const label = model.variants.find((variant) => variant.key === diff.variantKey)?.label ?? diff.variantKey;
  const files = diff.files.map((file) => renderContextDiffFile(file)).join("\n");
  return `<details class="report-collapsible">
    <summary>${escapeHtml(label)}: ${diff.files.length} context file${diff.files.length === 1 ? "" : "s"} changed</summary>
    <div class="body">${files}</div>
  </details>`;
}

/** Renders one changed context file: its path, its added/removed/changed status, and a line diff when one could be computed. */
function renderContextDiffFile(file: ReportContextDiff["files"][number]): string {
  const lines = file.lines ? renderDiffLines(file.lines) : '<div class="warnings">Content diff not available for this file.</div>';
  return `<details class="report-collapsible">
    <summary><code>${escapeHtml(file.path)}</code> (${file.status})</summary>
    <div class="body">${lines}</div>
  </details>`;
}

/** Renders a line-level diff as add/delete/equal rows, skipping unchanged runs beyond a small context window. */
function renderDiffLines(lines: EvalDiffLineView[]): string {
  return lines
    .map((line) => {
      if (line.kind === "add") return `<div class="diff-line diff-add">+ ${escapeHtml(line.right ?? "")}</div>`;
      if (line.kind === "delete") return `<div class="diff-line diff-delete">- ${escapeHtml(line.left ?? "")}</div>`;
      if (line.kind === "changed") {
        return `<div class="diff-line diff-delete">- ${escapeHtml(line.left ?? "")}</div><div class="diff-line diff-add">+ ${escapeHtml(line.right ?? "")}</div>`;
      }
      return `<div class="diff-line">&nbsp; ${escapeHtml(line.left ?? "")}</div>`;
    })
    .join("");
}
