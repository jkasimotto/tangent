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
  send: { module: "@tangent/agent-shell/cli", exportName: "runSendCli", installHint: "send" },
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
    { name: "agent", description: "List live agents and their queued messages", args: "<list|context|send>" },
    { name: "area", description: "List, inspect, and create Areas", args: "<list|show|create|done|reopen>" },
    { name: "brain", description: "Inspect or stop an Area brain, or ask Julian a question", args: "<status|stop|request|withdraw|advance>" },
    { name: "shell", description: "Rebuild and restart the Agent Shell server", args: "<rebuild>" },
    { name: "goal", description: "Create, list, start, append to, and close Goals", args: "<create|list|show|start|append|done|wont-do|park|reopen>" },
    { name: "harness", description: "List harnesses and resolved Area launch defaults", args: "<list>" },
    { name: "send", description: "Send a note to your brain (--done, --blocked, --question), a live session, or an Area brain", args: "<brain|session|area> <note...>" },
    { name: "handover", description: "Replaced by tangent send brain; kept as an alias", args: "<facts...>", hidden: true },
    { name: "idea", description: "Capture and list ideas on an Area (ideas.md)", args: "<add|list>" },
    { name: "document", description: "List and resolve Julian's comments inside a vault Document", args: "<comments|resolve>" },
    { name: "study", description: "Start the study partner: an interactive agent session beside nvim", args: "<contract>" },
    { name: "vault", description: "Commit vault edits with provenance", args: "<commit>" },
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

/**
 * The help groups: who runs which commands. A brain reads this to find its
 * commands; a worker has one; the rest are Julian's own tools.
 */
const HELP_GROUPS: Array<{ title: string; commands: string[] }> = [
  { title: "Brains", commands: ["goal", "area", "send", "agent", "idea", "document", "vault", "brain", "harness", "process"] },
  { title: "Workers", commands: ["send"] },
  { title: "Julian", commands: ["setup", "status", "open", "shell", "study", "usage", "rollup", "search", "eval", "trigger", "doctor", "dev", "data", "completion"] },
];

/** One `  name args  description` row per command, padded to the group's width. */
function helpRows(names: string[]): string[] {
  const commands = names.map((name) => tangentCommandSpec.subcommands?.find((command) => command.name === name)).filter((command): command is CliCommandSpec => Boolean(command));
  const width = Math.max(...commands.map((command) => `${command.name} ${command.args ?? ""}`.trim().length));
  return commands.map((command) => `  ${`${command.name} ${command.args ?? ""}`.trim().padEnd(width)}  ${command.description ?? ""}`.trimEnd());
}

/** Prints `tangent help`: the commands by who runs them, then examples. */
function help(): void {
  const lines = ["tangent", "", tangentCommandSpec.description ?? "", ""];
  for (const group of HELP_GROUPS) {
    lines.push(`${group.title}:`);
    if (group.title === "Workers") lines.push('  A worker has one command. Send the brain a note, or finish with --done, --blocked, or --question.');
    lines.push(...helpRows(group.commands), "");
  }
  lines.push("Run tangent <command> --help for the exact flags.");
  console.log(lines.join("\n"));
  console.log(`
Examples:
  tangent goal list otto/dnd
  tangent goal create --area otto/dnd --title "Connect chosen ramp faces" --start --path ~/Projects/dnd --instruction "Connect the chosen faces at the dragged width."
  tangent goal done connect-chosen-ramp-faces --note "The ramp test passes."
  tangent send brain "Done: the faces connect. Proved by the ramp test." --done
  tangent area show otto/dnd
  tangent idea add otto/dnd Maybe add a calmer return screen later.
  tangent vault commit otto/dnd/dnd.md -m "update: otto/dnd rewrite Current"
  tangent process list
  tangent usage today
  tangent search "horizontal tension"
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
