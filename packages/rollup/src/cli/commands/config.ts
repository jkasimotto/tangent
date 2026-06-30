import { loadConfig } from "../../core/config.js";
import { configure } from "../../sdk/index.js";
import { stringArg, type Args } from "../args.js";

export async function configCommand(args: Args): Promise<void> {
  const subcommand = args._[1];
  const repo = stringArg(args.repo) || ".";
  if (!subcommand || subcommand === "show") {
    const loaded = await loadConfig({ repo });
    console.log(JSON.stringify(loaded.config, null, 2));
    return;
  }
  if (subcommand === "set") {
    const key = args._[2];
    const value = args._[3];
    if (!key || value === undefined) throw new Error("rollup config set requires <path> <value>.");
    const result = await configure({ repo, set: { path: key, value } });
    console.log(`updated: ${result.path}`);
    return;
  }
  throw new Error(`Unknown config command: ${subcommand}`);
}
