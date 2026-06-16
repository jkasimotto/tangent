#!/usr/bin/env node
import { completeCommand, completionScript, renderCommandHelp, type CliCommandSpec, type CliCompletionShell } from "@tangent/core";
import { runUsageCli, usageCommandSpec } from "@tangent/usage/cli";
import { rollupCommandSpec, runRollupCli } from "@tangent/rollup/cli";
import { evalCommandSpec, runEvalCli } from "@tangent/eval/cli";
import { governanceCommandSpec, runGovernanceCli } from "@tangent/governance/cli";
import { runSearchCli, searchCommandSpec } from "@tangent/search/cli";
import { runTreesCli, treesCommandSpec } from "@tangent/trees-cli/cli";
import { dataCommandSpec, devCommandSpec, doctorCommandSpec, runProductStatusCommand, runSetupCommand, setupCommandSpec, statusCommandSpec } from "./product.js";

const tangentCommandSpec: CliCommandSpec = {
  name: "tangent",
  description: "Local operating layer for coding-agent work",
  subcommands: [
    setupCommandSpec,
    statusCommandSpec,
    usageCommandSpec,
    treesCommandSpec,
    rollupCommandSpec,
    searchCommandSpec,
    evalCommandSpec,
    doctorCommandSpec,
    { ...governanceCommandSpec, hidden: true },
    devCommandSpec,
    dataCommandSpec,
    {
      name: "completion",
      description: "Print shell completion script",
      args: "<bash|zsh|fish>",
      options: []
    },
    {
      name: "__complete",
      description: "Internal completion entrypoint",
      hidden: true
    }
  ]
};

/** Documents the main helper. */
async function main(argv = process.argv.slice(2)): Promise<void> {
  const [app, ...rest] = argv;

  if (!app || app === "--help" || app === "-h" || app === "help") {
    help();
    return;
  }

  if (app === "setup") {
    await runSetupCommand(rest);
    return;
  }

  if (app === "status") {
    await runProductStatusCommand(rest);
    return;
  }

  if (app === "usage") {
    await runUsageCli(rest);
    return;
  }

  if (app === "trees") {
    await runTreesCli(rest);
    return;
  }

  if (app === "rollup") {
    await runRollupCli(rest);
    return;
  }

  if (app === "eval") {
    await runEvalCli(rest);
    return;
  }

  if (app === "search") {
    await runSearchCli(rest);
    return;
  }

  if (app === "governance") {
    await runGovernanceCli(rest);
    return;
  }

  if (app === "dev") {
    const [command, ...devRest] = rest;
    if (!command || command === "lint") {
      await runGovernanceCli(["lint", ...devRest]);
      return;
    }
    throw new Error(`Unknown dev command: ${command}`);
  }

  if (app === "data") {
    const [command, ...dataRest] = rest;
    if (command === "export") {
      await runUsageCli(["export", ...dataRest]);
      return;
    }
    if (command === "archive") {
      await runUsageCli(["archive", ...dataRest]);
      return;
    }
    throw new Error(`Unknown data command: ${command || ""}`.trim());
  }

  if (app === "doctor") {
    await runProductStatusCommand(rest, true);
    return;
  }

  if (app === "completion") {
    const shell = shellArg(rest[0]);
    console.log(completionScript(shell, "tangent"));
    return;
  }

  if (app === "__complete") {
    for (const completion of completeCommand(tangentCommandSpec, rest)) console.log(completion);
    return;
  }

  throw new Error(`Unknown command: ${app}`);
}

/** Documents the help helper. */
function help(): void {
  console.log(renderCommandHelp(tangentCommandSpec));
  console.log(`
Examples:
  tangent setup
  tangent status
  tangent usage today
  tangent trees list
  tangent usage transcript codex:019ea3ad
  tangent rollup today
  tangent rollup 20260601-20260610
  tangent search index
  tangent search "horizontal tension"
  tangent eval run eval.json
  tangent completion zsh
`);
}

/** Documents the shellArg helper. */
function shellArg(value: string | undefined): CliCompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish") return value;
  throw new Error("completion requires bash, zsh, or fish.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
