#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { parseArgs } from "./args.js";
import { digestCommand, inputCommand, renderCommand, topicsCommand } from "./commands/artifacts.js";
import { configCommand } from "./commands/config.js";
import { digestsCommand } from "./commands/digests.js";
import { initCommand } from "./commands/init.js";
import { noteCommand } from "./commands/note.js";
import { processCommand } from "./commands/process.js";
import { providerCommand } from "./commands/provider.js";
import { reprocessCommand } from "./commands/reprocess.js";
import { statusCommand } from "./commands/status.js";
import { unprocessedCommand } from "./commands/unprocessed.js";
import { dailyCommandSpec } from "./spec.js";

export { dailyCommandSpec } from "./spec.js";

export async function runDailyCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (isDateShortcut(args._[0])) args._.unshift("path");
  const command = args._[0];
  if (!command || args.help) return help();

  if (command === "init") return initCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "process") return processCommand(args);
  if (command === "unprocessed" || command === "candidates") return unprocessedCommand(args);
  if (command === "note") return noteCommand(args);
  if (command === "path") return noteCommand({ ...args, _: ["note", "path", ...args._.slice(1)] });
  if (command === "reprocess") return reprocessCommand(args);
  if (command === "provider") return providerCommand(args);
  if (command === "digests") return digestsCommand(args);
  if (command === "input") return inputCommand(args);
  if (command === "digest") return digestCommand(args);
  if (command === "topics") return topicsCommand(args);
  if (command === "render") return renderCommand(args);
  if (command === "config") return configCommand(args);
  throw new Error(`Unknown command: ${command}`);
}

function isDateShortcut(value: string | undefined): boolean {
  return Boolean(value && (value === "today" || value === "yesterday" || value === "tomorrow" || /^\d{4}-\d{2}-\d{2}$/.test(value) || /^[+-]\d+d$/.test(value)));
}

function help(): void {
  console.log(renderCommandHelp(dailyCommandSpec));
}

if (isDirectRun()) {
  runDailyCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
