import { requiredString, stringArg, type Args } from "../args.js";
import { gitRaw } from "@tangent/repo/git";
import { findVariant, loadRunManifest } from "../../core/run-store.js";
import { resolveRunId } from "./shared.js";

export async function diffCommand(args: Args): Promise<void> {
  const runId = await resolveRunId(requiredString(args._[1], "eval diff requires <run-id>."));
  const variantA = requiredString(args._[2], "eval diff requires <variant-a>.");
  const variantB = requiredString(args._[3], "eval diff requires <variant-b>.");
  const phase = stringArg(args.phase) || "impl";
  const caseId = stringArg(args.case);
  const manifest = await loadRunManifest(runId);
  const a = findVariant(manifest, variantA, caseId);
  const b = findVariant(manifest, variantB, caseId);
  let output: string;
  if (phase === "all") {
    output = await gitRaw(a.worktree, ["diff", endCommit(a), endCommit(b)]);
  } else if (phase === "context") {
    output = await gitRaw(a.worktree, ["range-diff", `${a.baseCommit}..${a.contextCommit || a.baseCommit}`, `${b.baseCommit}..${b.contextCommit || b.baseCommit}`]);
  } else if (phase === "plan") {
    output = await gitRaw(a.worktree, ["range-diff", `${a.contextCommit || a.baseCommit}..${a.planCommit || a.contextCommit || a.baseCommit}`, `${b.contextCommit || b.baseCommit}..${b.planCommit || b.contextCommit || b.baseCommit}`]);
  } else if (phase === "impl") {
    output = await gitRaw(a.worktree, ["range-diff", `${a.planCommit || a.contextCommit || a.baseCommit}..${a.implementationCommit || endCommit(a)}`, `${b.planCommit || b.contextCommit || b.baseCommit}..${b.implementationCommit || endCommit(b)}`]);
  } else {
    throw new Error("--phase must be context, plan, impl, or all.");
  }
  process.stdout.write(output);
}

function endCommit(variant: { implementationCommit?: string; planCommit?: string; contextCommit?: string; baseCommit: string }): string {
  return variant.implementationCommit || variant.planCommit || variant.contextCommit || variant.baseCommit;
}
