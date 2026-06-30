import { booleanArg, requiredString, type Args } from "../args.js";
import { loadEvalSpec } from "../../core/config.js";
import { prepareEval } from "../../core/worktree.js";
import { manualCommandHint } from "../../runners/manual.js";

/** Handles the `eval prepare` subcommand, setting up worktrees for each eval variant. */
export async function prepareCommand(args: Args): Promise<void> {
  const specPath = requiredString(args._[1], "eval prepare requires <eval.json>.");
  const loaded = await loadEvalSpec(specPath);
  const result = await prepareEval(loaded);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }
  console.log(`run: ${result.manifest.id}`);
  console.log(`dir: ${result.manifest.runDir}`);
  for (const variant of result.manifest.variants) {
    console.log(`variant: ${variant.caseId}/${variant.variantId}`);
    console.log(`  branch:   ${variant.branch}`);
    console.log(`  worktree: ${variant.worktree}`);
    for (const phase of variant.phases) {
      if (!phase.promptPath) continue;
      console.log(`  ${phase.id}: ${manualCommandHint({ agent: variant.agent, executionCwd: variant.executionCwd, promptPath: phase.promptPath })}`);
    }
  }
}
