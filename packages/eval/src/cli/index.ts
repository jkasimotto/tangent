#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { parseArgs } from "./args.js";
import { captureCommand } from "./commands/capture.js";
import { collectCommand } from "./commands/collect.js";
import { compareSearchCommand } from "./commands/compare-search.js";
import { contextCommand } from "./commands/context.js";
import { diffCommand } from "./commands/diff.js";
import { initCommand } from "./commands/init.js";
import { markCommand } from "./commands/mark.js";
import { openCommand } from "./commands/open.js";
import { prepareCommand } from "./commands/prepare.js";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { uiCommand } from "./commands/ui.js";
import { evalCommandSpec, markCommandSpec } from "./spec.js";

export { evalCommandSpec, markCommandSpec } from "./spec.js";

/** Dispatches eval CLI arguments to the matching command. */
export async function runEvalCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["prompt", "context", "variant"] });
  const command = args._[0];
  if (!command || args.help) return help();

  if (command === "init") return initCommand();
  if (command === "compare-search") return compareSearchCommand(args);
  if (command === "context") return contextCommand(args);
  if (command === "capture") return captureCommand(args);
  if (command === "prepare") return prepareCommand(args);
  if (command === "run" || command === "quick") return runCommand(args);
  if (command === "collect") return collectCommand(args);
  if (command === "report") return reportCommand(args);
  if (command === "diff") return diffCommand(args);
  if (command === "open") return openCommand(args);
  if (command === "ui") return uiCommand(args);
  throw new Error(`Unknown eval command: ${command}`);
}

/**
 * Dispatches `tangent mark` CLI arguments. Kept separate from `runEvalCli` so a top-level
 * `tangent mark ...` never requires typing `tangent eval mark`, even though the implementation
 * lives in this package.
 */
export async function runMarkCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help && !args._[0]) {
    console.log(renderCommandHelp(markCommandSpec));
    return;
  }
  await markCommand(args);
}

/** Prints eval CLI help text. */
function help(): void {
  console.log(renderCommandHelp(evalCommandSpec));
}

if (isDirectRun()) {
  runEvalCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Returns whether this module is executing as the CLI entrypoint. */
function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
