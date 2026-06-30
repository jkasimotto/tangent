#!/usr/bin/env node
import { completeCommand, completionScript, renderCommandHelp, type CliCommandSpec, type CliCompletionShell } from "@tangent/core";
import { dataCommandSpec, devCommandSpec, doctorCommandSpec, openCommandSpec, runOpenCommand, runProductStatusCommand, runSetupCommand, runTangentUiCommand, setupCommandSpec, statusCommandSpec, uiCommandSpec } from "./product.js";
import { requiredProductModule } from "./module-loader.js";

const tangentCommandSpec: CliCommandSpec = {
  name: "tangent",
  description: "Local operating layer for coding-agent work",
  subcommands: [
    setupCommandSpec,
    statusCommandSpec,
    uiCommandSpec,
    openCommandSpec,
    productCommandSpec("usage", "Inspect coding-agent activity"),
    productCommandSpec("rollup", "Generate private rollup notes"),
    productCommandSpec("eval", "Run and inspect coding-agent evals"),
    doctorCommandSpec,
    { name: "governance", description: "Run architecture governance lints", hidden: true },
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

  if (app === "ui") {
    await runTangentUiCommand(rest);
    return;
  }

  if (app === "open") {
    await runOpenCommand(rest);
    return;
  }

  if (app === "usage") {
    const { runUsageCli } = await requiredProductModule<{ runUsageCli(argv: string[]): Promise<void> }>("@tangent/usage/cli", "usage");
    await runUsageCli(rest);
    return;
  }

  if (app === "rollup") {
    const { runRollupCli } = await requiredProductModule<{ runRollupCli(argv: string[]): Promise<void> }>("@tangent/rollup/cli", "rollup");
    await runRollupCli(rest);
    return;
  }

  if (app === "eval") {
    const { runEvalCli } = await requiredProductModule<{ runEvalCli(argv: string[]): Promise<void> }>("@tangent/eval/cli", "eval");
    await runEvalCli(rest);
    return;
  }

  if (app === "governance") {
    const { runGovernanceCli } = await requiredProductModule<{ runGovernanceCli(argv: string[]): Promise<void> }>("@tangent/governance/cli", "governance");
    await runGovernanceCli(rest);
    return;
  }

  if (app === "dev") {
    const [command, ...devRest] = rest;
    if (!command || command === "lint") {
      const { runGovernanceCli } = await requiredProductModule<{ runGovernanceCli(argv: string[]): Promise<void> }>("@tangent/governance/cli", "dev lint");
      await runGovernanceCli(["lint", ...devRest]);
      return;
    }
    throw new Error(`Unknown dev command: ${command}`);
  }

  if (app === "data") {
    const [command, ...dataRest] = rest;
    if (command === "export") {
      const { runUsageCli } = await requiredProductModule<{ runUsageCli(argv: string[]): Promise<void> }>("@tangent/usage/cli", "data export");
      await runUsageCli(["export", ...dataRest]);
      return;
    }
    if (command === "archive") {
      const { runUsageCli } = await requiredProductModule<{ runUsageCli(argv: string[]): Promise<void> }>("@tangent/usage/cli", "data archive");
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

/** Creates a root-owned command stub for an optional product package. */
function productCommandSpec(name: string, description: string): CliCommandSpec {
  return {
    name,
    description: `${description}; install @tangent/${name} if unavailable`
  };
}

/** Documents the help helper. */
function help(): void {
  console.log(renderCommandHelp(tangentCommandSpec));
  console.log(`
Examples:
  tangent setup
  tangent status
  tangent ui
  tangent open setup
  tangent open agent
  tangent open agent ~/Projects/my-project
  tangent open project ~/Projects/my-project
  tangent usage today
  tangent usage transcript codex:019ea3ad
  tangent rollup today
  tangent rollup 20260601-20260610
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
