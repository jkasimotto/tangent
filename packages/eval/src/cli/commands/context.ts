import { booleanArg, requiredString, stringArg, type Args } from "../args.js";
import { captureContextSnapshot } from "../../core/context-snapshot.js";

/** Handles the `eval context` subcommand, capturing a context snapshot into a git ref. */
export async function contextCommand(args: Args): Promise<void> {
  const subcommand = args._[1];
  if (subcommand !== "capture") throw new Error(`Unknown eval context command: ${subcommand || ""}`);
  const name = requiredString(args._[2], "eval context capture requires <name>.");
  const result = await captureContextSnapshot({
    name,
    repo: stringArg(args.repo) || ".",
    cwd: stringArg(args.cwd) || ".",
    includeAncestors: booleanArg(args["include-ancestors"]),
    includeDirtyContext: booleanArg(args["include-dirty-context"]),
    fromRef: stringArg(args["from-ref"]),
    empty: booleanArg(args.empty)
  });
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`context: ${result.ref}`);
  console.log(`commit:  ${result.commit}`);
  console.log(`files:   ${result.manifest.files.length}`);
}
