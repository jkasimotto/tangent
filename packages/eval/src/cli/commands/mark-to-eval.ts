import { requiredString, stringArg, type Args } from "../args.js";
import { agentFromArgs, phasesFromArgs } from "./shared.js";
import { runToEval, type ToEvalResult } from "../../marks/to-eval.js";

/**
 * Handles `tangent mark to-eval <id>`: promotes a mark into a runnable eval scaffold under
 * `evals/<slug>/` in the mark's repo, then prints the generated paths and the next steps (capture
 * the baseline snapshot, apply the fix, capture the fixed snapshot, run the eval).
 */
export async function toEvalCommand(args: Args): Promise<void> {
  const markId = requiredString(args._[1], "tangent mark to-eval requires <id>.");
  const result = await runToEval({
    markId,
    name: stringArg(args.name),
    repo: stringArg(args.repo),
    agent: hasAgentFlag(args) ? agentFromArgs(args) : undefined,
    phases: hasPhasesFlag(args) ? phasesFromArgs(args.phases) : undefined
  });
  printResult(result);
}

/** Returns whether the caller passed an explicit --agent flag, so an unset flag keeps the manual default. */
function hasAgentFlag(args: Args): boolean {
  return stringArg(args.agent) !== undefined;
}

/** Returns whether the caller passed an explicit --phases flag, so an unset flag keeps the plan+implement default. */
function hasPhasesFlag(args: Args): boolean {
  return stringArg(args.phases) !== undefined;
}

/** Prints the generated eval paths and the two-snapshot capture workflow the user runs next. */
function printResult(result: ToEvalResult): void {
  console.log(`eval:   ${result.specPath}`);
  console.log(`prompt: ${result.promptPath}  (${result.promptSource === "stub" ? "stub, from the mark's own text" : "from the conversation"})`);
  console.log(`readme: ${result.readmePath}`);
  console.log(`mark:   ${result.mark.id}  status=${result.mark.status}  links.eval=${result.mark.links.eval}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. tangent eval context capture ${result.slug}-baseline --repo ${result.mark.repo.root} --cwd . --include-ancestors`);
  console.log("  2. Apply your fix (CLAUDE.md edit, skill patch, new tool on PATH).");
  console.log(`  3. tangent eval context capture ${result.slug}-fixed --repo ${result.mark.repo.root} --cwd . --include-ancestors --include-dirty-context`);
  console.log(`  4. tangent eval run ${result.specPath}`);
  console.log("  5. tangent eval report latest");
}
