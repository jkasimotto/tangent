import { stringArg, type Args } from "../args.js";
import { runCompareSearch } from "../../core/compare-search.js";

/**
 * Handles `tangent eval compare-search [name]`: the one-command replacement for the manual
 * "Search vs No Search" recipe in skills/setup-tangent-eval/SKILL.md. Prints one short line per
 * step as `runCompareSearch` performs it, then the exact next commands to run and read the eval.
 */
export async function compareSearchCommand(args: Args): Promise<void> {
  const result = await runCompareSearch({
    name: stringArg(args._[1]),
    repo: stringArg(args.repo),
    cwd: stringArg(args.cwd),
    model: stringArg(args.model),
    judgeModel: stringArg(args["judge-model"]),
    promptFlags: {
      prompt: stringArg(args.prompt),
      task: stringArg(args.task),
      session: stringArg(args.session)
    }
  }, {
    /** Prints one step-progress line to stdout as the run performs it. */
    log: (line) => console.log(line)
  });

  console.log(`eval:   ${result.specPath}`);
  console.log(`prompt: ${result.promptPath}`);
  console.log("");
  console.log("Next:");
  console.log(`  tangent eval run evals/${result.name}/eval.json`);
  console.log("  tangent eval report latest");
  console.log("  tangent eval ui latest");
}
