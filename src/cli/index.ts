#!/usr/bin/env node
import { completeCommand, completionScript, renderCommandHelp, type CliCommandSpec, type CliCompletionShell } from "@tangent/core";
import { dataCommandSpec, devCommandSpec, doctorCommandSpec, openCommandSpec, runOpenCommand, runProductStatusCommand, runSetupCommand, setupCommandSpec, statusCommandSpec } from "./product.js";
import { requiredProductModule } from "./module-loader.js";
import { runProcessCommand } from "./processes.js";

const tangentCommandSpec: CliCommandSpec = {
  name: "tangent",
  description: "Local operating layer for coding-agent work",
  subcommands: [
    setupCommandSpec,
    statusCommandSpec,
    openCommandSpec,
    {
      name: "process",
      description: "Run named local processes visibly in the Tangent tree",
      subcommands: [
        { name: "list", description: "List inherited process definitions", options: [{ name: "area", takesValue: true, description: "Tangent Area path" }] },
        { name: "start", description: "Start or reopen a named process", args: "<name>", options: [{ name: "area", takesValue: true, description: "Tangent Area path" }] },
        { name: "stop", description: "Stop a process but keep its visible session", args: "<name>", options: [{ name: "area", takesValue: true, description: "Tangent Area path" }] },
        { name: "restart", description: "Restart a named process", args: "<name>", options: [{ name: "area", takesValue: true, description: "Tangent Area path" }] },
        { name: "close", description: "Close a process session and remove its row", args: "<name>", options: [{ name: "area", takesValue: true, description: "Tangent Area path" }] }
      ]
    },
    productCommandSpec("usage", "Inspect coding-agent activity"),
    productCommandSpec("rollup", "Generate private rollup notes"),
    productCommandSpec("search", "Index and search repository structure"),
    productCommandSpec("eval", "Run and inspect coding-agent evals"),
    productCommandSpec("threads", "Delegated-thread sweep, registry, and attach"),
    { name: "agent", description: "List live agents and send messages between them; install @tangent/agent-shell if unavailable", args: "<list|send>" },
    { name: "area", description: "List, inspect, and create Tangent tree Areas; install @tangent/agent-shell if unavailable", args: "<list|show|create>" },
    { name: "brain", description: "The Area brain: hand over to a fresh copy of itself, or show its status; install @tangent/agent-shell if unavailable", args: "<handover|status>" },
    { name: "goal", description: "Create, list, start, hand over, and close Goals; install @tangent/agent-shell if unavailable", args: "<create|list|show|start|handover|done|wont-do>" },
    { name: "idea", description: "Capture and list ideas on an Area note; install @tangent/agent-shell if unavailable", args: "<add|list>" },
    { name: "document", description: "List and resolve comments inside a vault Document; install @tangent/agent-shell if unavailable", args: "<comments|resolve>" },
    { name: "vault", description: "Commit vault edits directly; install @tangent/agent-shell if unavailable", args: "<commit>" },
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

  if (app === "open") {
    await runOpenCommand(rest);
    return;
  }

  if (app === "process") {
    await runProcessCommand(rest);
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

  if (app === "search") {
    const { runSearchCli } = await requiredProductModule<{ runSearchCli(argv: string[]): Promise<void> }>("@tangent/search/cli", "search");
    await runSearchCli(rest);
    return;
  }

  if (app === "eval") {
    const { runEvalCli } = await requiredProductModule<{ runEvalCli(argv: string[]): Promise<void> }>("@tangent/eval/cli", "eval");
    await runEvalCli(rest);
    return;
  }

  if (app === "threads") {
    const { runThreadsCli } = await requiredProductModule<{ runThreadsCli(argv: string[]): Promise<void> }>("@tangent/threads/cli", "threads");
    await runThreadsCli(rest);
    return;
  }

  if (app === "agent") {
    const { runAgentCli } = await requiredProductModule<{ runAgentCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "agent");
    await runAgentCli(rest);
    return;
  }

  if (app === "area") {
    const { runAreaCli } = await requiredProductModule<{ runAreaCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "area");
    await runAreaCli(rest);
    return;
  }

  if (app === "brain") {
    const { runBrainCli } = await requiredProductModule<{ runBrainCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "brain");
    await runBrainCli(rest);
    return;
  }

  if (app === "goal") {
    const { runGoalCli } = await requiredProductModule<{ runGoalCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "goal");
    await runGoalCli(rest);
    return;
  }

  if (app === "idea") {
    const { runIdeaCli } = await requiredProductModule<{ runIdeaCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "idea");
    await runIdeaCli(rest);
    return;
  }

  if (app === "document") {
    const { runDocumentCli } = await requiredProductModule<{ runDocumentCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "document");
    await runDocumentCli(rest);
    return;
  }

  if (app === "vault") {
    const { runVaultCli } = await requiredProductModule<{ runVaultCli(argv: string[]): Promise<void> }>("@tangent/agent-shell/cli", "vault");
    await runVaultCli(rest);
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
  tangent usage ui
  tangent eval ui
  tangent open setup
  tangent open agent
  tangent open agent ~/Projects/my-project
  tangent open project ~/Projects/my-project
  tangent process list
  tangent process start dev
  tangent usage today
  tangent usage transcript codex:019ea3ad
  tangent rollup today
  tangent rollup 20260601-20260610
  tangent search index
  tangent search "horizontal tension"
  tangent eval run eval.json
  tangent area list
  tangent agent list
  tangent goal create --area otto/dnd --title "Connect chosen ramp faces" --done-when "The chosen faces connect at the dragged width."
  tangent idea add otto/dnd Maybe add a calmer return screen later.
  tangent vault commit otto/dnd/dnd.md -m "note: otto/dnd captures an idea"
  tangent threads sweep
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
