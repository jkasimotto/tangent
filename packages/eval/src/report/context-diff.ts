// Computes the context-file diff between the designated baseline and each other variant, for the HTML
// report's drill-down. Mirrors the blob-OID comparison `contextArtifactStatuses` already does in
// server/index.ts for the compare screen, narrowed to the baseline-vs-N-variants shape the report needs
// and reusing the same exported `diffLines` for line-level content.

import { fileOidsAtRef, showFileFollowingSymlinks } from "@tangent/repo/git";

import type { EvalRunVariantState } from "../types/run.js";
import { isContextPath } from "../core/context-discovery.js";
import { diffLines } from "../server/diff.js";
import type { ReportContextDiff, ReportContextDiffFile, ReportVariantSidecars } from "./model.js";
import { variantKey } from "./model.js";

/**
 * Builds the context diff for each non-baseline variant against the baseline. Every git call is
 * best-effort: a variant whose worktree is gone (a fixture run, or a cleaned-up run directory) yields an
 * empty file list for that pair rather than aborting the whole report, per "skip the section cleanly
 * when not derivable".
 */
export async function loadReportContextDiffs(sidecars: ReportVariantSidecars[], baselineKey: string): Promise<ReportContextDiff[]> {
  const baselineRow = sidecars.find((row) => variantKey(row.variant) === baselineKey);
  if (!baselineRow) return [];
  const baselineOids = await contextOids(baselineRow.variant);

  const rows: ReportContextDiff[] = [];
  for (const row of sidecars) {
    const key = variantKey(row.variant);
    if (key === baselineKey) continue;
    const variantOids = await contextOids(row.variant);
    const files = await diffContextFiles(baselineRow.variant, baselineOids, row.variant, variantOids);
    rows.push({ variantKey: key, files });
  }
  return rows;
}

/** Blob OIDs of a variant's context files (CLAUDE.md, AGENTS.md, .claude/**) at its context commit, or an empty map when git fails. */
async function contextOids(variant: EvalRunVariantState): Promise<Map<string, string>> {
  const ref = variant.contextCommit || variant.baseCommit;
  const oids = await fileOidsAtRef(variant.worktree, ref).catch(() => new Map<string, string>());
  return new Map([...oids].filter(([filePath]) => isContextPath(filePath)));
}

/** Lists changed/added/removed context files between two variants and attaches a line diff where content is readable on both sides. */
async function diffContextFiles(
  left: EvalRunVariantState,
  leftOids: Map<string, string>,
  right: EvalRunVariantState,
  rightOids: Map<string, string>
): Promise<ReportContextDiffFile[]> {
  const paths = [...new Set([...leftOids.keys(), ...rightOids.keys()])].sort();
  const rows: ReportContextDiffFile[] = [];
  for (const filePath of paths) {
    const leftOid = leftOids.get(filePath);
    const rightOid = rightOids.get(filePath);
    if (leftOid === rightOid) continue;
    const status = leftOid === undefined ? "added" : rightOid === undefined ? "removed" : "changed";
    const lines = await fileDiffLines(left, right, filePath, status);
    rows.push({ path: filePath, status, lines });
  }
  return rows;
}

/** Reads both sides' content for one context file and computes its line diff, or undefined when either read fails. */
async function fileDiffLines(
  left: EvalRunVariantState,
  right: EvalRunVariantState,
  filePath: string,
  status: ReportContextDiffFile["status"]
): Promise<ReportContextDiffFile["lines"]> {
  const leftContent = status === "added" ? "" : await readContextFile(left, filePath);
  const rightContent = status === "removed" ? "" : await readContextFile(right, filePath);
  if (leftContent === undefined || rightContent === undefined) return undefined;
  return diffLines(leftContent, rightContent);
}

/** Reads a context file at a variant's context ref, or undefined when the read fails. */
async function readContextFile(variant: EvalRunVariantState, filePath: string): Promise<string | undefined> {
  const ref = variant.contextCommit || variant.baseCommit;
  return showFileFollowingSymlinks(variant.worktree, ref, filePath).catch(() => undefined);
}
