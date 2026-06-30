#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs, renderCommandHelp } from "@tangent/core";

import { governanceCommandSpec, lintGovernance, renderGovernanceFindings, type GovernanceLintGroup } from "../index.js";

export { governanceCommandSpec } from "../index.js";

export async function runGovernanceCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || args.help) return help();

  if (command === "lint") {
    const group = groupArg(args._[1]);
    const result = await lintGovernance({ groups: group ? [group] : ["all"] });
    console.log(renderGovernanceFindings(result));
    if (result.errors > 0) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown governance command: ${command}`);
}

function groupArg(value: string | undefined): GovernanceLintGroup | undefined {
  if (value === undefined) return undefined;
  if (value === "docs" || value === "deps" || value === "agents" || value === "shared" || value === "hooks" || value === "files") return value;
  throw new Error("governance lint accepts docs, deps, agents, shared, hooks, or files.");
}

function help(): void {
  console.log(renderCommandHelp(governanceCommandSpec));
}

if (isDirectRun()) {
  runGovernanceCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
