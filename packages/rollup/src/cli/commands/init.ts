import { configure } from "../../sdk/index.js";
import { outputArg, sandboxArg, stringArg, summaryProviderArg, type Args } from "../args.js";

/** Initializes the rollup config for a repo with the given options. */
export async function initCommand(args: Args): Promise<void> {
  const repo = args._[1] || ".";
  const output = args["repo-local"] ? "repo-local-private" : outputArg(args.output);
  const result = await configure({
    repo,
    output,
    summaryProvider: summaryProviderArg(args["summary-provider"]),
    model: stringArg(args.model),
    codexSandbox: sandboxArg(args.sandbox),
    baseDir: stringArg(args["base-dir"]),
    notesDir: stringArg(args["notes-dir"]),
    artifactsDir: stringArg(args["artifacts-dir"])
  });
  console.log(`rollup initialized: ${result.path}`);
}
