#!/usr/bin/env node
import { completeCommand, completionScript, renderCommandHelp, type CliCommandSpec, type CliCompletionShell } from "@tangent/core";
import { dataCommandSpec, devCommandSpec, doctorCommandSpec, openCommandSpec, runOpenCommand, runProductStatusCommand, runSetupCommand, setupCommandSpec, statusCommandSpec } from "./product.js";
import { requiredProductModule } from "./module-loader.js";
import { runProcessCommand } from "./processes.js";
import { runTriggerCommand } from "./triggers.js";

type ProductRunner = (argv: string[]) => Promise<void>;

type ProductCommand = {
  module: string;
  exportName: string;
  installHint: string;
};

const productCommands: Record<string, ProductCommand> = {
  usage: { module: "@tangent/usage/cli", exportName: "runUsageCli", installHint: "usage" },
  rollup: { module: "@tangent/rollup/cli", exportName: "runRollupCli", installHint: "rollup" },
  search: { module: "@tangent/search/cli", exportName: "runSearchCli", installHint: "search" },
  eval: { module: "@tangent/eval/cli", exportName: "runEvalCli", installHint: "eval" },
  agent: { module: "@tangent/agent-shell/cli", exportName: "runAgentCli", installHint: "agent" },
  area: { module: "@tangent/agent-shell/cli", exportName: "runAreaCli", installHint: "area" },
  brain: { module: "@tangent/agent-shell/cli", exportName: "runBrainCli", installHint: "brain" },
  shell: { module: "@tangent/agent-shell/cli", exportName: "runShellCli", installHint: "shell" },
  goal: { module: "@tangent/agent-shell/cli", exportName: "runGoalCli", installHint: "goal" },
  harness: { module: "@tangent/agent-shell/cli", exportName: "runHarnessCli", installHint: "harness" },
  handover: { module: "@tangent/agent-shell/cli", exportName: "runHandoverCli", installHint: "handover" },
  idea: { module: "@tangent/agent-shell/cli", exportName: "runIdeaCli", installHint: "idea" },
  document: { module: "@tangent/agent-shell/cli", exportName: "runDocumentCli", installHint: "document" },
  study: { module: "@tangent/agent-shell/cli", exportName: "runStudyCli", installHint: "study" },
  vault: { module: "@tangent/agent-shell/cli", exportName: "runVaultCli", installHint: "vault" },
  governance: { module: "@tangent/governance/cli", exportName: "runGovernanceCli", installHint: "governance" }
};

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
    {
      name: "trigger",
      description: "Check Area conditions and launch visible agents when work appears",
      subcommands: [
        { name: "list", description: "List Area triggers and their durable state", options: [{ name: "json", description: "Print machine-readable JSON" }] },
        { name: "check", description: "Check due triggers, or one named trigger", args: "[area:name|name]", options: [{ name: "force", description: "Check even when the interval is not due" }] },
        { name: "acknowledge", description: "Acknowledge the current attention condition", args: "<area:name|name>" },
        { name: "stop", description: "End the live trigger agent; the trigger keeps its schedule", args: "<area:name|name>" },
        { name: "install", description: "Install the per-user macOS wake-up that checks due triggers every minute" }
      ]
    },
    productCommandSpec("usage", "Inspect coding-agent activity"),
    productCommandSpec("rollup", "Generate private rollup notes"),
    productCommandSpec("search", "Index and search repository structure"),
    productCommandSpec("eval", "Run and inspect coding-agent evals"),
    { name: "agent", description: "List agents, recover assignment context, and send messages; install @tangent/agent-shell if unavailable", args: "<list|context|send>" },
    { name: "area", description: "List, inspect, and create Tangent tree Areas; install @tangent/agent-shell if unavailable", args: "<list|show|create>" },
    { name: "brain", description: "Hand over, inspect, or safely stop an Area brain; install @tangent/agent-shell if unavailable", args: "<handover|status|stop>" },
    { name: "shell", description: "Rebuild and restart the Agent Shell server; install @tangent/agent-shell if unavailable", args: "<rebuild>" },
    { name: "goal", description: "Create, list, start, hand over, and close Goals; install @tangent/agent-shell if unavailable", args: "<create|list|show|start|handover|done|wont-do>" },
    { name: "harness", description: "List harnesses and resolved Area launch defaults; install @tangent/agent-shell if unavailable", args: "<list>" },
    { name: "handover", description: "Report this worker's facts to its controlling Area brain", args: "<facts...>" },
    { name: "idea", description: "Capture and list ideas on an Area note; install @tangent/agent-shell if unavailable", args: "<add|list>" },
    { name: "document", description: "List and resolve comments inside a vault Document; install @tangent/agent-shell if unavailable", args: "<comments|resolve>" },
    { name: "study", description: "Start the study partner: an interactive agent session beside nvim; install @tangent/agent-shell if unavailable", args: "<contract>" },
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

  if (app === "trigger") {
    await runTriggerCommand(rest);
    return;
  }

  const product = productCommands[app];
  if (product) {
    const loaded = await requiredProductModule<Record<string, ProductRunner>>(product.module, product.installHint);
    const runner = loaded[product.exportName];
    if (typeof runner !== "function") throw new Error(`${product.module} does not export ${product.exportName}.`);
    await runner(rest);
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
