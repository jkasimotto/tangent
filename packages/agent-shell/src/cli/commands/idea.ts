import { renderCommandHelp } from "@tangent/core";
import { booleanArg, parseArgs, requiredString, stringArg, type Args } from "@tangent/core/cli";

import { postJson, requireArea, resolveServerUrl, vaultFetch } from "../client.js";
import { ideaCommandSpec } from "../spec.js";

/** Dispatches `tangent idea` subcommands. */
export async function runIdeaCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const subcommand = args._[0];
  if (!subcommand || args.help) return help();
  if (subcommand === "add") return addCommand(args);
  if (subcommand === "list") return listCommand(args);
  throw new Error(`Unknown idea command: ${subcommand}. Try "tangent idea add <area> <text...>" or "tangent idea list".`);
}

/** Handles `tangent idea add <area> <text...>`. */
async function addCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const areaArg = requiredString(args._[1], "tangent idea add requires <area> <text...>.");
  const area = await requireArea(server, areaArg);
  const description = args._.slice(2).join(" ").trim();
  if (!description) throw new Error("tangent idea add requires idea text after the area.");
  const result = await postJson(server, "/api/idea/new", { area, description });
  console.log(`idea saved: ${result.file}`);
}

/** Handles `tangent idea list [area]`. */
async function listCommand(args: Args): Promise<void> {
  const server = resolveServerUrl(stringArg(args.server));
  const areaArg = stringArg(args._[1]);
  const area = areaArg ? await requireArea(server, areaArg) : undefined;
  const query = area ? `?area=${encodeURIComponent(area)}` : "";
  const { ideas } = await vaultFetch(server, `/api/ideas${query}`);
  if (booleanArg(args.json)) {
    console.log(JSON.stringify(ideas, null, 2));
    return;
  }
  if (!ideas.length) {
    console.log("No ideas.");
    return;
  }
  for (const idea of ideas as Array<{ area: string; text: string }>) console.log(`${idea.area}: ${idea.text}`);
}

/** Prints `tangent idea` help with real examples. */
function help(): void {
  console.log(renderCommandHelp(ideaCommandSpec));
  console.log(`
Examples:
  tangent idea add otto/dnd Maybe add a calmer return screen later.
  tangent idea list otto/dnd
`);
}
