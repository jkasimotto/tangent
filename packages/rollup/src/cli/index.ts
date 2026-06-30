#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { parseArgs } from "./args.js";
import { renderCommand } from "./commands/artifacts.js";
import { configCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { noteCommand } from "./commands/note.js";
import { processCommand } from "./commands/process.js";
import { providerCommand } from "./commands/provider.js";
import { reprocessCommand } from "./commands/reprocess.js";
import { statusCommand } from "./commands/status.js";
import { candidatesCommand } from "./commands/candidates.js";
import { rollupCommandSpec } from "./spec.js";
import { isRollupSelector } from "../core/time.js";

export { rollupCommandSpec } from "./spec.js";

/** Entry point for the rollup CLI; dispatches to the appropriate subcommand. */
export async function runRollupCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["focus"] });
  const command = args._[0];
  if (args.help) return help();
  if (!command || isRollupSelector(command)) return processCommand({ ...args, _: ["rollup", ...args._.slice(command ? 1 : 0)], selector: command });

  if (command === "init") return initCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "candidates") return candidatesCommand(args);
  if (command === "note") return noteCommand(args);
  if (command === "path") return noteCommand({ ...args, _: ["note", "path", ...args._.slice(1)] });
  if (command === "reprocess" || command === "retry") return reprocessCommand(args);
  if (command === "provider") return providerCommand(args);
  if (command === "render") return renderCommand(args);
  if (command === "config") return configCommand(args);
  return processCommand({ ...args, _: ["rollup", ...args._] });
}

/** Prints the rollup CLI help text to stdout. */
function help(): void {
  console.log(renderCommandHelp(rollupCommandSpec));
}

if (isDirectRun()) {
  runRollupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Returns true when this module is the direct entry point being run. */
function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
